/**
 * Unit tests for the element-overrides API handlers.
 *
 * KV is mocked with a tiny in-memory Map-backed stub (same pattern as
 * `worker/themes.test.ts`). The handler only ever reads/writes a single
 * key per request, so a deterministic stub is sufficient.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  handleElementOverrides,
  type ElementOverridesEnv,
  type ElementOverride,
} from "./element-overrides";

/**
 * Construct a Request with the `cf-access-authenticated-user-email`
 * header already set, simulating a request that has cleared Cloudflare
 * Access. Used for admin-endpoint tests; for unauthenticated tests use
 * plain `new Request(...)` to verify the 403 path.
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

function makeEnv(): { env: ElementOverridesEnv; kv: FakeKV } {
  const kv = new FakeKV();
  return {
    env: { ELEMENT_OVERRIDES: kv as unknown as KVNamespace },
    kv,
  };
}

/** Asserts the handler owned the path; returns the non-null Response. */
async function call(
  request: Request,
  env: ElementOverridesEnv,
): Promise<Response> {
  const res = await handleElementOverrides(request, env);
  if (!res) {
    throw new Error(
      `handler returned null for ${request.method} ${request.url}`,
    );
  }
  return res;
}

const validOverride: ElementOverride = {
  slideId: "title",
  selector: "h1",
  fingerprint: { tag: "h1", text: "Hello, Slide of Hand" },
  classOverrides: [{ from: "text-7xl", to: "text-8xl" }],
};

const validPayload = { overrides: [validOverride] };

describe("GET /api/element-overrides/<slug>", () => {
  it("returns { overrides: [] } when no record exists for an unknown slug → 200", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/element-overrides/hello"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overrides: unknown[] };
    expect(body.overrides).toEqual([]);
  });

  it("carries Cache-Control: private, max-age=60", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/element-overrides/hello"),
      env,
    );
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).toContain("private");
    expect(cc).toContain("max-age=60");
    // Sanity: must NOT be `public` (see file header for rationale).
    expect(cc).not.toContain("public");
  });

  it("returns the persisted payload when one exists", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "element-overrides:hello",
      JSON.stringify(validPayload),
    );
    const res = await call(
      new Request("https://example.com/api/element-overrides/hello"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overrides: ElementOverride[] };
    expect(body.overrides).toEqual(validPayload.overrides);
  });

  it("rejects an invalid slug with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/element-overrides/Bad..Slug"),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/element-overrides/<slug>", () => {
  it("persists a valid body and a subsequent GET returns it", async () => {
    const { env, kv } = makeEnv();
    const postRes = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "POST",
        body: JSON.stringify(validPayload),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as {
      overrides: ElementOverride[];
    };
    expect(postBody.overrides).toEqual(validPayload.overrides);
    // KV side-effect: the record was actually written under the
    // expected key shape.
    expect(kv.store.has("element-overrides:hello")).toBe(true);

    // Round-trip: a fresh GET sees the persisted payload.
    const getRes = await call(
      new Request("https://example.com/api/element-overrides/hello"),
      env,
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { overrides: ElementOverride[] };
    expect(getBody.overrides).toEqual(validPayload.overrides);
  });

  it("replaces the entire stored array (save-everything semantics)", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "element-overrides:hello",
      JSON.stringify({
        overrides: [
          { ...validOverride, slideId: "old-slide" },
          { ...validOverride, slideId: "another-old" },
        ],
      }),
    );
    const replacement = {
      overrides: [{ ...validOverride, slideId: "fresh-slide" }],
    };
    await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "POST",
        body: JSON.stringify(replacement),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    const stored = JSON.parse(
      kv.store.get("element-overrides:hello")!,
    ) as { overrides: ElementOverride[] };
    expect(stored.overrides).toHaveLength(1);
    expect(stored.overrides[0].slideId).toBe("fresh-slide");
  });

  it("accepts an empty overrides array (used to clear without DELETE)", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "POST",
        body: JSON.stringify({ overrides: [] }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overrides: ElementOverride[] };
    expect(body.overrides).toEqual([]);
  });

  it("rejects malformed JSON with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a body without an `overrides` array with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "POST",
        body: JSON.stringify({ wrongKey: [] }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an override missing required fields with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "POST",
        body: JSON.stringify({
          // Missing classOverrides; should fail validation.
          overrides: [
            {
              slideId: "title",
              selector: "h1",
              fingerprint: { tag: "h1", text: "Hi" },
            },
          ],
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a slideId that is not kebab-case with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "POST",
        body: JSON.stringify({
          overrides: [{ ...validOverride, slideId: "Bad Id With Spaces" }],
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a classOverrides entry missing `from`/`to` with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "POST",
        body: JSON.stringify({
          overrides: [
            {
              ...validOverride,
              classOverrides: [{ from: "text-7xl" }],
            },
          ],
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/element-overrides/<slug>", () => {
  it("removes the persisted record and returns 204", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "element-overrides:hello",
      JSON.stringify(validPayload),
    );
    const res = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(kv.store.has("element-overrides:hello")).toBe(false);
  });

  it("is idempotent — deleting a missing key still returns 204", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(204);
  });
});

describe("Access auth defense-in-depth", () => {
  it("POST returns 403 without cf-access-authenticated-user-email header", async () => {
    const { env, kv } = makeEnv();
    const res = await call(
      // Plain new Request — NO auth header — simulates a request that
      // bypassed Cloudflare Access.
      new Request("https://example.com/api/admin/element-overrides/hello", {
        method: "POST",
        body: JSON.stringify(validPayload),
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

  it("DELETE returns 403 without auth header (and KV is untouched)", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "element-overrides:hello",
      JSON.stringify(validPayload),
    );
    const res = await call(
      new Request("https://example.com/api/admin/element-overrides/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(403);
    // KV must NOT have been deleted.
    expect(kv.store.has("element-overrides:hello")).toBe(true);
  });

  it("public GET still works without auth header", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/element-overrides/hello"),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe("routing", () => {
  let env: ElementOverridesEnv;
  beforeEach(() => {
    env = makeEnv().env;
  });

  it("returns null for non-/api/* paths (handler not responsible)", async () => {
    const res = await handleElementOverrides(
      new Request("https://example.com/decks/hello"),
      env,
    );
    expect(res).toBeNull();
  });

  it("returns null for /api/themes/* paths (handler not responsible)", async () => {
    const res = await handleElementOverrides(
      new Request("https://example.com/api/themes/hello"),
      env,
    );
    expect(res).toBeNull();
  });

  it("returns 405 for GET on the admin write path", async () => {
    const res = await call(
      adminRequest("https://example.com/api/admin/element-overrides/hello"),
      env,
    );
    expect(res.status).toBe(405);
  });

  it("returns 405 for POST on the public read path", async () => {
    const res = await call(
      new Request("https://example.com/api/element-overrides/hello", {
        method: "POST",
      }),
      env,
    );
    expect(res.status).toBe(405);
  });
});
