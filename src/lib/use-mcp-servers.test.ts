/**
 * Tests for `useMcpServers` — the React hook backing the Settings
 * modal's MCP servers section (issue #168 Wave 6 / Worker C).
 *
 * Mocks global `fetch` so tests are hermetic. Renders the hook
 * standalone via `renderHook` from @testing-library/react.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useMcpServers } from "./use-mcp-servers";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("useMcpServers — initial load", () => {
  it("starts in loading state and fetches the list", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ servers: [{ id: "a", name: "Alpha", url: "https://a.example.com", enabled: true }] }),
    );

    const { result } = renderHook(() => useMcpServers());
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.servers).toHaveLength(1);
    expect(result.current.servers[0].name).toBe("Alpha");
    expect(result.current.error).toBeNull();
  });

  it("sets error + empty list on 503 (binding missing)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error: "MCP_SERVERS not bound" }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );

    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.servers).toHaveLength(0);
    expect(result.current.error).toMatch(/MCP_SERVERS/);
  });

  it("surfaces network errors", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch(/Failed to fetch/);
  });
});

describe("useMcpServers — addServer", () => {
  it("posts to the endpoint and appends to local state on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ servers: [] }));
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const newServer = {
      id: "new-id",
      name: "Docs",
      url: "https://docs.example.com",
      enabled: true,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ server: newServer }, { status: 201 }));

    let addResult: Awaited<ReturnType<typeof result.current.addServer>>;
    await act(async () => {
      addResult = await result.current.addServer({
        name: "Docs",
        url: "https://docs.example.com",
      });
    });
    expect(addResult!.ok).toBe(true);
    expect(addResult!.server?.name).toBe("Docs");
    expect(result.current.servers).toHaveLength(1);
    expect(result.current.servers[0].name).toBe("Docs");

    // The POST body should include the name + url.
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init.body);
    expect(body).toEqual({ name: "Docs", url: "https://docs.example.com" });
  });

  it("returns the server's error message on 400 validation failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ servers: [] }));
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, errors: ["`url` is required."] }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    let addResult: Awaited<ReturnType<typeof result.current.addServer>>;
    await act(async () => {
      addResult = await result.current.addServer({
        name: "x",
        url: "",
      });
    });
    expect(addResult!.ok).toBe(false);
    expect(addResult!.error).toMatch(/url.*required/i);
  });
});

describe("useMcpServers — deleteServer", () => {
  it("removes the server from local state on success", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        servers: [
          { id: "a", name: "Alpha", url: "https://a.example.com", enabled: true },
          { id: "b", name: "Beta", url: "https://b.example.com", enabled: true },
        ],
      }),
    );
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.servers.length).toBe(2));

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, deleted: "a" }));
    await act(async () => {
      await result.current.deleteServer("a");
    });
    expect(result.current.servers).toHaveLength(1);
    expect(result.current.servers[0].id).toBe("b");
  });

  it("returns error and does not mutate state on 404", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        servers: [
          { id: "a", name: "Alpha", url: "https://a.example.com", enabled: true },
        ],
      }),
    );
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.servers.length).toBe(1));

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    let deleteResult: Awaited<ReturnType<typeof result.current.deleteServer>>;
    await act(async () => {
      deleteResult = await result.current.deleteServer("unknown");
    });
    expect(deleteResult!.ok).toBe(false);
    expect(result.current.servers).toHaveLength(1);
  });
});

describe("useMcpServers — probeHealth", () => {
  it("returns the health result on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ servers: [] }));
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, toolCount: 5 }));
    let healthResult: Awaited<ReturnType<typeof result.current.probeHealth>>;
    await act(async () => {
      healthResult = await result.current.probeHealth("id");
    });
    expect(healthResult!).toEqual({ ok: true, toolCount: 5 });
  });

  it("returns a failure result on 5xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ servers: [] }));
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "boom" }), {
        status: 500,
      }),
    );
    let healthResult: Awaited<ReturnType<typeof result.current.probeHealth>>;
    await act(async () => {
      healthResult = await result.current.probeHealth("id");
    });
    expect(healthResult!.ok).toBe(false);
    expect(healthResult!.error).toMatch(/boom/);
  });

  it("returns OAuth-required probe details", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ servers: [] }));
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: false,
        error: "OAuth authorization required.",
        oauthRequired: true,
        resourceMetadataUrl:
          "https://ai-gateway.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp",
      }),
    );
    let healthResult: Awaited<ReturnType<typeof result.current.probeHealth>>;
    await act(async () => {
      healthResult = await result.current.probeHealth("id");
    });

    expect(healthResult!.ok).toBe(false);
    expect(healthResult!.oauthRequired).toBe(true);
    expect(healthResult!.resourceMetadataUrl).toContain("oauth-protected-resource");
  });

  it("starts an OAuth flow and returns the authorization URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ servers: [] }));
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        authUrl: "https://ai-gateway.mcp.cloudflare.com/oauth/authorize?state=abc",
      }),
    );

    let startResult: Awaited<ReturnType<typeof result.current.startOAuth>>;
    await act(async () => {
      startResult = await result.current.startOAuth("id");
    });

    expect(startResult!).toEqual({
      ok: true,
      authUrl: "https://ai-gateway.mcp.cloudflare.com/oauth/authorize?state=abc",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/admin/mcp-servers/id/oauth/start",
    );
  });
});
