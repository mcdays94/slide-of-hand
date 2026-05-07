/**
 * Deck record API — issue #57 / deck creator Slice 1.
 *
 * Five endpoints, KV-backed, mirroring `worker/themes.ts` /
 * `worker/element-overrides.ts` shape:
 *
 *   GET    /api/decks                 — public, returns `{ decks: DeckSummary[] }`
 *                                       (the `decks-list` denormalized index, public-only).
 *                                       Edge-cached `Cache-Control: private, max-age=60`
 *                                       (per-browser only — see element-overrides.ts for
 *                                       why we avoid shared CDN caching on save-driven
 *                                       endpoints).
 *   GET    /api/decks/<slug>          — public, returns the full DataDeck record.
 *                                       404 for missing OR private slugs (no leak).
 *   GET    /api/admin/decks           — Access-gated, returns ALL decks (public + private).
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
 * The canonical `DataDeck` / `DataSlide` / `SlotValue` types live in the
 * #16 grilling decisions comment. The companion modules
 * `src/lib/slot-types.ts`, `src/lib/template-types.ts`, and
 * `src/lib/deck-record.ts` are being built in parallel by the #59 worker
 * — they are not yet importable. We therefore hand-roll a SHAPE-only
 * validator inline (matching the schema sketch verbatim). When #59 lands,
 * a follow-up PR can swap this for the shared validator without changing
 * the wire format.
 *
 * The validator enforces shape only — it is NOT template-aware (which
 * slots a given template requires is checked at render time, in the
 * editor + viewer; that's Slice 5's job).
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
import { requireAccessAuth } from "./access-auth";

export interface DecksEnv {
  DECKS: KVNamespace;
}

// ---------------------------------------------------------------- //
// Schema (shape-only). Mirrors the #16 grilling sketch verbatim.
// ---------------------------------------------------------------- //

type Visibility = "public" | "private";

interface SlotBase {
  revealAt?: number;
}
interface TextSlot extends SlotBase {
  kind: "text";
  value: string;
}
interface RichTextSlot extends SlotBase {
  kind: "richtext";
  value: string;
}
interface ImageSlot extends SlotBase {
  kind: "image";
  src: string;
  alt: string;
}
interface CodeSlot extends SlotBase {
  kind: "code";
  lang: string;
  value: string;
}
interface ListSlot extends SlotBase {
  kind: "list";
  items: string[];
}
interface StatSlot extends SlotBase {
  kind: "stat";
  value: string;
  caption?: string;
}
type SlotValue =
  | TextSlot
  | RichTextSlot
  | ImageSlot
  | CodeSlot
  | ListSlot
  | StatSlot;

interface DataSlide {
  id: string;
  template: string;
  layout?: string;
  slots: Record<string, SlotValue>;
  notes?: string;
  hidden?: boolean;
}

interface DataDeckMeta {
  slug: string;
  title: string;
  description?: string;
  date: string;
  author?: string;
  event?: string;
  cover?: string;
  runtimeMinutes?: number;
  visibility: Visibility;
}

interface DataDeck {
  meta: DataDeckMeta;
  slides: DataSlide[];
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
}

// ---------------------------------------------------------------- //
// KV keys + path patterns
// ---------------------------------------------------------------- //

const KV_DECK = (slug: string) => `deck:${slug}`;
const KV_INDEX = "decks-list";

const LIST_PATH = /^\/api\/decks\/?$/;
const READ_PATH = /^\/api\/decks\/([^/]+)\/?$/;
const ADMIN_LIST_PATH = /^\/api\/admin\/decks\/?$/;
const ADMIN_ITEM_PATH = /^\/api\/admin\/decks\/([^/]+)\/?$/;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------------------------------------------------------------- //
// Shape validation
// ---------------------------------------------------------------- //

function validateSlotValue(
  raw: unknown,
  path: string,
): { ok: true; value: SlotValue } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: `${path} must be an object` };
  }
  if (raw.revealAt !== undefined && typeof raw.revealAt !== "number") {
    return { ok: false, error: `${path}.revealAt must be a number` };
  }
  const kind = raw.kind;
  switch (kind) {
    case "text":
    case "richtext": {
      if (typeof raw.value !== "string") {
        return { ok: false, error: `${path}.value must be a string` };
      }
      return { ok: true, value: raw as unknown as SlotValue };
    }
    case "image": {
      if (!isNonEmptyString(raw.src)) {
        return { ok: false, error: `${path}.src must be a non-empty string` };
      }
      if (typeof raw.alt !== "string") {
        // alt may be empty string (decorative images), but must be present.
        return { ok: false, error: `${path}.alt must be a string` };
      }
      return { ok: true, value: raw as unknown as SlotValue };
    }
    case "code": {
      if (!isNonEmptyString(raw.lang)) {
        return { ok: false, error: `${path}.lang must be a non-empty string` };
      }
      if (typeof raw.value !== "string") {
        return { ok: false, error: `${path}.value must be a string` };
      }
      return { ok: true, value: raw as unknown as SlotValue };
    }
    case "list": {
      if (!Array.isArray(raw.items)) {
        return { ok: false, error: `${path}.items must be an array` };
      }
      for (let i = 0; i < raw.items.length; i++) {
        if (typeof raw.items[i] !== "string") {
          return {
            ok: false,
            error: `${path}.items[${i}] must be a string`,
          };
        }
      }
      return { ok: true, value: raw as unknown as SlotValue };
    }
    case "stat": {
      if (typeof raw.value !== "string") {
        return { ok: false, error: `${path}.value must be a string` };
      }
      if (raw.caption !== undefined && typeof raw.caption !== "string") {
        return { ok: false, error: `${path}.caption must be a string` };
      }
      return { ok: true, value: raw as unknown as SlotValue };
    }
    default:
      return {
        ok: false,
        error: `${path}.kind must be one of text|richtext|image|code|list|stat`,
      };
  }
}

function validateSlide(
  raw: unknown,
  index: number,
): { ok: true; value: DataSlide } | { ok: false; error: string } {
  const path = `slides[${index}]`;
  if (!isPlainObject(raw)) {
    return { ok: false, error: `${path} must be an object` };
  }
  if (!isNonEmptyString(raw.id)) {
    return { ok: false, error: `${path}.id must be a non-empty string` };
  }
  if (!isNonEmptyString(raw.template)) {
    return {
      ok: false,
      error: `${path}.template must be a non-empty string`,
    };
  }
  if (raw.layout !== undefined && typeof raw.layout !== "string") {
    return { ok: false, error: `${path}.layout must be a string` };
  }
  if (raw.notes !== undefined && typeof raw.notes !== "string") {
    return { ok: false, error: `${path}.notes must be a string` };
  }
  if (raw.hidden !== undefined && typeof raw.hidden !== "boolean") {
    return { ok: false, error: `${path}.hidden must be a boolean` };
  }
  if (!isPlainObject(raw.slots)) {
    return { ok: false, error: `${path}.slots must be an object` };
  }
  for (const [key, slot] of Object.entries(raw.slots)) {
    const result = validateSlotValue(slot, `${path}.slots.${key}`);
    if (!result.ok) return result;
  }
  return { ok: true, value: raw as unknown as DataSlide };
}

function validateMeta(
  raw: unknown,
  expectedSlug: string,
): { ok: true; value: DataDeckMeta } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "meta must be an object" };
  }
  if (!isNonEmptyString(raw.slug)) {
    return { ok: false, error: "meta.slug must be a non-empty string" };
  }
  if (raw.slug !== expectedSlug) {
    return {
      ok: false,
      error: `meta.slug must match URL slug (got "${raw.slug}", expected "${expectedSlug}")`,
    };
  }
  if (!isNonEmptyString(raw.title)) {
    return { ok: false, error: "meta.title must be a non-empty string" };
  }
  if (!isNonEmptyString(raw.date)) {
    return { ok: false, error: "meta.date must be a non-empty string" };
  }
  if (raw.visibility !== "public" && raw.visibility !== "private") {
    return {
      ok: false,
      error: 'meta.visibility must be "public" or "private"',
    };
  }
  for (const optStr of ["description", "author", "event", "cover"] as const) {
    if (raw[optStr] !== undefined && typeof raw[optStr] !== "string") {
      return { ok: false, error: `meta.${optStr} must be a string` };
    }
  }
  if (
    raw.runtimeMinutes !== undefined &&
    typeof raw.runtimeMinutes !== "number"
  ) {
    return { ok: false, error: "meta.runtimeMinutes must be a number" };
  }
  return { ok: true, value: raw as unknown as DataDeckMeta };
}

function validateDeck(
  raw: unknown,
  expectedSlug: string,
): { ok: true; value: DataDeck } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "body must be an object" };
  }
  const metaResult = validateMeta(raw.meta, expectedSlug);
  if (!metaResult.ok) return metaResult;
  if (!Array.isArray(raw.slides)) {
    return { ok: false, error: "slides must be an array" };
  }
  for (let i = 0; i < raw.slides.length; i++) {
    const result = validateSlide(raw.slides[i], i);
    if (!result.ok) return result;
  }
  return {
    ok: true,
    value: { meta: metaResult.value, slides: raw.slides as DataSlide[] },
  };
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
  const publicOnly = list.filter((entry) => entry.visibility === "public");
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
    return badRequest(validation.error);
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
  env: DecksEnv,
): Promise<Response> {
  await env.DECKS.delete(KV_DECK(slug));
  await removeFromIndex(env, slug);
  return new Response(null, { status: 204 });
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
  env: DecksEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // --- Admin write paths first (most specific) ---

  if (ADMIN_ITEM_PATH.test(path)) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    const match = path.match(ADMIN_ITEM_PATH)!;
    const slug = decodeURIComponent(match[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");
    if (request.method === "POST") return handleAdminWrite(slug, request, env);
    if (request.method === "DELETE") return handleAdminDelete(slug, env);
    return methodNotAllowed(["POST", "DELETE"]);
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
