/**
 * Unit tests for the pending source action API (issue #246 / PRD #242).
 *
 * Mirrors `worker/decks.test.ts` for the KV mock + admin-request
 * helpers. Covers:
 *
 *   - Access gating on all three endpoints.
 *   - Body / slug / action / prUrl / expectedState validation on POST.
 *   - Round-trip create → list → clear.
 *   - Idempotent clear (no-op on missing slug).
 *   - List returns every persisted record.
 *
 * The shared store mocks live below in `FakeKV`; the handler reads /
 * writes both the `pending-source-action:<slug>` records and the
 * `pending-source-actions-list` index, so the FakeKV must support both.
 */

import { describe, it, expect } from "vitest";
import {
  handlePendingSourceActions,
  type PendingSourceActionsEnv,
} from "./pending-source-actions";

/** Construct a Request that has cleared Cloudflare Access. */
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

function makeEnv(): { env: PendingSourceActionsEnv; kv: FakeKV } {
  const kv = new FakeKV();
  return { env: { DECKS: kv as unknown as KVNamespace }, kv };
}

async function call(
  request: Request,
  env: PendingSourceActionsEnv,
): Promise<Response> {
  const res = await handlePendingSourceActions(request, env);
  if (!res) {
    throw new Error(
      `handler returned null for ${request.method} ${request.url}`,
    );
  }
  return res;
}

const PR_URL = "https://github.com/mcdays94/slide-of-hand/pull/123";
const PR_URL_2 = "https://github.com/mcdays94/slide-of-hand/pull/124";

function archivePayload(slug: string, prUrl: string = PR_URL) {
  return {
    slug,
    action: "archive",
    prUrl,
    expectedState: "archived",
  };
}

// ---------------------------------------------------------------- //
// Access gating
// ---------------------------------------------------------------- //

describe("/api/admin/deck-source-actions — Access gating", () => {
  it("GET list without Access header returns 403", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/deck-source-actions"),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("POST item without Access header returns 403", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/deck-source-actions/hello", {
        method: "POST",
        body: JSON.stringify(archivePayload("hello")),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("DELETE item without Access header returns 403", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/deck-source-actions/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------- //
// GET list
// ---------------------------------------------------------------- //

describe("GET /api/admin/deck-source-actions", () => {
  it("returns { actions: [] } when none exist", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/deck-source-actions"),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { actions: unknown[] };
    expect(body.actions).toEqual([]);
  });

  it("returns every persisted record", async () => {
    const { env } = makeEnv();
    // Seed two records via POST so the index stays in sync.
    await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify(archivePayload("hello")),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/world",
        {
          method: "POST",
          body: JSON.stringify({
            slug: "world",
            action: "restore",
            prUrl: PR_URL_2,
            expectedState: "active",
          }),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    const res = await call(
      adminRequest("https://example.com/api/admin/deck-source-actions"),
      env,
    );
    const body = (await res.json()) as {
      actions: Array<{ slug: string; action: string; expectedState: string }>;
    };
    expect(body.actions).toHaveLength(2);
    const bySlug = new Map(body.actions.map((a) => [a.slug, a]));
    expect(bySlug.get("hello")?.action).toBe("archive");
    expect(bySlug.get("hello")?.expectedState).toBe("archived");
    expect(bySlug.get("world")?.action).toBe("restore");
    expect(bySlug.get("world")?.expectedState).toBe("active");
  });

  it("405s on a non-GET method", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/deck-source-actions", {
        method: "POST",
      }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------- //
// POST upsert validation
// ---------------------------------------------------------------- //

describe("POST /api/admin/deck-source-actions/<slug> — validation", () => {
  it("400s on invalid JSON body", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: "not-json",
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400s on invalid slug in URL", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/Not-A-Slug",
        {
          method: "POST",
          body: JSON.stringify(archivePayload("Not-A-Slug")),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400s when slug in body does not match URL slug", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify(archivePayload("world")),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/slug/i);
  });

  it("400s on an unknown action", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify({
            slug: "hello",
            action: "explode",
            prUrl: PR_URL,
            expectedState: "active",
          }),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400s on a non-http prUrl", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify({
            slug: "hello",
            action: "archive",
            prUrl: "javascript:alert(1)",
            expectedState: "archived",
          }),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400s on a missing expectedState", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify({
            slug: "hello",
            action: "archive",
            prUrl: PR_URL,
          }),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400s on an unknown expectedState", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify({
            slug: "hello",
            action: "archive",
            prUrl: PR_URL,
            expectedState: "pending-cleanup",
          }),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------- //
// POST upsert round-trip
// ---------------------------------------------------------------- //

describe("POST /api/admin/deck-source-actions/<slug> — round-trip", () => {
  it("persists the record and surfaces it in the list endpoint", async () => {
    const { env, kv } = makeEnv();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify(archivePayload("hello")),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slug: string; action: string };
    expect(body.slug).toBe("hello");
    expect(body.action).toBe("archive");
    // KV check: per-slug record AND the index list both updated.
    expect(kv.store.get("pending-source-action:hello")).toBeDefined();
    expect(kv.store.get("pending-source-actions-list")).toBeDefined();
    expect(
      JSON.parse(kv.store.get("pending-source-actions-list")!),
    ).toEqual(["hello"]);

    const listRes = await call(
      adminRequest("https://example.com/api/admin/deck-source-actions"),
      env,
    );
    const list = (await listRes.json()) as { actions: Array<{ slug: string }> };
    expect(list.actions).toHaveLength(1);
    expect(list.actions[0].slug).toBe("hello");
  });

  it("server-generates createdAt when omitted from the body", async () => {
    const { env } = makeEnv();
    const before = Date.now();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify(archivePayload("hello")),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    const body = (await res.json()) as { createdAt: string };
    expect(typeof body.createdAt).toBe("string");
    const parsed = Date.parse(body.createdAt);
    expect(Number.isFinite(parsed)).toBe(true);
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
  });

  it("POST overwrites an existing record for the same slug", async () => {
    const { env, kv } = makeEnv();
    await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify(archivePayload("hello")),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify({
            slug: "hello",
            action: "delete",
            prUrl: PR_URL_2,
            expectedState: "deleted",
          }),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    const stored = JSON.parse(
      kv.store.get("pending-source-action:hello")!,
    ) as { action: string; prUrl: string };
    expect(stored.action).toBe("delete");
    expect(stored.prUrl).toBe(PR_URL_2);
    // Index must still be a single entry — no duplicate slug.
    expect(
      JSON.parse(kv.store.get("pending-source-actions-list")!),
    ).toEqual(["hello"]);
  });
});

// ---------------------------------------------------------------- //
// DELETE clear
// ---------------------------------------------------------------- //

describe("DELETE /api/admin/deck-source-actions/<slug>", () => {
  it("removes the record and the index entry", async () => {
    const { env, kv } = makeEnv();
    await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify(archivePayload("hello")),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        { method: "DELETE" },
      ),
      env,
    );
    expect(res.status).toBe(204);
    expect(kv.store.get("pending-source-action:hello")).toBeUndefined();
    expect(
      JSON.parse(kv.store.get("pending-source-actions-list")!),
    ).toEqual([]);
  });

  it("is idempotent (204 on a missing slug)", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/never-existed",
        { method: "DELETE" },
      ),
      env,
    );
    expect(res.status).toBe(204);
  });

  it("does NOT touch other slugs' records", async () => {
    const { env, kv } = makeEnv();
    await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        {
          method: "POST",
          body: JSON.stringify(archivePayload("hello")),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/world",
        {
          method: "POST",
          body: JSON.stringify({
            slug: "world",
            action: "restore",
            prUrl: PR_URL_2,
            expectedState: "active",
          }),
          headers: { "content-type": "application/json" },
        },
      ),
      env,
    );
    await call(
      adminRequest(
        "https://example.com/api/admin/deck-source-actions/hello",
        { method: "DELETE" },
      ),
      env,
    );
    expect(kv.store.get("pending-source-action:hello")).toBeUndefined();
    expect(kv.store.get("pending-source-action:world")).toBeDefined();
    expect(
      JSON.parse(kv.store.get("pending-source-actions-list")!),
    ).toEqual(["world"]);
  });
});

// ---------------------------------------------------------------- //
// Path coverage
// ---------------------------------------------------------------- //

describe("handlePendingSourceActions — path coverage", () => {
  it("returns null for unrelated paths so the caller can fall through", async () => {
    const { env } = makeEnv();
    const res = await handlePendingSourceActions(
      new Request("https://example.com/api/themes/hello"),
      env,
    );
    expect(res).toBeNull();
  });
});
