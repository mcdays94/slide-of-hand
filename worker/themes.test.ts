/**
 * Unit tests for the theme API handlers.
 *
 * KV is mocked with a tiny in-memory Map-backed stub. We don't try to
 * exercise Cloudflare's real KV semantics (eventual consistency, etc.) —
 * the handler only needs to read/write a single key, so a deterministic
 * stub is enough to cover its behaviour.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { handleThemes, type ThemesEnv } from "./themes";

/**
 * Construct a Request with the `cf-access-authenticated-user-email` header
 * already set, simulating a request that has cleared Cloudflare Access.
 * Used for admin-endpoint tests; for unauthenticated tests use plain
 * `new Request(...)` to verify the 403 path.
 */
function adminRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", "test@example.com");
  return new Request(input, { ...init, headers });
}

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: "json"): Promise<unknown> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    if (type === "json") return JSON.parse(raw);
    return raw;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeEnv(): { env: ThemesEnv; kv: FakeKV } {
  const kv = new FakeKV();
  return { env: { THEMES: kv as unknown as KVNamespace }, kv };
}

/** Asserts the handler owned the path; returns the non-null Response. */
async function call(request: Request, env: ThemesEnv): Promise<Response> {
  const res = await handleThemes(request, env);
  if (!res) {
    throw new Error(`handler returned null for ${request.method} ${request.url}`);
  }
  return res;
}

const validTokens = {
  "cf-bg-100": "#FFFBF5",
  "cf-text": "#521000",
  "cf-orange": "#FF4801",
  "cf-border": "#E0D3BD",
};

describe("GET /api/themes/<slug>", () => {
  it("returns null tokens when no override exists", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/themes/hello"),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    const body = (await res.json()) as { tokens: unknown; updatedAt: unknown };
    expect(body.tokens).toBeNull();
    expect(body.updatedAt).toBeNull();
  });

  it("returns the persisted override when one exists", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "theme:hello",
      JSON.stringify({
        version: 1,
        tokens: validTokens,
        updatedAt: "2026-05-06T12:00:00.000Z",
      }),
    );
    const res = await call(
      new Request("https://example.com/api/themes/hello"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: unknown; updatedAt: string };
    expect(body.tokens).toEqual(validTokens);
    expect(body.updatedAt).toBe("2026-05-06T12:00:00.000Z");
  });

  it("rejects an invalid slug with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/themes/Bad..Slug"),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/themes/<slug>", () => {
  it("persists a valid body and returns the saved value", async () => {
    const { env, kv } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/themes/hello", {
        method: "POST",
        body: JSON.stringify({ tokens: validTokens }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tokens: typeof validTokens;
      updatedAt: string;
    };
    expect(body.tokens).toEqual(validTokens);
    expect(body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const stored = JSON.parse(kv.store.get("theme:hello")!);
    expect(stored.tokens).toEqual(validTokens);
    expect(stored.version).toBe(1);
  });

  it("rejects a body missing token keys with 400", async () => {
    const { env } = makeEnv();
    const partial = { ...validTokens } as Record<string, string>;
    delete partial["cf-orange"];
    const res = await call(
      adminRequest("https://example.com/api/admin/themes/hello", {
        method: "POST",
        body: JSON.stringify({ tokens: partial }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects extra unknown token keys with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/themes/hello", {
        method: "POST",
        body: JSON.stringify({
          tokens: { ...validTokens, "cf-extra": "#000000" },
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-hex colour values with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/themes/hello", {
        method: "POST",
        body: JSON.stringify({
          tokens: { ...validTokens, "cf-orange": "rebeccapurple" },
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects 3-char hex shorthand with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/themes/hello", {
        method: "POST",
        body: JSON.stringify({
          tokens: { ...validTokens, "cf-orange": "#FFF" },
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/themes/hello", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/themes/<slug>", () => {
  it("removes the persisted override and returns 204", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "theme:hello",
      JSON.stringify({
        version: 1,
        tokens: validTokens,
        updatedAt: "2026-05-06T12:00:00.000Z",
      }),
    );
    const res = await call(
      adminRequest("https://example.com/api/admin/themes/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(kv.store.has("theme:hello")).toBe(false);
  });

  it("is idempotent — deleting a missing key still returns 204", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/themes/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(204);
  });
});

describe("routing", () => {
  let env: ThemesEnv;
  beforeEach(() => {
    env = makeEnv().env;
  });

  it("returns null for non-/api/* paths (handler not responsible)", async () => {
    const res = await handleThemes(
      new Request("https://example.com/decks/hello"),
      env,
    );
    expect(res).toBeNull();
  });

  it("returns 405 for GET on the admin write path", async () => {
    const res = await call(
      adminRequest("https://example.com/api/admin/themes/hello"),
      env,
    );
    expect(res.status).toBe(405);
  });

  it("returns 405 for POST on the public read path", async () => {
    const res = await call(
      new Request("https://example.com/api/themes/hello", {
        method: "POST",
      }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe("Access auth defense-in-depth", () => {
  it("POST /api/admin/themes/<slug> returns 403 without cf-access-authenticated-user-email header", async () => {
    const { env, kv } = makeEnv();
    const res = await call(
      // Plain new Request — NO auth header — simulates a request that
      // bypassed Cloudflare Access (e.g. misconfigured app, direct
      // workers.dev URL not gated, or a spoof attempt).
      new Request("https://example.com/api/admin/themes/hello", {
        method: "POST",
        body: JSON.stringify({ tokens: validTokens }),
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Cloudflare Access/i);
    // KV must NOT have been written.
    expect(kv.store.size).toBe(0);
  });

  it("DELETE /api/admin/themes/<slug> returns 403 without auth header", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "theme:hello",
      JSON.stringify({
        version: 1,
        tokens: validTokens,
        updatedAt: "2026-05-06T12:00:00.000Z",
      }),
    );
    const res = await call(
      new Request("https://example.com/api/admin/themes/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(403);
    // KV must NOT have been deleted.
    expect(kv.store.has("theme:hello")).toBe(true);
  });

  it("public GET /api/themes/<slug> still works without auth header", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/themes/hello"),
      env,
    );
    expect(res.status).toBe(200);
  });
});
