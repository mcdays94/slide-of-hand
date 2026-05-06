/**
 * Unit tests for the slide-manifest API handlers.
 *
 * KV is mocked with a tiny in-memory Map-backed stub. Mirrors the
 * shape of `worker/themes.test.ts`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { handleManifests, type ManifestsEnv } from "./manifests";

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

function makeEnv(): { env: ManifestsEnv; kv: FakeKV } {
  const kv = new FakeKV();
  return { env: { MANIFESTS: kv as unknown as KVNamespace }, kv };
}

async function call(request: Request, env: ManifestsEnv): Promise<Response> {
  const res = await handleManifests(request, env);
  if (!res) {
    throw new Error(
      `handler returned null for ${request.method} ${request.url}`,
    );
  }
  return res;
}

const validBody = {
  order: ["title", "intro", "middle", "end"],
  overrides: {
    intro: { hidden: true, title: "Renamed", notes: "**bold**" },
  },
};

describe("GET /api/manifests/<slug>", () => {
  it("returns null manifest when no override exists", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/manifests/hello"),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    const body = (await res.json()) as { manifest: unknown };
    expect(body.manifest).toBeNull();
  });

  it("returns the persisted manifest when one exists", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "manifest:hello",
      JSON.stringify({
        version: 1,
        order: validBody.order,
        overrides: validBody.overrides,
        updatedAt: "2026-05-06T12:00:00.000Z",
      }),
    );
    const res = await call(
      new Request("https://example.com/api/manifests/hello"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      manifest: {
        version: number;
        order: string[];
        overrides: Record<string, unknown>;
        updatedAt: string;
      };
    };
    expect(body.manifest.version).toBe(1);
    expect(body.manifest.order).toEqual(validBody.order);
    expect(body.manifest.overrides).toEqual(validBody.overrides);
    expect(body.manifest.updatedAt).toBe("2026-05-06T12:00:00.000Z");
  });

  it("rejects an invalid slug with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/manifests/Bad..Slug"),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/manifests/<slug>", () => {
  it("persists a valid body and returns the saved manifest", async () => {
    const { env, kv } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      manifest: { version: number; order: string[]; updatedAt: string };
    };
    expect(body.manifest.version).toBe(1);
    expect(body.manifest.order).toEqual(validBody.order);
    expect(body.manifest.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const stored = JSON.parse(kv.store.get("manifest:hello")!);
    expect(stored.order).toEqual(validBody.order);
    expect(stored.overrides).toEqual(validBody.overrides);
    expect(stored.version).toBe(1);
  });

  it("accepts an empty overrides object", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello", {
        method: "POST",
        body: JSON.stringify({ order: ["a", "b"], overrides: {} }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("rejects malformed JSON with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a body missing `order` with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello", {
        method: "POST",
        body: JSON.stringify({ overrides: {} }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an order entry that's not kebab-case", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello", {
        method: "POST",
        body: JSON.stringify({ order: ["title", "Bad Slug"], overrides: {} }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects override notes longer than 10000 chars", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello", {
        method: "POST",
        body: JSON.stringify({
          order: ["title"],
          overrides: { title: { notes: "x".repeat(10001) } },
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects override entries with unknown keys", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello", {
        method: "POST",
        body: JSON.stringify({
          order: ["title"],
          overrides: { title: { rogue: 1 } },
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/manifests/<slug>", () => {
  it("removes the persisted manifest and returns 204", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "manifest:hello",
      JSON.stringify({
        version: 1,
        order: ["a"],
        overrides: {},
        updatedAt: "2026-05-06T12:00:00.000Z",
      }),
    );
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(kv.store.has("manifest:hello")).toBe(false);
  });

  it("is idempotent — deleting a missing key still returns 204", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(204);
  });
});

describe("routing", () => {
  let env: ManifestsEnv;
  beforeEach(() => {
    env = makeEnv().env;
  });

  it("returns null for non-/api/* paths (handler not responsible)", async () => {
    const res = await handleManifests(
      new Request("https://example.com/decks/hello"),
      env,
    );
    expect(res).toBeNull();
  });

  it("returns null for the themes API (different handler owns it)", async () => {
    const res = await handleManifests(
      new Request("https://example.com/api/themes/hello"),
      env,
    );
    expect(res).toBeNull();
  });

  it("returns 405 for GET on the admin write path", async () => {
    const res = await call(
      adminRequest("https://example.com/api/admin/manifests/hello"),
      env,
    );
    expect(res.status).toBe(405);
  });

  it("returns 405 for POST on the public read path", async () => {
    const res = await call(
      new Request("https://example.com/api/manifests/hello", {
        method: "POST",
      }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe("Access auth defense-in-depth", () => {
  it("POST /api/admin/manifests/<slug> returns 403 without cf-access-authenticated-user-email header", async () => {
    const { env, kv } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/manifests/hello", {
        method: "POST",
        body: JSON.stringify(validBody),
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Cloudflare Access/i);
    expect(kv.store.size).toBe(0);
  });

  it("DELETE /api/admin/manifests/<slug> returns 403 without auth header", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "manifest:hello",
      JSON.stringify({
        version: 1,
        ...validBody,
        updatedAt: "2026-05-06T12:00:00.000Z",
      }),
    );
    const res = await call(
      new Request("https://example.com/api/admin/manifests/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(kv.store.has("manifest:hello")).toBe(true);
  });

  it("public GET /api/manifests/<slug> still works without auth header", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/manifests/hello"),
      env,
    );
    expect(res.status).toBe(200);
  });
});
