/**
 * Tests for `worker/mcp-servers.ts` — the per-user MCP server CRUD
 * endpoints (issue #168 Wave 6 / Worker C).
 *
 * KV is mocked in-memory so tests can exercise the full CRUD surface
 * without a real binding. The actual `MCP_SERVERS` KV namespace is
 * declared optional on the Env shape — when `wrangler.jsonc` doesn't
 * carry the binding (still true on the current main), the handler
 * returns 503 so dev / preview deploys fail gracefully instead of
 * crashing with `env.MCP_SERVERS is undefined`.
 *
 * The MCP `probeHealth` call (the `:id/health` endpoint) is wired
 * through `worker/mcp-client.ts`; tests mock the client so they don't
 * fire real network requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the MCP client so health probe tests don't hit the network.
const { probeHealthMock } = vi.hoisted(() => ({
  probeHealthMock: vi.fn(),
}));
vi.mock("./mcp-client", () => ({
  probeHealth: probeHealthMock,
}));

import {
  handleMcpServers,
  type McpServersEnv,
  type McpServerRecord,
} from "./mcp-servers";

/**
 * Build a `KVNamespace`-shaped mock backed by an in-memory `Map`. Only
 * the subset of methods the CRUD endpoints actually use is implemented;
 * any other call should throw so contract drift surfaces immediately.
 */
function makeMockKv(seed: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, JSON.stringify(v));
  }
  return {
    store,
    kv: {
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
    } as unknown as KVNamespace,
  };
}

function adminRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", "alice@example.com");
  return new Request(input, { ...init, headers });
}

function adminRequestForUser(
  email: string,
  input: string | URL,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", email);
  return new Request(input, { ...init, headers });
}

function makeEnv(seed: Record<string, unknown> = {}): McpServersEnv {
  return { MCP_SERVERS: makeMockKv(seed).kv };
}

beforeEach(() => {
  probeHealthMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleMcpServers — path matching", () => {
  it("returns null for unrelated paths", async () => {
    const req = adminRequest("https://example.com/api/admin/decks");
    expect(await handleMcpServers(req, makeEnv())).toBeNull();
  });

  it("matches /api/admin/mcp-servers exactly", async () => {
    const req = adminRequest("https://example.com/api/admin/mcp-servers");
    const res = await handleMcpServers(req, makeEnv());
    expect(res).not.toBeNull();
  });

  it("matches /api/admin/mcp-servers/<id> path", async () => {
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/some-id",
    );
    const res = await handleMcpServers(req, makeEnv());
    expect(res).not.toBeNull();
  });

  it("matches /api/admin/mcp-servers/<id>/health path", async () => {
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/some-id/health",
    );
    const res = await handleMcpServers(req, makeEnv());
    expect(res).not.toBeNull();
  });
});

describe("handleMcpServers — auth gate", () => {
  it("returns 403 when no access auth headers are present", async () => {
    const req = new Request("https://example.com/api/admin/mcp-servers");
    const res = await handleMcpServers(req, makeEnv());
    expect(res!.status).toBe(403);
  });

  it("returns 401 when authenticated via service token (no email)", async () => {
    // Service tokens pass requireAccessAuth via the JWT header but
    // have no user identity. The MCP registry is per-user — without
    // an email, there's no scope to operate against. Return 401 so
    // the caller knows auth went through but they're missing user
    // identity (vs 403 which would imply auth failed entirely).
    const req = new Request("https://example.com/api/admin/mcp-servers", {
      headers: { "cf-access-jwt-assertion": "stub-jwt" },
    });
    const res = await handleMcpServers(req, makeEnv());
    expect(res!.status).toBe(401);
  });
});

describe("handleMcpServers — binding gate", () => {
  it("returns 503 when MCP_SERVERS KV is not bound", async () => {
    const req = adminRequest("https://example.com/api/admin/mcp-servers");
    const res = await handleMcpServers(req, {});
    expect(res!.status).toBe(503);
    const body = await res!.json();
    expect((body as { error: string }).error).toMatch(/MCP_SERVERS/);
  });
});

describe("GET /api/admin/mcp-servers — list", () => {
  it("returns an empty array when the user has no servers", async () => {
    const env = makeEnv();
    const req = adminRequest("https://example.com/api/admin/mcp-servers");
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body).toEqual({ servers: [] });
  });

  it("returns the user's servers when they have any", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "srv-1",
          name: "Internal Docs",
          url: "https://mcp.example.com",
          enabled: true,
        },
      ],
    });
    const req = adminRequest("https://example.com/api/admin/mcp-servers");
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { servers: McpServerRecord[] };
    expect(body.servers).toHaveLength(1);
    expect(body.servers[0].name).toBe("Internal Docs");
  });

  it("does not leak bearer tokens in responses", async () => {
    // The server config carries optional secrets — don't echo them
    // back to the UI in list / get responses. The Settings UI shows
    // "***" as a placeholder for an existing token.
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "srv-1",
          name: "Auth'd Server",
          url: "https://mcp.example.com",
          bearerToken: "SECRET-TOKEN-DO-NOT-LEAK",
          enabled: true,
        },
      ],
    });
    const req = adminRequest("https://example.com/api/admin/mcp-servers");
    const res = await handleMcpServers(req, env);
    const text = await res!.text();
    expect(text).not.toContain("SECRET-TOKEN-DO-NOT-LEAK");
    // The list should still indicate auth is configured.
    const body = JSON.parse(text) as {
      servers: Array<McpServerRecord & { hasBearerToken?: boolean }>;
    };
    expect(body.servers[0].hasBearerToken).toBe(true);
  });

  it("isolates servers between users (alice never sees bob's servers)", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "a-1", name: "Alice's", url: "https://a.example.com", enabled: true },
      ],
      "mcp-servers:bob@example.com": [
        { id: "b-1", name: "Bob's", url: "https://b.example.com", enabled: true },
      ],
    });
    const aliceReq = adminRequestForUser(
      "alice@example.com",
      "https://example.com/api/admin/mcp-servers",
    );
    const aliceRes = await handleMcpServers(aliceReq, env);
    const aliceBody = (await aliceRes!.json()) as { servers: McpServerRecord[] };
    expect(aliceBody.servers).toHaveLength(1);
    expect(aliceBody.servers[0].name).toBe("Alice's");
  });
});

describe("POST /api/admin/mcp-servers — add", () => {
  it("creates a new server with a generated id", async () => {
    const env = makeEnv();
    const req = adminRequest("https://example.com/api/admin/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Docs",
        url: "https://mcp.example.com",
        enabled: true,
      }),
    });
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(201);
    const body = (await res!.json()) as { server: McpServerRecord };
    expect(body.server.name).toBe("Docs");
    expect(body.server.id).toBeTruthy();
    expect(body.server.url).toBe("https://mcp.example.com");
  });

  it("rejects requests without a name", async () => {
    const env = makeEnv();
    const req = adminRequest("https://example.com/api/admin/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://mcp.example.com" }),
    });
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(400);
  });

  it("rejects requests without a url", async () => {
    const env = makeEnv();
    const req = adminRequest("https://example.com/api/admin/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(400);
  });

  it("rejects invalid URLs", async () => {
    const env = makeEnv();
    const req = adminRequest("https://example.com/api/admin/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", url: "not a url" }),
    });
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(400);
  });

  it("defaults enabled to true when omitted", async () => {
    const env = makeEnv();
    const req = adminRequest("https://example.com/api/admin/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", url: "https://x.example.com" }),
    });
    const res = await handleMcpServers(req, env);
    const body = (await res!.json()) as { server: McpServerRecord };
    expect(body.server.enabled).toBe(true);
  });

  it("appends to the existing list rather than overwriting", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "existing-1", name: "Existing", url: "https://e.example.com", enabled: true },
      ],
    });
    const req = adminRequest("https://example.com/api/admin/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New", url: "https://n.example.com" }),
    });
    await handleMcpServers(req, env);

    const listReq = adminRequest("https://example.com/api/admin/mcp-servers");
    const listRes = await handleMcpServers(listReq, env);
    const listBody = (await listRes!.json()) as { servers: McpServerRecord[] };
    expect(listBody.servers).toHaveLength(2);
  });
});

describe("PATCH /api/admin/mcp-servers/:id — update", () => {
  it("updates the named fields and leaves the rest alone", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "srv-1",
          name: "Old",
          url: "https://old.example.com",
          enabled: true,
          bearerToken: "preserved",
        },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/srv-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "New Name", enabled: false }),
      },
    );
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { server: McpServerRecord };
    expect(body.server.name).toBe("New Name");
    expect(body.server.enabled).toBe(false);
    expect(body.server.url).toBe("https://old.example.com");
  });

  it("returns 404 for an unknown server id", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "srv-1", name: "x", url: "https://x.example.com", enabled: true },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/unknown",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      },
    );
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(404);
  });

  it("rejects invalid url updates", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "srv-1", name: "x", url: "https://x.example.com", enabled: true },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/srv-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "not a url" }),
      },
    );
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(400);
  });
});

describe("DELETE /api/admin/mcp-servers/:id", () => {
  it("removes the server from the user's list", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "srv-1", name: "x", url: "https://x.example.com", enabled: true },
        { id: "srv-2", name: "y", url: "https://y.example.com", enabled: true },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/srv-1",
      { method: "DELETE" },
    );
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(200);

    const listReq = adminRequest("https://example.com/api/admin/mcp-servers");
    const listRes = await handleMcpServers(listReq, env);
    const body = (await listRes!.json()) as { servers: McpServerRecord[] };
    expect(body.servers).toHaveLength(1);
    expect(body.servers[0].id).toBe("srv-2");
  });

  it("returns 404 for an unknown server id", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "srv-1", name: "x", url: "https://x.example.com", enabled: true },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/unknown",
      { method: "DELETE" },
    );
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(404);
  });
});

describe("GET /api/admin/mcp-servers/:id/health", () => {
  it("probes the server and returns the health result", async () => {
    probeHealthMock.mockResolvedValueOnce({ ok: true, toolCount: 5 });
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "srv-1",
          name: "x",
          url: "https://x.example.com",
          bearerToken: "tok",
          enabled: true,
        },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/srv-1/health",
    );
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body).toEqual({ ok: true, toolCount: 5 });

    // The probe is given the server's URL + bearer token from KV.
    expect(probeHealthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://x.example.com",
        bearerToken: "tok",
      }),
    );
  });

  it("returns the failure payload when the probe errors", async () => {
    probeHealthMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "srv-1", name: "x", url: "https://x.example.com", enabled: true },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/srv-1/health",
    );
    const res = await handleMcpServers(req, env);
    // 200 with body.ok=false — the probe ran fine, the server is sick.
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("boom");
  });

  it("returns 404 for an unknown server id", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "srv-1", name: "x", url: "https://x.example.com", enabled: true },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/unknown/health",
    );
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(404);
    expect(probeHealthMock).not.toHaveBeenCalled();
  });
});

describe("MCP OAuth flow", () => {
  it("starts OAuth by discovering metadata, registering a client, and returning an auth URL", async () => {
    probeHealthMock.mockResolvedValueOnce({
      ok: false,
      error: "OAuth authorization required.",
      oauthRequired: true,
      resourceMetadataUrl:
        "https://ai-gateway.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resource: "https://ai-gateway.mcp.cloudflare.com/mcp",
            authorization_servers: ["https://ai-gateway.mcp.cloudflare.com"],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint:
              "https://ai-gateway.mcp.cloudflare.com/oauth/authorize",
            token_endpoint: "https://ai-gateway.mcp.cloudflare.com/token",
            registration_endpoint: "https://ai-gateway.mcp.cloudflare.com/register",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ client_id: "client-123" }), {
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        {
          id: "srv-1",
          name: "AI Gateway",
          url: "https://ai-gateway.mcp.cloudflare.com/mcp",
          enabled: true,
        },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/srv-1/oauth/start",
      { method: "POST" },
    );

    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { ok: boolean; authUrl: string };
    expect(body.ok).toBe(true);
    const authUrl = new URL(body.authUrl);
    expect(authUrl.origin).toBe("https://ai-gateway.mcp.cloudflare.com");
    expect(authUrl.pathname).toBe("/oauth/authorize");
    expect(authUrl.searchParams.get("client_id")).toBe("client-123");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "https://example.com/api/admin/mcp-servers/oauth/callback",
    );
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("resource")).toBe(
      "https://ai-gateway.mcp.cloudflare.com/mcp",
    );
  });

  it("stores the OAuth access token on callback and clears the temporary state", async () => {
    const state = "state-123";
    const { kv, store } = makeMockKv({
      "mcp-servers:alice@example.com": [
        {
          id: "srv-1",
          name: "AI Gateway",
          url: "https://ai-gateway.mcp.cloudflare.com/mcp",
          enabled: true,
        },
      ],
      [`mcp-oauth-state:${state}`]: {
        email: "alice@example.com",
        serverId: "srv-1",
        clientId: "client-123",
        codeVerifier: "verifier-123",
        redirectUri: "https://example.com/api/admin/mcp-servers/oauth/callback",
        tokenEndpoint: "https://ai-gateway.mcp.cloudflare.com/token",
        resource: "https://ai-gateway.mcp.cloudflare.com/mcp",
      },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "access-token-123" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = adminRequest(
      `https://example.com/api/admin/mcp-servers/oauth/callback?state=${state}&code=code-123`,
    );
    const res = await handleMcpServers(req, { MCP_SERVERS: kv });

    expect(res!.status).toBe(200);
    const records = JSON.parse(
      store.get("mcp-servers:alice@example.com")!,
    ) as McpServerRecord[];
    expect(records[0].bearerToken).toBe("access-token-123");
    expect(store.has(`mcp-oauth-state:${state}`)).toBe(false);
    const tokenBody = fetchMock.mock.calls[0][1].body as string;
    expect(tokenBody).toContain("code=code-123");
    expect(tokenBody).toContain("code_verifier=verifier-123");
  });
});

describe("method gates", () => {
  it("rejects unsupported methods on the collection path with 405", async () => {
    const req = adminRequest("https://example.com/api/admin/mcp-servers", {
      method: "PUT",
    });
    const res = await handleMcpServers(req, makeEnv());
    expect(res!.status).toBe(405);
  });

  it("rejects POST on the item path", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "srv-1", name: "x", url: "https://x.example.com", enabled: true },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/srv-1",
      { method: "POST" },
    );
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(405);
  });

  it("rejects POST on the health path", async () => {
    const env = makeEnv({
      "mcp-servers:alice@example.com": [
        { id: "srv-1", name: "x", url: "https://x.example.com", enabled: true },
      ],
    });
    const req = adminRequest(
      "https://example.com/api/admin/mcp-servers/srv-1/health",
      { method: "POST" },
    );
    const res = await handleMcpServers(req, env);
    expect(res!.status).toBe(405);
  });
});
