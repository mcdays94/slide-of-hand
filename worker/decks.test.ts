/**
 * Unit tests for the decks API handlers (issue #57 / Deck Creator Slice 1).
 *
 * KV is mocked with a tiny in-memory Map-backed stub. Mirrors the shape of
 * `worker/themes.test.ts` — see that file for the rationale on not
 * exercising real CF KV semantics here.
 *
 * The handler owns:
 *   - `GET    /api/decks`              (public list, public-only)
 *   - `GET    /api/decks/<slug>`       (public read, 404 for private)
 *   - `GET    /api/admin/decks`        (admin list, all decks)
 *   - `POST   /api/admin/decks/<slug>` (admin upsert + index update)
 *   - `DELETE /api/admin/decks/<slug>` (admin delete + index update)
 */
import { describe, it, expect } from "vitest";
import { handleDecks, type DecksEnv } from "./decks";

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

function makeEnv(): { env: DecksEnv; kv: FakeKV } {
  const kv = new FakeKV();
  return { env: { DECKS: kv as unknown as KVNamespace }, kv };
}

async function call(request: Request, env: DecksEnv): Promise<Response> {
  const res = await handleDecks(request, env);
  if (!res) {
    throw new Error(`handler returned null for ${request.method} ${request.url}`);
  }
  return res;
}

/** Build a minimum-valid DataDeck for a given slug + visibility. */
function makeDeck(
  slug: string,
  visibility: "public" | "private" = "public",
  overrides: Record<string, unknown> = {},
) {
  return {
    meta: {
      slug,
      title: `Deck ${slug}`,
      description: `Description for ${slug}`,
      date: "2026-05-07",
      visibility,
      runtimeMinutes: 20,
      ...overrides,
    },
    slides: [
      {
        id: "intro",
        template: "cover",
        slots: {
          title: { kind: "text", value: "Hello" },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------- //
// GET /api/decks (public list)
// ---------------------------------------------------------------- //

describe("GET /api/decks", () => {
  it("returns { decks: [] } when the index is empty", async () => {
    const { env } = makeEnv();
    const res = await call(new Request("https://example.com/api/decks"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    const body = (await res.json()) as { decks: unknown[] };
    expect(body.decks).toEqual([]);
  });

  it("returns only public decks (private decks must not leak)", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "decks-list",
      JSON.stringify([
        {
          slug: "public-one",
          title: "Public One",
          description: "",
          date: "2026-05-07",
          visibility: "public",
        },
        {
          slug: "secret-deck",
          title: "Secret Deck",
          description: "",
          date: "2026-05-07",
          visibility: "private",
        },
        {
          slug: "public-two",
          title: "Public Two",
          description: "",
          date: "2026-05-07",
          visibility: "public",
        },
      ]),
    );
    const res = await call(new Request("https://example.com/api/decks"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decks: Array<{ slug: string }> };
    expect(body.decks.map((d) => d.slug).sort()).toEqual([
      "public-one",
      "public-two",
    ]);
    // Even the existence of the private deck must not leak.
    expect(JSON.stringify(body)).not.toContain("secret-deck");
  });
});

// ---------------------------------------------------------------- //
// GET /api/decks/<slug> (public read)
// ---------------------------------------------------------------- //

describe("GET /api/decks/<slug>", () => {
  it("returns 404 when the deck does not exist", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/decks/missing"),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the deck is private (no leak)", async () => {
    const { env, kv } = makeEnv();
    await kv.put("deck:secret", JSON.stringify(makeDeck("secret", "private")));
    const res = await call(
      new Request("https://example.com/api/decks/secret"),
      env,
    );
    expect(res.status).toBe(404);
    // Body must not echo any meta from the private deck.
    const text = await res.text();
    expect(text).not.toContain("Deck secret");
  });

  it("returns the full DataDeck for a public deck", async () => {
    const { env, kv } = makeEnv();
    const deck = makeDeck("hello", "public");
    await kv.put("deck:hello", JSON.stringify(deck));
    const res = await call(
      new Request("https://example.com/api/decks/hello"),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    const body = (await res.json()) as { meta: { slug: string }; slides: unknown[] };
    expect(body.meta.slug).toBe("hello");
    expect(body.slides).toHaveLength(1);
  });

  it("rejects an invalid slug with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/decks/Bad..Slug"),
      env,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------- //
// GET /api/admin/decks (admin list — all decks)
// ---------------------------------------------------------------- //

describe("GET /api/admin/decks", () => {
  it("rejects without cf-access-authenticated-user-email with 403", async () => {
    const { env, kv } = makeEnv();
    await kv.put("decks-list", JSON.stringify([]));
    const res = await call(
      new Request("https://example.com/api/admin/decks"),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("returns all decks (public + private) when authenticated", async () => {
    const { env, kv } = makeEnv();
    await kv.put(
      "decks-list",
      JSON.stringify([
        {
          slug: "pub",
          title: "Pub",
          description: "",
          date: "2026-05-07",
          visibility: "public",
        },
        {
          slug: "priv",
          title: "Priv",
          description: "",
          date: "2026-05-07",
          visibility: "private",
        },
      ]),
    );
    const res = await call(
      adminRequest("https://example.com/api/admin/decks"),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { decks: Array<{ slug: string }> };
    expect(body.decks.map((d) => d.slug).sort()).toEqual(["priv", "pub"]);
  });

  it("returns { decks: [] } when no decks exist", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/decks"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decks: unknown[] };
    expect(body.decks).toEqual([]);
  });
});

// ---------------------------------------------------------------- //
// POST /api/admin/decks/<slug> (upsert)
// ---------------------------------------------------------------- //

describe("POST /api/admin/decks/<slug>", () => {
  it("rejects without auth header with 403", async () => {
    const { env, kv } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(makeDeck("hello")),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(kv.store.size).toBe(0);
  });

  it("rejects malformed JSON with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("persists a valid deck and returns 200", async () => {
    const { env, kv } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(makeDeck("hello")),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const stored = JSON.parse(kv.store.get("deck:hello")!);
    expect(stored.meta.slug).toBe("hello");
    expect(stored.slides).toHaveLength(1);
  });

  it("updates the decks-list index atomically with the deck record", async () => {
    const { env, kv } = makeEnv();
    await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(makeDeck("hello", "public")),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    const list = JSON.parse(kv.store.get("decks-list")!);
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe("hello");
    expect(list[0].title).toBe("Deck hello");
    expect(list[0].visibility).toBe("public");
    // Summary must NOT include slide / slot data.
    expect(list[0].slides).toBeUndefined();
    expect(list[0].slots).toBeUndefined();
  });

  it("replaces an existing entry in the decks-list index (no duplicates)", async () => {
    const { env, kv } = makeEnv();
    await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(makeDeck("hello", "public", { title: "First" })),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(makeDeck("hello", "private", { title: "Second" })),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    const list = JSON.parse(kv.store.get("decks-list")!) as Array<
      Record<string, unknown>
    >;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Second");
    expect(list[0].visibility).toBe("private");
  });

  it("rejects when meta.slug does not match the URL slug with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(makeDeck("other")),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid visibility value with 400", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.meta.visibility = "secret" as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects when slides is not an array with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify({
          meta: makeDeck("hello").meta,
          slides: "not-an-array",
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an unknown slot kind with 400", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.slides[0].slots = {
      mystery: { kind: "wat", value: "x" } as never,
    } as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an `image` slot missing required `alt` with 400", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.slides[0].slots = {
      hero: { kind: "image", src: "/x.png" } as never,
    } as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a `code` slot missing `lang` with 400", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.slides[0].slots = {
      block: { kind: "code", value: "console.log(1)" } as never,
    } as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a `list` slot whose items are not strings with 400", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.slides[0].slots = {
      bullets: { kind: "list", items: [1, 2, 3] } as never,
    } as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("accepts every documented slot kind with full required fields", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.slides[0].slots = {
      t: { kind: "text", value: "hi", revealAt: 0 },
      r: { kind: "richtext", value: "**bold**", revealAt: 1 },
      i: { kind: "image", src: "/x.png", alt: "x" },
      c: { kind: "code", lang: "ts", value: "1" },
      l: { kind: "list", items: ["a", "b"] },
      s: { kind: "stat", value: "99%", caption: "ok" },
    } as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("rejects a non-string slot revealAt with 400", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.slides[0].slots = {
      t: { kind: "text", value: "hi", revealAt: "soon" } as never,
    } as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  // ── Divergence locked in by the validateDataDeck cutover (#57 follow-up) //
  // The shared validator is stricter than the original inline pre-#59
  // version on a few axes. These tests pin the new behaviour so a future
  // refactor of `deck-record.ts` cannot silently weaken the Worker's
  // input contract.

  it("rejects a meta.slug that is not kebab-case with 400", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("Bad-Slug");
    deck.meta.slug = "Bad_Slug";
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/Bad_Slug", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    // The 400 short-circuits at the route slug check OR at validation;
    // either way we expect not-2xx.
    expect(res.status).toBe(400);
  });

  it("rejects a meta.date that is not ISO YYYY-MM-DD with 400", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.meta.date = "yesterday";
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a slide.layout that is not one of the canonical Layout values", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.slides[0] = {
      ...deck.slides[0],
      layout: "wat",
    } as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate slide id within the same deck with 400", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.slides = [
      { id: "intro", template: "cover", slots: { title: { kind: "text", value: "a" } } },
      { id: "intro", template: "cover", slots: { title: { kind: "text", value: "b" } } },
    ];
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-integer revealAt with 400 (stricter than original inline)", async () => {
    const { env } = makeEnv();
    const deck = makeDeck("hello");
    deck.slides[0].slots = {
      t: { kind: "text", value: "hi", revealAt: 1.5 } as never,
    } as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  // ─────────────────────────────────────────────────────────────────
  // Issue #93 — surface ALL validation errors[] on the wire, not just
  // errors[0]. The single `error` field is kept as a back-compat
  // alias (= errors[0]) so existing clients don't break.
  // ─────────────────────────────────────────────────────────────────

  it("returns the full errors[] array when multiple validations fail (#93)", async () => {
    const { env } = makeEnv();
    // Deck with TWO simultaneous shape errors:
    //   1. meta.title is empty (violates non-empty string)
    //   2. slides[0].slots has an `image` slot missing required `alt`
    const deck = makeDeck("hello");
    deck.meta.title = "";
    deck.slides[0].slots = {
      hero: { kind: "image", src: "/x.png" } as never,
    } as never;
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; errors?: string[] };
    // Back-compat: singular `error` is still set to the first message.
    expect(typeof body.error).toBe("string");
    expect(body.error?.length ?? 0).toBeGreaterThan(0);
    // New: full `errors[]` is present and contains BOTH errors.
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors!.length).toBeGreaterThanOrEqual(2);
    // The singular alias matches the first entry of the array.
    expect(body.error).toBe(body.errors![0]);
    // Sanity-check both error topics are surfaced.
    const joined = body.errors!.join("\n");
    expect(joined).toMatch(/title/i);
    expect(joined).toMatch(/alt/i);
  });

  it("includes errors[] (single-item) for a single-error 400 too (#93)", async () => {
    const { env } = makeEnv();
    // Single error: malformed slug-vs-URL mismatch path goes through
    // `validateDeck` and returns a single error string (it's the
    // routing-context check, not the shape validator). For pure
    // shape-validator single errors, use a deck with one issue.
    const deck = makeDeck("hello");
    deck.meta.title = "";
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(deck),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; errors?: string[] };
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors!.length).toBeGreaterThanOrEqual(1);
    expect(body.error).toBe(body.errors![0]);
  });
});

// ---------------------------------------------------------------- //
// DELETE /api/admin/decks/<slug>
// ---------------------------------------------------------------- //

describe("DELETE /api/admin/decks/<slug>", () => {
  it("rejects without auth header with 403", async () => {
    const { env, kv } = makeEnv();
    await kv.put("deck:hello", JSON.stringify(makeDeck("hello")));
    const res = await call(
      new Request("https://example.com/api/admin/decks/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(403);
    // KV must not have been touched.
    expect(kv.store.has("deck:hello")).toBe(true);
  });

  it("removes both the deck record AND the decks-list entry", async () => {
    const { env, kv } = makeEnv();
    // Seed via POST so the index is populated naturally.
    await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "POST",
        body: JSON.stringify(makeDeck("hello")),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(kv.store.has("deck:hello")).toBe(true);
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(kv.store.has("deck:hello")).toBe(false);
    const list = JSON.parse(kv.store.get("decks-list")!) as unknown[];
    expect(list).toEqual([]);
  });

  it("is idempotent — deleting a missing deck still returns 204", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/ghost", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------- //
// Routing
// ---------------------------------------------------------------- //

describe("routing", () => {
  it("returns null for non-/api/decks paths (handler not responsible)", async () => {
    const { env } = makeEnv();
    const res = await handleDecks(
      new Request("https://example.com/api/themes/hello"),
      env,
    );
    expect(res).toBeNull();
  });

  it("returns 405 for POST on the public list path", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/decks", { method: "POST" }),
      env,
    );
    expect(res.status).toBe(405);
  });

  it("returns 405 for PUT on a single admin item path", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello", {
        method: "PUT",
      }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------- //
// GET /api/admin/decks/<slug> (admin read — Slice 6 / #62)
// ---------------------------------------------------------------- //

describe("GET /api/admin/decks/<slug>", () => {
  it("rejects without cf-access-authenticated-user-email with 403", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/decks/hello"),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when the deck does not exist", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/missing"),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns the full DataDeck for a private deck (admin can read)", async () => {
    const { env, kv } = makeEnv();
    const deck = makeDeck("secret", "private");
    await kv.put("deck:secret", JSON.stringify(deck));

    const res = await call(
      adminRequest("https://example.com/api/admin/decks/secret"),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(deck);
  });

  it("returns the full DataDeck for a public deck", async () => {
    const { env, kv } = makeEnv();
    const deck = makeDeck("hello", "public");
    await kv.put("deck:hello", JSON.stringify(deck));

    const res = await call(
      adminRequest("https://example.com/api/admin/decks/hello"),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(deck);
  });

  it("rejects an invalid slug with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/decks/Not-Allowed"),
      env,
    );
    expect(res.status).toBe(400);
  });
});
