/**
 * Deck record API — issue #57 / deck creator Slice 1.
 *
 * STUB shipped via the pre-orchestrator commit pattern (see #16
 * grilling decisions + observation #13 in skill-observations/log.md).
 * Returns `null` so requests fall through to the SPA. The Slice 1
 * worker will REPLACE this file's body while preserving the
 * `DecksEnv` interface and `handleDecks` function name (so the
 * Worker entry chain in `worker/index.ts` stays untouched during
 * the parallel dispatch wave).
 *
 * Final endpoints (worker dispatch will implement):
 *
 *   GET    /api/decks                 — public, returns `{ decks: DeckSummary[] }`
 *   GET    /api/decks/<slug>          — public, returns full DataDeck (404 for private)
 *   GET    /api/admin/decks           — Access-gated, returns ALL decks
 *   POST   /api/admin/decks/<slug>    — Access-gated, create/replace deck record
 *   DELETE /api/admin/decks/<slug>    — Access-gated, remove deck record
 *
 * All admin writes update the `decks-list` denormalized index atomically.
 * Mirror `worker/themes.ts` shape for endpoint structure + auth defense-in-depth.
 */

export interface DecksEnv {
  DECKS: KVNamespace;
}

export async function handleDecks(
  _request: Request,
  _env: DecksEnv,
): Promise<Response | null> {
  // Stub: not yet implemented. Worker for #57 will replace.
  return null;
}
