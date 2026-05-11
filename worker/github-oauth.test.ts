/**
 * Unit tests for the GitHub OAuth flow (`worker/github-oauth.ts`).
 *
 * Covers:
 *   - Path matching (returns null for non-OAuth paths).
 *   - Access-gate enforcement on every route.
 *   - `/start` — state token generation + KV storage + 302 to GitHub.
 *   - `/callback` — state validation, single-use semantics, email
 *      binding, code-for-token exchange, user-info lookup, token
 *      storage, redirect back to `returnTo`.
 *   - `/status` — connected vs not-connected branches.
 *   - `/disconnect` — KV delete.
 *   - `sanitiseReturnTo` — open-redirect prevention.
 *   - `getStoredGitHubToken` — exposed helper for the phase-3
 *     `commitPatch` agent tool.
 *
 * The fetch calls to GitHub are stubbed via `vi.stubGlobal("fetch", ...)`
 * so the tests don't depend on the network. The KV namespace is a
 * tiny in-memory mock that supports `get`/`put`/`delete` with TTL
 * acknowledged but not enforced (we don't test expiry-time semantics
 * here — that's a Cloudflare KV concern, not ours).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handleGitHubOAuth,
  getStoredGitHubToken,
  sanitiseReturnTo,
  stateKey,
  tokenKey,
  generateState,
  type GitHubOAuthEnv,
  type StoredGitHubToken,
} from "./github-oauth";

// ── In-memory KV mock ─────────────────────────────────────────────────
//
// Mimics enough of the `KVNamespace` surface for these tests:
// `get(key)`, `put(key, value, { expirationTtl? })`, `delete(key)`,
// and exposes the underlying Map for assertions.
//
// TTL is captured but not enforced — KV's TTL semantics aren't what
// we're testing.

function makeKv(): KVNamespace & { _data: Map<string, string>; _puts: Array<{ key: string; value: string; ttl?: number }> } {
  const data = new Map<string, string>();
  const puts: Array<{ key: string; value: string; ttl?: number }> = [];
  const kv = {
    async get(key: string) {
      return data.has(key) ? (data.get(key) ?? null) : null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      data.set(key, value);
      puts.push({ key, value, ttl: options?.expirationTtl });
    },
    async delete(key: string) {
      data.delete(key);
    },
    _data: data,
    _puts: puts,
  } as unknown as KVNamespace & {
    _data: Map<string, string>;
    _puts: Array<{ key: string; value: string; ttl?: number }>;
  };
  return kv;
}

function makeEnv(overrides: Partial<GitHubOAuthEnv> = {}): GitHubOAuthEnv & {
  GITHUB_TOKENS: ReturnType<typeof makeKv>;
} {
  return {
    GITHUB_TOKENS: makeKv(),
    GITHUB_OAUTH_CLIENT_ID: "test-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
    ...overrides,
  } as GitHubOAuthEnv & { GITHUB_TOKENS: ReturnType<typeof makeKv> };
}

function adminRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", "alice@cloudflare.com");
  return new Request(input, { ...init, headers });
}

function serviceTokenRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  // Service tokens authenticate via the JWT header but have no email.
  headers.set("cf-access-jwt-assertion", "stub.jwt.value");
  return new Request(input, { ...init, headers });
}

function unauthRequest(input: string | URL): Request {
  return new Request(input);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Path matching + Access gate ───────────────────────────────────────

describe("handleGitHubOAuth — routing", () => {
  it("returns null for paths outside /api/admin/auth/github/", async () => {
    const req = new Request("https://example.com/api/admin/decks");
    const res = await handleGitHubOAuth(req, makeEnv());
    expect(res).toBeNull();
  });

  it("returns 403 on every route when the request lacks Access auth", async () => {
    for (const path of [
      "/api/admin/auth/github/start",
      "/api/admin/auth/github/callback",
      "/api/admin/auth/github/status",
      "/api/admin/auth/github/disconnect",
    ]) {
      const req = unauthRequest(`https://example.com${path}`);
      const res = await handleGitHubOAuth(req, makeEnv());
      expect(res).not.toBeNull();
      expect(res!.status).toBe(403);
    }
  });

  it("returns 405 with Allow header when the wrong HTTP method is used", async () => {
    const env = makeEnv();
    const req = adminRequest("https://example.com/api/admin/auth/github/start", {
      method: "POST",
    });
    const res = await handleGitHubOAuth(req, env);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(405);
    expect(res!.headers.get("allow")).toBe("GET");
  });

  it("returns 404 for unknown sub-paths under /api/admin/auth/github/", async () => {
    const env = makeEnv();
    const req = adminRequest("https://example.com/api/admin/auth/github/unknown");
    const res = await handleGitHubOAuth(req, env);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });
});

// ── /start ─────────────────────────────────────────────────────────────

describe("/start", () => {
  it("redirects to GitHub authorize URL with state, client_id, scope, and callback", async () => {
    const env = makeEnv();
    const req = adminRequest(
      "https://slideofhand.lusostreams.com/api/admin/auth/github/start?returnTo=%2Fadmin%2Fdecks%2Fhello",
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(302);
    const location = new URL(res!.headers.get("location")!);
    expect(location.origin).toBe("https://github.com");
    expect(location.pathname).toBe("/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("scope")).toBe("public_repo");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://slideofhand.lusostreams.com/api/admin/auth/github/callback",
    );
    expect(location.searchParams.get("allow_signup")).toBe("false");
  });

  it("stores state in KV with TTL keyed on the email + sanitised returnTo", async () => {
    const env = makeEnv();
    const req = adminRequest(
      "https://slideofhand.lusostreams.com/api/admin/auth/github/start?returnTo=%2Fadmin%2Fdecks%2Fhello%3Fedit%3D1",
    );
    const res = await handleGitHubOAuth(req, env);
    const state = new URL(res!.headers.get("location")!).searchParams.get(
      "state",
    )!;
    const stored = await env.GITHUB_TOKENS.get(stateKey(state));
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as {
      email: string;
      returnTo: string;
      createdAt: number;
    };
    expect(parsed.email).toBe("alice@cloudflare.com");
    expect(parsed.returnTo).toBe("/admin/decks/hello?edit=1");
    expect(parsed.createdAt).toBeGreaterThan(0);
    expect(env.GITHUB_TOKENS._puts[0].ttl).toBe(600);
  });

  it("falls back to /admin when returnTo is absent", async () => {
    const env = makeEnv();
    const req = adminRequest(
      "https://example.com/api/admin/auth/github/start",
    );
    const res = await handleGitHubOAuth(req, env);
    const state = new URL(res!.headers.get("location")!).searchParams.get(
      "state",
    )!;
    const stored = JSON.parse((await env.GITHUB_TOKENS.get(stateKey(state)))!);
    expect(stored.returnTo).toBe("/admin");
  });

  it("rejects a service-token caller (no email to associate)", async () => {
    const env = makeEnv();
    const req = serviceTokenRequest(
      "https://example.com/api/admin/auth/github/start",
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(400);
    const body = await res!.json();
    expect(body).toMatchObject({ error: expect.stringContaining("service-token") });
  });
});

// ── /callback ──────────────────────────────────────────────────────────

describe("/callback", () => {
  function seedState(
    env: ReturnType<typeof makeEnv>,
    state: string,
    overrides: Partial<{ email: string; returnTo: string; createdAt: number }> = {},
  ) {
    return env.GITHUB_TOKENS.put(
      stateKey(state),
      JSON.stringify({
        email: "alice@cloudflare.com",
        returnTo: "/admin",
        createdAt: Date.now(),
        ...overrides,
      }),
      { expirationTtl: 600 },
    );
  }

  function mockGitHubTokenExchange(accessToken = "gho_abc123", scope = "public_repo") {
    return vi.fn(async (input: string, _init?: RequestInit) => {
      if (input === "https://github.com/login/oauth/access_token") {
        return new Response(
          JSON.stringify({ access_token: accessToken, scope, token_type: "bearer" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (input === "https://api.github.com/user") {
        return new Response(
          JSON.stringify({ login: "alice-gh", id: 12345 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
  }

  it("happy path: validates state, exchanges code, stores token, redirects to returnTo", async () => {
    const env = makeEnv();
    const state = "state-happy-path";
    await seedState(env, state, { returnTo: "/admin/decks/hello" });

    const fetchMock = mockGitHubTokenExchange();
    vi.stubGlobal("fetch", fetchMock);

    const req = adminRequest(
      `https://slideofhand.lusostreams.com/api/admin/auth/github/callback?code=abc&state=${state}`,
    );
    const res = await handleGitHubOAuth(req, env);

    expect(res!.status).toBe(302);
    const location = res!.headers.get("location")!;
    expect(location).toContain("/admin/decks/hello");
    expect(location).toContain("github_oauth=connected");

    // State was consumed (single-use).
    expect(await env.GITHUB_TOKENS.get(stateKey(state))).toBeNull();

    // Token stored.
    const stored = await env.GITHUB_TOKENS.get(
      tokenKey("alice@cloudflare.com"),
    );
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as StoredGitHubToken;
    expect(parsed.token).toBe("gho_abc123");
    expect(parsed.username).toBe("alice-gh");
    expect(parsed.userId).toBe(12345);
    expect(parsed.scopes).toEqual(["public_repo"]);
    expect(parsed.connectedAt).toBeGreaterThan(0);

    // Fetch was called with the right shape.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenCall = fetchMock.mock.calls[0];
    expect(tokenCall[0]).toBe("https://github.com/login/oauth/access_token");
    const tokenBody = JSON.parse((tokenCall[1] as RequestInit).body as string);
    expect(tokenBody).toMatchObject({
      client_id: "test-client-id",
      client_secret: "test-client-secret",
      code: "abc",
      redirect_uri:
        "https://slideofhand.lusostreams.com/api/admin/auth/github/callback",
    });
  });

  it("rejects missing state", async () => {
    const env = makeEnv();
    const req = adminRequest(
      "https://example.com/api/admin/auth/github/callback?code=abc",
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(400);
    const body = await res!.json();
    expect(body).toMatchObject({ error: expect.stringContaining("state") });
  });

  it("rejects unknown state (expired or never issued)", async () => {
    const env = makeEnv();
    const req = adminRequest(
      "https://example.com/api/admin/auth/github/callback?code=abc&state=nope",
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(400);
    const body = await res!.json();
    expect(body).toMatchObject({ error: expect.stringContaining("state") });
  });

  it("rejects state issued for a different user (CSRF prevention)", async () => {
    const env = makeEnv();
    const state = "state-different-user";
    await seedState(env, state, { email: "mallory@evil.example" });

    const req = adminRequest(
      `https://example.com/api/admin/auth/github/callback?code=abc&state=${state}`,
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body).toMatchObject({
      error: expect.stringContaining("different user"),
    });
  });

  it("consumes the state token even on the CSRF mismatch path (so it can't be reused)", async () => {
    const env = makeEnv();
    const state = "state-csrf";
    await seedState(env, state, { email: "mallory@evil.example" });

    const req = adminRequest(
      `https://example.com/api/admin/auth/github/callback?code=abc&state=${state}`,
    );
    await handleGitHubOAuth(req, env);
    expect(await env.GITHUB_TOKENS.get(stateKey(state))).toBeNull();
  });

  it("on user-denied (?error=access_denied) redirects to returnTo with denied flag, no token stored", async () => {
    const env = makeEnv();
    const state = "state-denied";
    await seedState(env, state, { returnTo: "/admin/decks/hello" });

    const req = adminRequest(
      `https://example.com/api/admin/auth/github/callback?error=access_denied&state=${state}`,
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toContain("github_oauth=denied");
    // No token stored.
    expect(
      await env.GITHUB_TOKENS.get(tokenKey("alice@cloudflare.com")),
    ).toBeNull();
  });

  it("returns 502 when GitHub token exchange fails (e.g. revoked client_secret)", async () => {
    const env = makeEnv();
    const state = "state-bad-exchange";
    await seedState(env, state);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("invalid_client", { status: 401 }),
      ),
    );

    const req = adminRequest(
      `https://example.com/api/admin/auth/github/callback?code=abc&state=${state}`,
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(502);
  });

  it("returns 502 when GitHub returns an error in the token JSON", async () => {
    const env = makeEnv();
    const state = "state-token-error";
    await seedState(env, state);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "bad_verification_code",
            error_description: "Verification code expired",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const req = adminRequest(
      `https://example.com/api/admin/auth/github/callback?code=abc&state=${state}`,
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(502);
  });

  it("parses comma-separated scopes from the token-exchange response", async () => {
    const env = makeEnv();
    const state = "state-scopes";
    await seedState(env, state);

    vi.stubGlobal("fetch", mockGitHubTokenExchange("gho_xyz", "public_repo,read:user,user:email"));

    const req = adminRequest(
      `https://example.com/api/admin/auth/github/callback?code=abc&state=${state}`,
    );
    await handleGitHubOAuth(req, env);
    const stored = JSON.parse(
      (await env.GITHUB_TOKENS.get(tokenKey("alice@cloudflare.com")))!,
    ) as StoredGitHubToken;
    expect(stored.scopes).toEqual(["public_repo", "read:user", "user:email"]);
  });
});

// ── /status ────────────────────────────────────────────────────────────

describe("/status", () => {
  it("returns { connected: false } when no token is stored", async () => {
    const env = makeEnv();
    const req = adminRequest(
      "https://example.com/api/admin/auth/github/status",
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ connected: false });
  });

  it("returns connected metadata (username, scopes, connectedAt) but NEVER the token", async () => {
    const env = makeEnv();
    const stored: StoredGitHubToken = {
      token: "gho_secret",
      username: "alice-gh",
      userId: 12345,
      scopes: ["public_repo"],
      connectedAt: 1234567890,
    };
    await env.GITHUB_TOKENS.put(
      tokenKey("alice@cloudflare.com"),
      JSON.stringify(stored),
    );

    const req = adminRequest(
      "https://example.com/api/admin/auth/github/status",
    );
    const res = await handleGitHubOAuth(req, env);
    const body = await res!.json();
    expect(body).toEqual({
      connected: true,
      username: "alice-gh",
      userId: 12345,
      scopes: ["public_repo"],
      connectedAt: 1234567890,
    });
    // Defence-in-depth: the token must not appear in the response payload.
    expect(JSON.stringify(body)).not.toContain("gho_secret");
  });

  it("returns { connected: false } for service-token callers (no email)", async () => {
    const env = makeEnv();
    const req = serviceTokenRequest(
      "https://example.com/api/admin/auth/github/status",
    );
    const res = await handleGitHubOAuth(req, env);
    expect(await res!.json()).toEqual({ connected: false });
  });
});

// ── /disconnect ────────────────────────────────────────────────────────

describe("/disconnect", () => {
  it("removes the stored token and returns 200", async () => {
    const env = makeEnv();
    await env.GITHUB_TOKENS.put(
      tokenKey("alice@cloudflare.com"),
      JSON.stringify({
        token: "gho_x",
        username: "a",
        userId: 1,
        scopes: [],
        connectedAt: 0,
      }),
    );

    const req = adminRequest(
      "https://example.com/api/admin/auth/github/disconnect",
      { method: "POST" },
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ disconnected: true });
    expect(
      await env.GITHUB_TOKENS.get(tokenKey("alice@cloudflare.com")),
    ).toBeNull();
  });

  it("rejects service-token callers (no email to disconnect)", async () => {
    const env = makeEnv();
    const req = serviceTokenRequest(
      "https://example.com/api/admin/auth/github/disconnect",
      { method: "POST" },
    );
    const res = await handleGitHubOAuth(req, env);
    expect(res!.status).toBe(400);
  });
});

// ── getStoredGitHubToken (exposed helper for phase-3 commitPatch) ─────

describe("getStoredGitHubToken", () => {
  it("returns null when no record exists", async () => {
    const env = makeEnv();
    const result = await getStoredGitHubToken(env, "missing@example.com");
    expect(result).toBeNull();
  });

  it("returns the parsed token record when present", async () => {
    const env = makeEnv();
    const stored: StoredGitHubToken = {
      token: "gho_x",
      username: "bob",
      userId: 99,
      scopes: ["public_repo"],
      connectedAt: 42,
    };
    await env.GITHUB_TOKENS.put(
      tokenKey("bob@example.com"),
      JSON.stringify(stored),
    );
    const result = await getStoredGitHubToken(env, "bob@example.com");
    expect(result).toEqual(stored);
  });

  it("returns null when the stored value is malformed JSON", async () => {
    const env = makeEnv();
    await env.GITHUB_TOKENS.put(
      tokenKey("corrupt@example.com"),
      "not json",
    );
    const result = await getStoredGitHubToken(env, "corrupt@example.com");
    expect(result).toBeNull();
  });
});

// ── sanitiseReturnTo ──────────────────────────────────────────────────

describe("sanitiseReturnTo", () => {
  it("accepts normal same-origin paths", () => {
    expect(sanitiseReturnTo("/admin")).toBe("/admin");
    expect(sanitiseReturnTo("/admin/decks/hello")).toBe("/admin/decks/hello");
    expect(sanitiseReturnTo("/admin/decks/hello?edit=1")).toBe(
      "/admin/decks/hello?edit=1",
    );
  });

  it("decodes URL-encoded input", () => {
    expect(sanitiseReturnTo("%2Fadmin%2Fdecks%2Fhello%3Fedit%3D1")).toBe(
      "/admin/decks/hello?edit=1",
    );
  });

  it("falls back to /admin on null/undefined input", () => {
    expect(sanitiseReturnTo(null)).toBe("/admin");
  });

  it("rejects protocol-relative URLs (open-redirect prevention)", () => {
    expect(sanitiseReturnTo("//evil.example/admin")).toBe("/admin");
    expect(sanitiseReturnTo("/\\evil.example/admin")).toBe("/admin");
  });

  it("rejects off-site absolute URLs", () => {
    expect(sanitiseReturnTo("https://evil.example/admin")).toBe("/admin");
    expect(sanitiseReturnTo("http://evil.example")).toBe("/admin");
  });

  it("rejects javascript: URIs", () => {
    expect(sanitiseReturnTo("javascript:alert(1)")).toBe("/admin");
  });

  it("rejects relative URLs that don't start with /", () => {
    expect(sanitiseReturnTo("admin")).toBe("/admin");
    expect(sanitiseReturnTo("../etc/passwd")).toBe("/admin");
  });

  it("returns /admin on malformed URL-encoded input", () => {
    expect(sanitiseReturnTo("%E0%A4%A")).toBe("/admin"); // truncated UTF-8
  });

  it("truncates absurdly long paths to 2000 chars", () => {
    const long = "/admin/" + "x".repeat(3000);
    const result = sanitiseReturnTo(long);
    expect(result.length).toBe(2000);
    expect(result.startsWith("/admin/")).toBe(true);
  });
});

// ── generateState ──────────────────────────────────────────────────────

describe("generateState", () => {
  it("returns a UUID-shaped string", () => {
    const s = generateState();
    expect(s).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("returns distinct values across calls (sanity)", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
  });
});
