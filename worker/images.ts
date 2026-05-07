/**
 * Deck image API — issue #58 / deck creator Slice 2.
 *
 * STUB shipped via the pre-orchestrator commit pattern (see #16
 * grilling decisions + observation #13 in skill-observations/log.md).
 * Returns `null` so requests fall through to the SPA. The Slice 2
 * worker will REPLACE this file's body while preserving the
 * `ImagesEnv` interface and `handleImages` function name (so the
 * Worker entry chain in `worker/index.ts` stays untouched during
 * the parallel dispatch wave).
 *
 * Final endpoints (worker dispatch will implement):
 *
 *   POST   /api/admin/images/<slug>                 — multipart upload (Access-gated)
 *   GET    /api/admin/images/<slug>                 — image index for slug (Access-gated)
 *   DELETE /api/admin/images/<slug>/<contentHash>   — remove image (Access-gated)
 *   GET    /images/<path...>                        — public, immutable cache
 *
 * Storage is content-addressed: `decks/<slug>/<sha256>.<ext>` in R2.
 * The `IMAGES_INDEX` KV namespace holds `images-index:<slug>` →
 * `ImageRecord[]` for the admin picker UI.
 */

export interface ImagesEnv {
  IMAGES: R2Bucket;
  IMAGES_INDEX: KVNamespace;
}

export async function handleImages(
  _request: Request,
  _env: ImagesEnv,
): Promise<Response | null> {
  // Stub: not yet implemented. Worker for #58 will replace.
  return null;
}
