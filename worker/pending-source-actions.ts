/**
 * Pending source deck action API — issue #246 / PRD #242.
 *
 * Three endpoints, KV-backed in the shared `DECKS` namespace:
 *
 *   GET    /api/admin/deck-source-actions         — list every pending
 *                                                   record. Drives the
 *                                                   admin projection.
 *   POST   /api/admin/deck-source-actions/<slug>  — upsert a record for
 *                                                   `slug`. Called by
 *                                                   the future source
 *                                                   slices (#247-#249)
 *                                                   after opening a draft
 *                                                   PR. The request body
 *                                                   carries the wire
 *                                                   shape from
 *                                                   `src/lib/pending-source-actions.ts`.
 *   DELETE /api/admin/deck-source-actions/<slug>  — clear the record.
 *                                                   Called by the
 *                                                   "Clear pending" UI
 *                                                   when the author
 *                                                   wants to forget a
 *                                                   pending action.
 *                                                   IDEMPOTENT — no-op
 *                                                   for a missing slug.
 *
 * All three endpoints are Access-gated via `requireAccessAuth()`. There
 * is intentionally NO public read endpoint: pending action state is an
 * admin-internal projection — the public surface always sees the source
 * truth on disk + the KV `archived` flag.
 *
 * ## Storage layout
 *
 * Pending records live in the existing `DECKS` KV namespace to avoid
 * adding a new binding (one of the constraints in issue #246's brief).
 * Two key shapes:
 *
 *   - `pending-source-action:<slug>` — JSON-serialised
 *     `PendingSourceAction` record. Source of truth for a single slug.
 *   - `pending-source-actions-list` — JSON array of slugs that have a
 *     pending record. Denormalised index so the list endpoint stays
 *     cheap (one KV read instead of one-per-slug). Mirrors the
 *     `decks-list` pattern in `worker/decks.ts`.
 *
 * Same trade-off as `decks-list`: KV has no transactions so we keep
 * the per-slug record as source of truth. If the index write fails
 * after the record write, a future POST recomputes the index entry; a
 * future DELETE removes both. Eventual consistency is acceptable for
 * v1 (single-author writes — this surface is admin-only).
 *
 * ## Why we don't filter on source vs KV here
 *
 * Pending records only make sense for source-backed decks. KV-backed
 * decks have an immediate lifecycle (PR #245). However, the Worker
 * does NOT know which decks are source vs KV — that distinction lives
 * in the build-time registry, which is a client-side concept. The
 * admin UI is the gate: when projecting a pending record onto a deck
 * card, it consults the registry's `source` field and ignores
 * pending records that target a KV deck. The Worker stores whatever
 * the caller sends — defence in depth lives on the UI side, and the
 * "Clear pending" action lets the author tidy up if a stale record
 * appears.
 */

import { isValidSlug } from "../src/lib/theme-tokens";
import {
  validatePendingSourceAction,
  type PendingSourceAction,
} from "../src/lib/pending-source-actions";
import { requireAccessAuth } from "./access-auth";

export interface PendingSourceActionsEnv {
  DECKS: KVNamespace;
}

// ---------------------------------------------------------------- //
// KV keys + path patterns
// ---------------------------------------------------------------- //

const KV_RECORD = (slug: string) => `pending-source-action:${slug}`;
const KV_INDEX = "pending-source-actions-list";

const LIST_PATH = /^\/api\/admin\/deck-source-actions\/?$/;
const ITEM_PATH = /^\/api\/admin\/deck-source-actions\/([^/]+)\/?$/;

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

function methodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: { ...NO_STORE_HEADERS, allow: allowed.join(", ") },
  });
}

// ---------------------------------------------------------------- //
// Index helpers
// ---------------------------------------------------------------- //

async function readIndex(env: PendingSourceActionsEnv): Promise<string[]> {
  const stored = (await env.DECKS.get(KV_INDEX, "json")) as string[] | null;
  return Array.isArray(stored) ? stored.filter((s) => typeof s === "string") : [];
}

async function upsertIndex(
  env: PendingSourceActionsEnv,
  slug: string,
): Promise<void> {
  const list = await readIndex(env);
  if (list.includes(slug)) return;
  list.push(slug);
  await env.DECKS.put(KV_INDEX, JSON.stringify(list));
}

async function removeFromIndex(
  env: PendingSourceActionsEnv,
  slug: string,
): Promise<void> {
  const list = await readIndex(env);
  const next = list.filter((entry) => entry !== slug);
  // Always write back so the key materialises even on a no-op delete.
  await env.DECKS.put(KV_INDEX, JSON.stringify(next));
}

// ---------------------------------------------------------------- //
// Endpoint handlers
// ---------------------------------------------------------------- //

async function handleList(env: PendingSourceActionsEnv): Promise<Response> {
  const slugs = await readIndex(env);
  const actions: PendingSourceAction[] = [];
  // Walk the index, fetching each record. Missing records (the
  // index/record pair can drift if a write half-failed) are silently
  // skipped — the list endpoint is best-effort. The per-slug record
  // is the source of truth.
  for (const slug of slugs) {
    const stored = (await env.DECKS.get(
      KV_RECORD(slug),
      "json",
    )) as PendingSourceAction | null;
    if (stored) actions.push(stored);
  }
  return new Response(JSON.stringify({ actions }), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

async function handleUpsert(
  slug: string,
  request: Request,
  env: PendingSourceActionsEnv,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const validation = validatePendingSourceAction(body);
  if (!validation.ok) return badRequest(validation.error);
  if (validation.value.slug !== slug) {
    return badRequest(
      `slug in body ("${validation.value.slug}") must match URL slug ("${slug}")`,
    );
  }
  await env.DECKS.put(KV_RECORD(slug), JSON.stringify(validation.value));
  await upsertIndex(env, slug);
  return new Response(JSON.stringify(validation.value), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

async function handleClear(
  slug: string,
  env: PendingSourceActionsEnv,
): Promise<Response> {
  await env.DECKS.delete(KV_RECORD(slug));
  await removeFromIndex(env, slug);
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- //
// Router
// ---------------------------------------------------------------- //

/**
 * Route a request against the pending-source-actions API. Returns a
 * `Response` for any path the handler owns, or `null` so the caller
 * can fall through to other handlers. All paths are Access-gated.
 */
export async function handlePendingSourceActions(
  request: Request,
  env: PendingSourceActionsEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  const itemMatch = path.match(ITEM_PATH);
  if (itemMatch) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    const slug = decodeURIComponent(itemMatch[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");
    if (request.method === "POST") return handleUpsert(slug, request, env);
    if (request.method === "DELETE") return handleClear(slug, env);
    return methodNotAllowed(["POST", "DELETE"]);
  }

  if (LIST_PATH.test(path)) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    if (request.method === "GET" || request.method === "HEAD") {
      return handleList(env);
    }
    return methodNotAllowed(["GET", "HEAD"]);
  }

  return null;
}
