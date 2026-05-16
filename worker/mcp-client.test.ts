/**
 * Tests for `worker/mcp-client.ts` — the Streamable HTTP MCP client
 * (issue #168 Wave 6 / Worker C).
 *
 * The client speaks the JSON-RPC 2.0 subset of MCP needed for the
 * agent's tool merge flow:
 *
 *   - `tools/list` — fetch a server's tool catalogue. Used per chat
 *     turn to refresh the merged toolset.
 *   - `tools/call` — invoke a specific tool with arguments.
 *   - A `probeHealth` helper that wraps `tools/list` for the
 *     Settings UI's per-server status badge.
 *
 * All transport over POST + JSON. Streamable HTTP allows SSE for
 * long-running tool calls but for v1 we restrict to non-streaming
 * (single JSON response per request). The server-side MCP server is
 * expected to honour this when the request body includes a single
 * call (per the spec's "non-streamable" mode).
 *
 * Tests stub global `fetch` so they're hermetic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  listTools,
  callTool,
  probeHealth,
  isJsonRpcError,
  type McpServerConfig,
  type McpTool,
} from "./mcp-client";

const TEST_URL = "https://example.com/mcp";

function jsonRpcOk<T>(id: number | string, result: T) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result,
  };
}

function jsonRpcErr(
  id: number | string,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message, data },
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listTools", () => {
  it("POSTs a JSON-RPC tools/list request to the server URL", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(jsonRpcOk("req-1", { tools: [] })),
    );

    await listTools({ url: TEST_URL });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TEST_URL);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tools/list");
    expect(typeof body.id).toMatch(/^(string|number)$/);
  });

  it("sets accept + content-type headers correctly", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(jsonRpcOk("x", { tools: [] })),
    );

    await listTools({ url: TEST_URL });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    // MCP Streamable HTTP spec — both JSON and SSE must be advertised
    // so the server can decide on the response type.
    expect(headers.get("accept")).toMatch(/application\/json/);
  });

  it("injects bearer token when configured", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(jsonRpcOk("x", { tools: [] })),
    );
    await listTools({ url: TEST_URL, bearerToken: "abc123" });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer abc123");
  });

  it("forwards additional headers from the config", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(jsonRpcOk("x", { tools: [] })),
    );
    await listTools({
      url: TEST_URL,
      headers: { "x-custom": "value", "x-trace": "trace-1" },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("x-custom")).toBe("value");
    expect(headers.get("x-trace")).toBe("trace-1");
  });

  it("returns the parsed tool array on success", async () => {
    const tools: McpTool[] = [
      {
        name: "search",
        description: "Search documents.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      {
        name: "fetch",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(jsonRpcOk("x", { tools })));

    const result = await listTools({ url: TEST_URL });
    expect(result).toEqual(tools);
  });

  it("accepts a single JSON-RPC message delivered as text/event-stream", async () => {
    const tools: McpTool[] = [
      {
        name: "search_cloudflare_documentation",
        description: "Search Cloudflare docs.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(
        `event: message\ndata: ${JSON.stringify(jsonRpcOk("x", { tools }))}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );

    const result = await listTools({ url: TEST_URL });
    expect(result).toEqual(tools);
  });

  it("throws an McpError on JSON-RPC error responses", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(jsonRpcErr("x", -32601, "Method not found")),
    );

    await expect(listTools({ url: TEST_URL })).rejects.toThrow(
      /Method not found/,
    );
  });

  it("throws on 4xx HTTP responses with the server's body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(listTools({ url: TEST_URL })).rejects.toThrow(/401/);
  });

  it("throws on 5xx HTTP responses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("internal server error", { status: 500 }),
    );
    await expect(listTools({ url: TEST_URL })).rejects.toThrow(/500/);
  });

  it("throws on non-JSON response bodies", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(listTools({ url: TEST_URL })).rejects.toThrow();
  });

  it("throws on malformed JSON-RPC responses (missing result + error)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ jsonrpc: "2.0", id: "x" }),
    );
    await expect(listTools({ url: TEST_URL })).rejects.toThrow();
  });

  it("forwards the AbortSignal to fetch", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(jsonRpcOk("x", { tools: [] })),
    );

    await listTools({ url: TEST_URL }, { signal: controller.signal });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });
});

describe("callTool", () => {
  it("POSTs a tools/call request with name + arguments", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        jsonRpcOk("x", {
          content: [{ type: "text", text: "hello" }],
        }),
      ),
    );

    await callTool(
      { url: TEST_URL },
      "search",
      { query: "Workers Loader" },
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.method).toBe("tools/call");
    expect(body.params).toEqual({
      name: "search",
      arguments: { query: "Workers Loader" },
    });
  });

  it("returns the result object from a successful response", async () => {
    const result = { content: [{ type: "text", text: "done" }] };
    fetchMock.mockResolvedValueOnce(jsonResponse(jsonRpcOk("x", result)));

    const got = await callTool({ url: TEST_URL }, "search", { q: "x" });
    expect(got).toEqual(result);
  });

  it("throws when the server returns a JSON-RPC error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(jsonRpcErr("x", -32602, "Invalid params")),
    );
    await expect(
      callTool({ url: TEST_URL }, "search", { q: "x" }),
    ).rejects.toThrow(/Invalid params/);
  });
});

describe("probeHealth", () => {
  it("returns { ok: true, toolCount } when listTools succeeds", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        jsonRpcOk("x", {
          tools: [
            { name: "a", inputSchema: {} },
            { name: "b", inputSchema: {} },
            { name: "c", inputSchema: {} },
          ],
        }),
      ),
    );

    const result = await probeHealth({ url: TEST_URL });
    expect(result).toEqual({ ok: true, toolCount: 3 });
  });

  it("returns { ok: false, error } when the request fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await probeHealth({ url: TEST_URL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Failed to fetch/);
    }
  });

  it("returns { ok: false, error } when JSON-RPC errors out", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(jsonRpcErr("x", -32601, "Method not found")),
    );

    const result = await probeHealth({ url: TEST_URL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Method not found/);
    }
  });

  it("returns OAuth metadata when the MCP server requires authorization", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "invalid_token",
          error_description: "Missing or invalid access token",
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json",
            "www-authenticate":
              'Bearer realm="OAuth", resource_metadata="https://ai-gateway.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="Missing or invalid access token"',
          },
        },
      ),
    );

    const result = await probeHealth({ url: TEST_URL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/OAuth authorization required/i);
      expect(result.oauthRequired).toBe(true);
      expect(result.resourceMetadataUrl).toBe(
        "https://ai-gateway.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp",
      );
    }
  });

  it("uses a tight timeout that overrides the caller's signal", async () => {
    // Probe should abort quickly to avoid stalling the Settings UI.
    // We can't precisely time-test here, but we can assert the signal
    // forwarded was NOT the caller's (because the helper makes its
    // own AbortController for the timeout).
    const callerSignal = new AbortController().signal;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(jsonRpcOk("x", { tools: [] })),
    );

    await probeHealth({ url: TEST_URL }, { callerSignal });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeDefined();
    expect(init.signal).not.toBe(callerSignal);
  });
});

describe("isJsonRpcError — type guard", () => {
  it("returns true for valid JSON-RPC error responses", () => {
    expect(
      isJsonRpcError({
        jsonrpc: "2.0",
        id: "x",
        error: { code: -32601, message: "Method not found" },
      }),
    ).toBe(true);
  });

  it("returns false for success responses", () => {
    expect(
      isJsonRpcError({
        jsonrpc: "2.0",
        id: "x",
        result: { tools: [] },
      }),
    ).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isJsonRpcError(null)).toBe(false);
    expect(isJsonRpcError(undefined)).toBe(false);
    expect(isJsonRpcError("error")).toBe(false);
    expect(isJsonRpcError([])).toBe(false);
  });
});

describe("McpServerConfig — type shape", () => {
  it("supports all documented fields", () => {
    // Compile-time check via assignment.
    const cfg: McpServerConfig = {
      url: TEST_URL,
      bearerToken: "abc",
      headers: { "x-trace": "t" },
    };
    expect(cfg.url).toBe(TEST_URL);
  });

  it("requires only url", () => {
    const cfg: McpServerConfig = { url: TEST_URL };
    expect(cfg.url).toBe(TEST_URL);
  });
});
