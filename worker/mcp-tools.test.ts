/**
 * Tests for `worker/mcp-tools.ts` — `fetchMcpTools(env, email)` builds
 * an AI SDK tool record from the user's MCP server registry. Wires
 * together the `mcp-client` (transport) and `mcp-servers` (KV-backed
 * registry) modules.
 *
 * The MCP client is mocked so tests don't hit the network. KV is
 * mocked via the same in-memory Map pattern used by mcp-servers tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpTool } from "./mcp-client";

// Mock the MCP client so we control what listTools/callTool return.
const { listToolsMock, callToolMock } = vi.hoisted(() => ({
  listToolsMock: vi.fn(),
  callToolMock: vi.fn(),
}));
vi.mock("./mcp-client", () => ({
  listTools: listToolsMock,
  callTool: callToolMock,
}));

import { fetchMcpTools, type FetchMcpToolsEnv } from "./mcp-tools";

function makeMockKv(seed: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, JSON.stringify(v));
  }
  return {
    async get(key: string, type?: "text" | "json") {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (type === "json") return JSON.parse(raw);
      return raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(seed: Record<string, unknown> = {}): FetchMcpToolsEnv {
  return { MCP_SERVERS: makeMockKv(seed) };
}

beforeEach(() => {
  listToolsMock.mockReset();
  callToolMock.mockReset();
});

describe("fetchMcpTools — basic shape", () => {
  it("returns an empty record when MCP_SERVERS is not bound", async () => {
    const result = await fetchMcpTools({}, "alice@example.com");
    expect(result).toEqual({});
    expect(listToolsMock).not.toHaveBeenCalled();
  });

  it("returns an empty record when the user has no servers", async () => {
    const env = makeEnv();
    const result = await fetchMcpTools(env, "alice@example.com");
    expect(result).toEqual({});
    expect(listToolsMock).not.toHaveBeenCalled();
  });

  it("returns an empty record when the stored value is not an array", async () => {
    const env = makeEnv({ "mcp-servers:alice@example.com": { not: "an array" } });
    const result = await fetchMcpTools(env, "alice@example.com");
    expect(result).toEqual({});
  });
});

describe("fetchMcpTools — happy path", () => {
  it("namespaces each MCP tool by server id to avoid collisions", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "server-A",
          name: "Docs",
          url: "https://a.example.com",
          enabled: true,
        },
      ],
    });
    listToolsMock.mockResolvedValueOnce([
      { name: "search", inputSchema: { type: "object", properties: {} } },
      { name: "fetch", inputSchema: { type: "object", properties: {} } },
    ] satisfies McpTool[]);

    const result = await fetchMcpTools(env, "alice@example.com");

    expect(Object.keys(result).sort()).toEqual([
      "mcp__server-A__fetch",
      "mcp__server-A__search",
    ]);
  });

  it("merges tools from multiple enabled servers", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "A",
          name: "AlphaServer",
          url: "https://a.example.com",
          enabled: true,
        },
        {
          id: "B",
          name: "BetaServer",
          url: "https://b.example.com",
          enabled: true,
        },
      ],
    });
    listToolsMock.mockResolvedValueOnce([
      { name: "one", inputSchema: { type: "object", properties: {} } },
    ]);
    listToolsMock.mockResolvedValueOnce([
      { name: "two", inputSchema: { type: "object", properties: {} } },
    ]);

    const result = await fetchMcpTools(env, "alice@example.com");
    expect(Object.keys(result).sort()).toEqual(["mcp__A__one", "mcp__B__two"]);
  });

  it("skips disabled servers", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "active",
          name: "Active",
          url: "https://active.example.com",
          enabled: true,
        },
        {
          id: "inactive",
          name: "Inactive",
          url: "https://inactive.example.com",
          enabled: false,
        },
      ],
    });
    listToolsMock.mockResolvedValueOnce([
      { name: "x", inputSchema: { type: "object", properties: {} } },
    ]);

    const result = await fetchMcpTools(env, "alice@example.com");
    expect(Object.keys(result)).toEqual(["mcp__active__x"]);
    expect(listToolsMock).toHaveBeenCalledTimes(1);
  });

  it("forwards bearer token + headers when calling listTools", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "S",
          name: "Server",
          url: "https://s.example.com",
          bearerToken: "tok-123",
          headers: { "x-trace": "trace-1" },
          enabled: true,
        },
      ],
    });
    listToolsMock.mockResolvedValueOnce([]);

    await fetchMcpTools(env, "alice@example.com");

    expect(listToolsMock).toHaveBeenCalledWith({
      url: "https://s.example.com",
      bearerToken: "tok-123",
      headers: { "x-trace": "trace-1" },
    });
  });
});

describe("fetchMcpTools — graceful failure", () => {
  it("skips a server that fails to list its tools, without crashing the whole turn", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "broken",
          name: "Broken",
          url: "https://broken.example.com",
          enabled: true,
        },
        {
          id: "working",
          name: "Working",
          url: "https://working.example.com",
          enabled: true,
        },
      ],
    });
    listToolsMock.mockRejectedValueOnce(new Error("network down"));
    listToolsMock.mockResolvedValueOnce([
      { name: "x", inputSchema: { type: "object", properties: {} } },
    ]);

    const result = await fetchMcpTools(env, "alice@example.com");
    expect(Object.keys(result)).toEqual(["mcp__working__x"]);
  });

  it("returns an empty record when ALL servers fail", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "broken-1",
          name: "B1",
          url: "https://b1.example.com",
          enabled: true,
        },
        {
          id: "broken-2",
          name: "B2",
          url: "https://b2.example.com",
          enabled: true,
        },
      ],
    });
    listToolsMock.mockRejectedValue(new Error("network down"));

    const result = await fetchMcpTools(env, "alice@example.com");
    expect(result).toEqual({});
  });
});

describe("fetchMcpTools — tool execute callback", () => {
  it("invokes callTool with the right server config + tool name + args", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "S",
          name: "Server",
          url: "https://s.example.com",
          bearerToken: "tok",
          enabled: true,
        },
      ],
    });
    listToolsMock.mockResolvedValueOnce([
      {
        name: "search",
        description: "Search.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ]);
    callToolMock.mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }] });

    const result = await fetchMcpTools(env, "alice@example.com");
    const searchTool = result["mcp__S__search"];
    expect(searchTool).toBeDefined();
    // AI SDK tool.execute(args, options) — fire it via the documented
    // entry point. The shape of `options` is loose in v6; pass an
    // empty-ish stub.
    const executed = await (searchTool as unknown as {
      execute: (
        args: unknown,
        opts: unknown,
      ) => Promise<unknown>;
    }).execute({ query: "hello" }, { toolCallId: "x", messages: [] });
    expect(executed).toEqual({ content: [{ type: "text", text: "ok" }] });

    expect(callToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://s.example.com",
        bearerToken: "tok",
      }),
      "search",
      { query: "hello" },
    );
  });
});

describe("fetchMcpTools — user isolation", () => {
  it("only reads the calling user's registry key", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "A",
          name: "A",
          url: "https://a.example.com",
          enabled: true,
        },
      ],
      "mcp-servers:bob@example.com": [
        {
          id: "B",
          name: "B",
          url: "https://b.example.com",
          enabled: true,
        },
      ],
    });
    listToolsMock.mockResolvedValueOnce([
      { name: "x", inputSchema: { type: "object", properties: {} } },
    ]);

    const result = await fetchMcpTools(env, "alice@example.com");
    // Alice only sees server A; the listTools call was made for A.
    expect(Object.keys(result)).toEqual(["mcp__A__x"]);
    expect(listToolsMock).toHaveBeenCalledTimes(1);
    expect(listToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://a.example.com" }),
    );
  });
});
