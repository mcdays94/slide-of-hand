/**
 * Deck record API — issue #57 / deck creator Slice 1.
 *
 * Five endpoints, KV-backed, mirroring `worker/themes.ts` /
 * `worker/element-overrides.ts` shape:
 *
 *   GET    /api/decks                 — public, returns `{ decks: DeckSummary[] }`
 *                                       (the `decks-list` denormalized index, public-only).
 *                                       Filters out `visibility !== "public"` AND
 *                                       `draft === true` (issue #191) so the public
 *                                       index never shows work-in-progress decks.
 *                                       Edge-cached `Cache-Control: private, max-age=60`
 *                                       (per-browser only — see element-overrides.ts for
 *                                       why we avoid shared CDN caching on save-driven
 *                                       endpoints).
 *   GET    /api/decks/<slug>          — public, returns the full DataDeck record.
 *                                       404 for missing OR private slugs (no leak).
 *   GET    /api/admin/decks           — Access-gated, returns ALL decks (public + private).
 *   GET    /api/admin/decks/<slug>    — Access-gated, returns the FULL DataDeck record for
 *                                       editing. Mirrors the public read endpoint but
 *                                       does NOT filter on visibility — so the editor
 *                                       can load a private deck. Added for Slice 6 (#62).
 *   POST   /api/admin/decks/<slug>    — Access-gated, creates or replaces the deck record;
 *                                       updates the `decks-list` index.
 *   DELETE /api/admin/decks/<slug>    — Access-gated, removes the deck record AND its
 *                                       `decks-list` entry.
 *
 * Cloudflare Access guards `/api/admin/*` at the edge; the Worker ALSO
 * validates the `cf-access-authenticated-user-email` header via
 * `requireAccessAuth()` — defense-in-depth so a misconfigured Access app
 * fails closed instead of open (see `worker/access-auth.ts`).
 *
 * ## Schema validation
 *
 * The canonical `DataDeck` / `DataSlide` / `SlotValue` types + the
 * shape validator (`validateDataDeck`) live in `src/lib/deck-record.ts`.
 * The Worker imports them across the worker/src boundary the same way
 * it imports `isValidSlug` from `src/lib/theme-tokens` — type imports
 * are compile-time-only, and the small runtime helper bundles cleanly.
 *
 * The validator enforces shape only — it is NOT template-aware (which
 * slots a given template requires is checked at render time, in the
 * editor + viewer; that's Slice 5's job).
 *
 * The shared validator is STRICTER than the original inline pre-#59
 * version on a few axes (deliberate divergence, kept on cutover):
 *   - `meta.slug` and `slides[].id` must be kebab-case
 *   - `meta.date` must be ISO `YYYY-MM-DD`
 *   - `slide.layout` must be one of the canonical Layout enum values
 *   - `meta.runtimeMinutes` must be a non-negative integer
 *   - `slot.revealAt` must be a non-negative integer
 *   - duplicate slide ids inside the same deck are rejected
 *
 * The shared validator does NOT check that `meta.slug` matches the URL
 * slug — that constraint is a Worker-routing concern, not a record-
 * shape concern. The handler layers it on AFTER the shape validation
 * succeeds (see `handleAdminWrite`).
 *
 * ## Why `decks-list` is a single key
 *
 * The index is a single JSON array under the key `decks-list`. Listing
 * via KV's `list()` API would also work but costs an extra round-trip
 * per slug for the summary fields. Maintaining a denormalized index lets
 * the public landing page render with one KV read. POST/DELETE keep the
 * index in sync; if the second write fails, the deck record is the
 * source of truth and a future write recomputes the entry. (KV has no
 * transactions, so "atomic across two keys" is best-effort; for v0.1 the
 * eventual-consistency window is acceptable — single-author writes.)
 *
 * Returns:
 *   - a `Response` for any path it owns (200 / 204 / 400 / 403 / 404 / 405)
 *   - `null` for paths it does not own (so the caller can fall through
 *     to other handlers / the static assets binding).
 */

import { isValidSlug } from "../src/lib/theme-tokens";
import {
  validateDataDeck,
  type DataDeck,
  type Visibility,
} from "../src/lib/deck-record";
import { requireAccessAuth } from "./access-auth";

export interface DecksEnv {
  DECKS: KVNamespace;
}

/**
 * Side-data env extension (issue #245). Delete must clear the per-deck
 * manifest record (`manifest:<slug>`) so retired KV decks don't leave
 * orphans behind. We accept the `MANIFESTS` binding as optional on a
 * separate type so callers can decide at the top-level whether the
 * binding is wired — the production `Env` (see `worker/index.ts`)
 * extends both `DecksEnv` and `ManifestsEnv`, satisfying this shape;
 * unit-test envs that only seed `DECKS` skip cleanup cleanly.
 */
interface DecksSideDataEnv {
  MANIFESTS?: KVNamespace;
}

/**
 * Public summary shape stored in the `decks-list` index. Excludes slot
 * data and any non-summary fields so the public list endpoint stays
 * cheap to render and never leaks slot content.
 */
interface DeckSummary {
  slug: string;
  title: string;
  description?: string;
  date: string;
  cover?: string;
  visibility: Visibility;
  runtimeMinutes?: number;
  /**
   * Work-in-progress flag (issue #191). When `true`, the public list
   * handler filters this entry out — the deck is still in KV and visible
   * via `/api/admin/decks`, but the public `/` index never shows it.
   * Default: undefined (treated as "not a draft").
   */
  draft?: boolean;
  /**
   * Retired flag (issue #243). When `true`:
   *   - the public list (`GET /api/decks`) filters the entry out;
   *   - the public read (`GET /api/decks/<slug>`) returns 404;
   *   - the admin list (`GET /api/admin/decks`) keeps the entry so the
   *     admin Archived section can render it.
   *
   * Default: undefined (treated as "active"). Archived wins over draft
   * on the public surface: an archived deck is hidden regardless of
   * the draft flag.
   */
  archived?: boolean;
}

// ---------------------------------------------------------------- //
// KV keys + path patterns
// ---------------------------------------------------------------- //

const KV_DECK = (slug: string) => `deck:${slug}`;
const KV_INDEX = "decks-list";
/** Side-data key for the per-deck manifest (issue #245 delete cleanup). */
const KV_MANIFEST = (slug: string) => `manifest:${slug}`;

const LIST_PATH = /^\/api\/decks\/?$/;
const READ_PATH = /^\/api\/decks\/([^/]+)\/?$/;
const ADMIN_LIST_PATH = /^\/api\/admin\/decks\/?$/;
const ADMIN_ITEM_PATH = /^\/api\/admin\/decks\/([^/]+)\/?$/;
/**
 * Issue #245 — lifecycle subresource verbs on a single deck. Archive
 * flips `meta.archived = true`; Restore clears it. POST instead of
 * PATCH because the rest of this surface speaks POST (upsert) +
 * DELETE (tombstone); adding PATCH for one pair would be inconsistent.
 */
const ADMIN_ARCHIVE_PATH = /^\/api\/admin\/decks\/([^/]+)\/archive\/?$/;
const ADMIN_RESTORE_PATH = /^\/api\/admin\/decks\/([^/]+)\/restore\/?$/;

const READ_HEADERS = {
  "content-type": "application/json",
  // `private, max-age=60` — see element-overrides.ts header for the
  // rationale: per-browser cache for the audience, no shared CDN cache,
  // so author save → reload feels instant.
  "cache-control": "private, max-age=60",
};

const NO_STORE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

// ---------------------------------------------------------------- //
// Helpers
// ---------------------------------------------------------------- //

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: NO_STORE_HEADERS,
  });
}

/**
 * 400 response carrying the FULL list of validation errors (issue #93).
 *
 * Wire shape:
 *   { error: errors[0], errors: [...all messages...] }
 *
 * The singular `error` field is kept as a back-compat alias of
 * `errors[0]` so existing clients (tests, CLIs, future API consumers)
 * that only read `error` continue to work; the editor banner reads
 * `errors[]` and surfaces every entry at once.
 */
function badRequestWithErrors(errors: string[]): Response {
  const safeErrors = errors.length > 0 ? errors : ["invalid deck"];
  return new Response(
    JSON.stringify({ error: safeErrors[0], errors: safeErrors }),
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: NO_STORE_HEADERS,
  });
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: { ...NO_STORE_HEADERS, allow: allowed.join(", ") },
  });
}

// ---------------------------------------------------------------- //
// Shape validation
// ---------------------------------------------------------------- //
//
// Shape validation is delegated to `validateDataDeck` from
// `src/lib/deck-record.ts` (issue #59). The Worker keeps responsibility
// for cross-cutting checks that depend on routing context — namely
// whether `meta.slug` agrees with the URL slug — because those are
// not properties of the record itself.

function validateDeck(
  raw: unknown,
  expectedSlug: string,
):
  | { ok: true; value: DataDeck }
  | { ok: false; errors: string[] } {
  const result = validateDataDeck(raw);
  if (!result.ok) {
    // Surface the FULL error list (issue #93) — the original inline
    // validator returned only a single string, but the editor benefits
    // from seeing every problem in one pass. The `badRequestWithErrors`
    // helper keeps `error` as an alias for back-compat.
    return {
      ok: false,
      errors: result.errors.length > 0 ? result.errors : ["invalid deck"],
    };
  }
  if (result.value.meta.slug !== expectedSlug) {
    return {
      ok: false,
      errors: [
        `meta.slug must match URL slug (got "${result.value.meta.slug}", expected "${expectedSlug}")`,
      ],
    };
  }
  return { ok: true, value: result.value };
}

// ---------------------------------------------------------------- //
// Index helpers (`decks-list`)
// ---------------------------------------------------------------- //

async function readIndex(env: DecksEnv): Promise<DeckSummary[]> {
  const stored = (await env.DECKS.get(KV_INDEX, "json")) as
    | DeckSummary[]
    | null;
  return Array.isArray(stored) ? stored : [];
}

function summaryFromDeck(deck: DataDeck): DeckSummary {
  // Whitelist explicitly so we never accidentally leak a future
  // meta field into the public summary.
  const summary: DeckSummary = {
    slug: deck.meta.slug,
    title: deck.meta.title,
    date: deck.meta.date,
    visibility: deck.meta.visibility,
  };
  if (deck.meta.description !== undefined) {
    summary.description = deck.meta.description;
  }
  if (deck.meta.cover !== undefined) {
    summary.cover = deck.meta.cover;
  }
  if (deck.meta.runtimeMinutes !== undefined) {
    summary.runtimeMinutes = deck.meta.runtimeMinutes;
  }
  // Issue #191 — propagate `draft` only when explicitly set, so the
  // index summary stays minimal for non-draft decks (the vast majority).
  // The public list handler reads this to filter drafts at the wire.
  if (deck.meta.draft === true) {
    summary.draft = true;
  }
  // Issue #243 — propagate `archived` only when explicitly set. The
  // public list filters archived entries at the wire; the public read
  // 404s for archived slugs. Default behaviour for any pre-#243 deck
  // (no `archived` field on the record) is unchanged.
  if (deck.meta.archived === true) {
    summary.archived = true;
  }
  return summary;
}

async function upsertIndex(
  env: DecksEnv,
  summary: DeckSummary,
): Promise<void> {
  const list = await readIndex(env);
  const next = list.filter((entry) => entry.slug !== summary.slug);
  next.push(summary);
  await env.DECKS.put(KV_INDEX, JSON.stringify(next));
}

async function removeFromIndex(env: DecksEnv, slug: string): Promise<void> {
  const list = await readIndex(env);
  const next = list.filter((entry) => entry.slug !== slug);
  // Even if the slug wasn't present, write back the (possibly identical)
  // list — keeps the call idempotent and the key always materialised.
  await env.DECKS.put(KV_INDEX, JSON.stringify(next));
}

// ---------------------------------------------------------------- //
// Endpoint handlers
// ---------------------------------------------------------------- //

async function handlePublicList(env: DecksEnv): Promise<Response> {
  const list = await readIndex(env);
  // Three-pass filter:
  //   1. visibility must be "public" — private decks never leak.
  //   2. draft must NOT be true — work-in-progress decks (issue #191)
  //      stay invisible on the public index.
  //   3. archived must NOT be true — retired decks (issue #243) stay
  //      invisible on the public index regardless of the draft flag
  //      (archived wins over draft).
  //
  // Both `draft` and `archived` allow `undefined` / `false` through;
  // only the explicit `true` is filtered. Mirrors the front-end
  // `mergeDeckLists` semantics (defence in depth).
  const publicOnly = list.filter(
    (entry) =>
      entry.visibility === "public" &&
      entry.draft !== true &&
      entry.archived !== true,
  );
  return new Response(JSON.stringify({ decks: publicOnly }), {
    status: 200,
    headers: READ_HEADERS,
  });
}

async function handlePublicRead(
  slug: string,
  env: DecksEnv,
): Promise<Response> {
  const stored = (await env.DECKS.get(KV_DECK(slug), "json")) as
    | DataDeck
    | null;
  // Treat private decks as 404 on the public endpoint: returning 403
  // would leak the existence of the slug + its private nature, which
  // defeats the purpose of "private". 404 is indistinguishable from
  // "no such deck".
  if (!stored || stored.meta?.visibility !== "public") {
    return notFound();
  }
  // Issue #243 — archived decks are treated as 404 on the public
  // endpoint. Same reasoning as private: returning the record would
  // leak that the deck once existed but has been retired. 404 is the
  // cleanest "deck no longer exists" signal.
  if (stored.meta?.archived === true) {
    return notFound();
  }
  return new Response(JSON.stringify(stored), {
    status: 200,
    headers: READ_HEADERS,
  });
}

async function handleAdminList(env: DecksEnv): Promise<Response> {
  const list = await readIndex(env);
  return new Response(JSON.stringify({ decks: list }), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

/**
 * Admin read of a single deck record by slug. Identical to the public
 * read but WITHOUT the visibility filter — Access-gated so only
 * authenticated authors get to see private decks. Used by the Slice 6
 * editor (`useDeckEditor`) to load a deck for editing.
 */
async function handleAdminRead(
  slug: string,
  env: DecksEnv,
): Promise<Response> {
  const stored = (await env.DECKS.get(KV_DECK(slug), "json")) as
    | DataDeck
    | null;
  if (!stored) return notFound();
  return new Response(JSON.stringify(stored), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

async function handleAdminWrite(
  slug: string,
  request: Request,
  env: DecksEnv,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const validation = validateDeck(body, slug);
  if (!validation.ok) {
    return badRequestWithErrors(validation.errors);
  }
  const deck = validation.value;
  // Persist the deck record first — it is the source of truth. If the
  // index update later fails (KV has no transactions), the deck still
  // exists and a subsequent POST recomputes the summary entry.
  await env.DECKS.put(KV_DECK(slug), JSON.stringify(deck));
  await upsertIndex(env, summaryFromDeck(deck));
  return new Response(JSON.stringify(deck), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

async function handleAdminDelete(
  slug: string,
  env: DecksEnv & DecksSideDataEnv,
): Promise<Response> {
  await env.DECKS.delete(KV_DECK(slug));
  await removeFromIndex(env, slug);
  // Issue #245 — clear per-deck side data so retired KV decks don't
  // leave orphans behind. Today the only KV-backed side data is the
  // manifest record (`manifest:<slug>` in `MANIFESTS`); other surfaces
  // (themes, element overrides, analytics) are not keyed per-deck-slug
  // and have their own lifecycles.
  //
  // The binding is optional on `DecksSideDataEnv` — legacy envs (and
  // unit-test paths that only seed `DECKS`) skip cleanup cleanly. KV
  // `delete()` is idempotent so it is safe to call against a missing
  // key.
  if (env.MANIFESTS) {
    await env.MANIFESTS.delete(KV_MANIFEST(slug));
  }
  return new Response(null, { status: 204 });
}

/**
 * Issue #245 — toggle `meta.archived` on a KV-backed deck.
 *
 * Both archive and restore go through this helper. The mutation is:
 *   1. Read the current `deck:<slug>` record (404 if missing).
 *   2. Set / clear `meta.archived` (no-op if already in the target
 *      state — both endpoints are idempotent).
 *   3. Persist the record + the matching `decks-list` summary so
 *      downstream consumers (public list, admin list) agree.
 *
 * Side data (manifest overrides, etc.) is NOT touched: archive is
 * reversible by design and the side data must survive so restore
 * puts the deck back in the same shape.
 *
 * The return shape mirrors `handleAdminWrite` (200 + the deck record)
 * so the admin UI can pick up the updated summary fields without an
 * extra round-trip.
 */
async function handleAdminLifecycle(
  slug: string,
  env: DecksEnv,
  action: "archive" | "restore",
): Promise<Response> {
  const stored = (await env.DECKS.get(KV_DECK(slug), "json")) as
    | DataDeck
    | null;
  if (!stored) return notFound();
  const wantArchived = action === "archive";
  const nextMeta = { ...stored.meta };
  if (wantArchived) {
    nextMeta.archived = true;
  } else {
    // Drop the key entirely on restore so the persisted record (and
    // its summary) match the "never archived" shape exactly. This
    // keeps the `summaryFromDeck` whitelist tidy and the post-restore
    // record byte-for-byte equivalent to a fresh upsert.
    delete nextMeta.archived;
  }
  const next: DataDeck = { ...stored, meta: nextMeta };
  await env.DECKS.put(KV_DECK(slug), JSON.stringify(next));
  await upsertIndex(env, summaryFromDeck(next));
  return new Response(JSON.stringify(next), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

// ---------------------------------------------------------------- //
// Router
// ---------------------------------------------------------------- //

/**
 * Route a request against the decks API surface. Returns a `Response`
 * for any path the handler owns, or `null` so the caller can fall
 * through to other handlers / the static assets binding.
 */
export async function handleDecks(
  request: Request,
  env: DecksEnv & DecksSideDataEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // --- Admin write paths first (most specific) ---

  // Lifecycle subresources (`/archive`, `/restore`) live UNDER the
  // single-item path so they must match before the bare item regex
  // (which would otherwise eat `<slug>/archive` as a slug containing a
  // slash via the broader `[^/]+` — except that group rejects slashes,
  // so both paths COULD coexist; matching here keeps the routing intent
  // explicit and the handlers small).
  const archiveMatch = path.match(ADMIN_ARCHIVE_PATH);
  if (archiveMatch) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    const slug = decodeURIComponent(archiveMatch[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");
    if (request.method === "POST") {
      return handleAdminLifecycle(slug, env, "archive");
    }
    return methodNotAllowed(["POST"]);
  }

  const restoreMatch = path.match(ADMIN_RESTORE_PATH);
  if (restoreMatch) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    const slug = decodeURIComponent(restoreMatch[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");
    if (request.method === "POST") {
      return handleAdminLifecycle(slug, env, "restore");
    }
    return methodNotAllowed(["POST"]);
  }

  if (ADMIN_ITEM_PATH.test(path)) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    const match = path.match(ADMIN_ITEM_PATH)!;
    const slug = decodeURIComponent(match[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");
    if (request.method === "GET" || request.method === "HEAD") {
      return handleAdminRead(slug, env);
    }
    if (request.method === "POST") return handleAdminWrite(slug, request, env);
    if (request.method === "DELETE") return handleAdminDelete(slug, env);
    return methodNotAllowed(["GET", "HEAD", "POST", "DELETE"]);
  }

  if (ADMIN_LIST_PATH.test(path)) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    if (request.method === "GET" || request.method === "HEAD") {
      return handleAdminList(env);
    }
    return methodNotAllowed(["GET", "HEAD"]);
  }

  // --- Public read paths ---

  const readMatch = path.match(READ_PATH);
  if (readMatch) {
    const slug = decodeURIComponent(readMatch[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");
    if (request.method === "GET" || request.method === "HEAD") {
      return handlePublicRead(slug, env);
    }
    return methodNotAllowed(["GET", "HEAD"]);
  }

  if (LIST_PATH.test(path)) {
    if (request.method === "GET" || request.method === "HEAD") {
      return handlePublicList(env);
    }
    return methodNotAllowed(["GET", "HEAD"]);
  }

  return null;
}
