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
  type PendingSourceActionExpectedState,
} from "../src/lib/pending-source-actions";
import { requireAccessAuth } from "./access-auth";

export interface PendingSourceActionsEnv {
  DECKS: KVNamespace;
}

/**
 * Side-data env extension (issue #250). Reconciling a pending DELETE
 * also clears the per-deck manifest record (`manifest:<slug>`) so a
 * source-deleted deck doesn't leave a manifest override orphan
 * behind. `MANIFESTS` is optional: legacy envs / tests that only
 * seed `DECKS` skip manifest cleanup cleanly (KV `delete()` is
 * idempotent in any case).
 */
interface PendingSourceActionsSideDataEnv {
  MANIFESTS?: KVNamespace;
}

// ---------------------------------------------------------------- //
// KV keys + path patterns
// ---------------------------------------------------------------- //

const KV_RECORD = (slug: string) => `pending-source-action:${slug}`;
const KV_INDEX = "pending-source-actions-list";
/**
 * Side-data keys cleaned up after a successful pending DELETE
 * reconciliation (issue #250). Mirrors the constants in `worker/decks.ts`
 * — duplicated here so this module stays independent of the KV-deck
 * lifecycle code (which is the right owner for `deck:<slug>` itself).
 */
const KV_MANIFEST = (slug: string) => `manifest:${slug}`;
const KV_DECK = (slug: string) => `deck:${slug}`;
const KV_DECKS_INDEX = "decks-list";

// `/reconcile` lives under the existing single-item path. Matched
// BEFORE `ITEM_PATH` so the bare item handler doesn't eat it.
const RECONCILE_PATH = /^\/api\/admin\/deck-source-actions\/([^/]+)\/reconcile\/?$/;
const LIST_PATH = /^\/api\/admin\/deck-source-actions\/?$/;
const ITEM_PATH = /^\/api\/admin\/deck-source-actions\/([^/]+)\/?$/;

const RECONCILE_SOURCE_STATES: ReadonlySet<PendingSourceActionExpectedState> =
  new Set(["active", "archived", "deleted"]);

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
// Reconcile (issue #250 / PRD #242)
// ---------------------------------------------------------------- //

/**
 * Clear `slug` from the `decks-list` index if present. The index is
 * the only place a deleted source slug might still appear (the public
 * decks index is keyed on KV decks, but if a slug ever materialised
 * there — say via a half-completed New Deck flow — the cleanup path
 * is the same).
 *
 * Returns true iff the slug was actually removed from the index.
 */
async function pruneDecksIndex(
  env: PendingSourceActionsEnv,
  slug: string,
): Promise<boolean> {
  const stored = (await env.DECKS.get(KV_DECKS_INDEX, "json")) as
    | Array<{ slug: string }>
    | null;
  if (!Array.isArray(stored)) return false;
  const next = stored.filter((entry) => entry && entry.slug !== slug);
  if (next.length === stored.length) return false;
  await env.DECKS.put(KV_DECKS_INDEX, JSON.stringify(next));
  return true;
}

/**
 * Reconcile a pending source action against the deployed source state
 * the client has just observed. The handler re-reads the pending
 * record, gates the clear on a server-side match between the
 * persisted `expectedState` and the asserted `sourceState`, and (for
 * a delete that matched) clears source-delete side data BEFORE
 * clearing the pending record itself.
 *
 * The order matters: if any side-data delete throws we want the
 * pending record to survive so a later reconcile attempt can retry
 * the cleanup. KV writes are idempotent so a retry is safe.
 *
 * Wire shape:
 *   request body: { sourceState: "active" | "archived" | "deleted" }
 *   response (200):
 *     { reconciled: boolean, action?: PendingSourceActionType,
 *       cleared?: string[] }
 *   response (404): no pending record for the slug
 *   response (400): bad slug / body / sourceState value
 *
 * The `cleared` array is the set of KV keys actually deleted on this
 * reconcile pass. Useful for the admin UI to log what happened and
 * for tests to make explicit assertions.
 */
async function handleReconcile(
  slug: string,
  request: Request,
  env: PendingSourceActionsEnv & PendingSourceActionsSideDataEnv,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    return badRequest("body must be an object");
  }
  const sourceState = (body as { sourceState?: unknown }).sourceState;
  if (
    typeof sourceState !== "string" ||
    !RECONCILE_SOURCE_STATES.has(sourceState as PendingSourceActionExpectedState)
  ) {
    return badRequest(
      "sourceState must be one of: active, archived, deleted",
    );
  }
  const observedState = sourceState as PendingSourceActionExpectedState;

  const stored = (await env.DECKS.get(
    KV_RECORD(slug),
    "json",
  )) as PendingSourceAction | null;
  if (!stored) {
    return new Response(
      JSON.stringify({ error: "no pending record for slug" }),
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  // Server-side authoritative check: the pending record's persisted
  // `expectedState` must match the asserted `sourceState`. Otherwise
  // the client and the deployed source disagree; leave the marker
  // alone.
  if (stored.expectedState !== observedState) {
    return new Response(
      JSON.stringify({ reconciled: false, action: stored.action }),
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  const cleared: string[] = [];

  // Source-delete side-data cleanup runs FIRST (issue #250). Archive
  // and restore preserve all side data — we keep them reversible.
  // If any of these steps throw, the catch is left to the runtime so
  // the client gets a 5xx and the pending record stays put: the next
  // attempt will retry cleanly because KV deletes are idempotent.
  if (stored.action === "delete" && observedState === "deleted") {
    if (env.MANIFESTS) {
      // KV `get` then `delete` lets us report only the keys that were
      // actually present in `cleared`. The delete is idempotent so
      // an absent key is silently fine; we just don't surface it in
      // the response.
      const manifest = await env.MANIFESTS.get(KV_MANIFEST(slug));
      if (manifest !== null) {
        await env.MANIFESTS.delete(KV_MANIFEST(slug));
        cleared.push(KV_MANIFEST(slug));
      }
    }
    // Defensive: source decks should never have a `deck:<slug>`
    // record, but if one ever appeared (e.g. a stub that escaped a
    // half-completed New Deck flow) we clean it up here so the slug
    // doesn't linger anywhere in KV.
    const deckRecord = await env.DECKS.get(KV_DECK(slug));
    if (deckRecord !== null) {
      await env.DECKS.delete(KV_DECK(slug));
      cleared.push(KV_DECK(slug));
    }
    // Same logic for the public decks-list index. We use a marker
    // suffix (`decks-list:<slug>`) in the `cleared` array so the
    // caller can distinguish "slug removed from the index" from "the
    // index key itself was deleted".
    const indexPruned = await pruneDecksIndex(env, slug);
    if (indexPruned) cleared.push(`${KV_DECKS_INDEX}:${slug}`);
  }

  // Clear the pending record + the pending index entry LAST so the
  // side-data cleanup above gets a chance to fail loudly without
  // losing the marker.
  await env.DECKS.delete(KV_RECORD(slug));
  await removeFromIndex(env, slug);
  cleared.push(KV_RECORD(slug));

  return new Response(
    JSON.stringify({
      reconciled: true,
      action: stored.action,
      cleared,
    }),
    { status: 200, headers: NO_STORE_HEADERS },
  );
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
  env: PendingSourceActionsEnv & PendingSourceActionsSideDataEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Subresource `/reconcile` lives under the single-item path and
  // MUST match before the bare item handler — that handler only
  // accepts `POST` / `DELETE` and would otherwise route reconcile
  // straight into `handleUpsert` (which would 400 the body shape).
  const reconcileMatch = path.match(RECONCILE_PATH);
  if (reconcileMatch) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    const slug = decodeURIComponent(reconcileMatch[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");
    if (request.method === "POST") return handleReconcile(slug, request, env);
    return methodNotAllowed(["POST"]);
  }

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
