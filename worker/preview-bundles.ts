/**
 * Preview-bundle R2 storage helpers (issue #269 / PRD #178).
 *
 * Static rendered preview bundles (the output of `vite build` for a
 * draft deck) live in a dedicated R2 bucket bound as `PREVIEW_BUNDLES`.
 * This module owns the storage contract: key shape, content-type
 * inference, cache-control policy, and the put/get/delete primitives
 * that later slices will call from the build pipeline (#270) and the
 * preview route (#271).
 *
 * ## Why a dedicated bucket?
 *
 * Deck images (`worker/images.ts`, bucket `slide-of-hand-images`) are
 * content-addressed long-lived assets. Preview bundles are throwaway:
 * generated per draft + per commit, served only to the owning user,
 * deleted when the draft is published or abandoned. Sharing a bucket
 * would conflate lifecycle policies (lifecycle rules, cache-control
 * defaults, even potential public-read configuration on the images
 * bucket) and make the "purge all draft state" operation harder to
 * reason about. Keeping them separate keeps each surface boring.
 *
 * ## Key shape
 *
 *     preview-bundles/<previewId>/<sha>/<path>
 *
 * Examples:
 *     preview-bundles/pv_0123…/07a3259/index.html
 *     preview-bundles/pv_0123…/07a3259/assets/index-DXq8Sx0t.js
 *
 * `previewId` is the opaque pv_<hex> id from `src/lib/draft-previews.ts`
 * (validated at key-build time). `sha` is the commit short/full SHA
 * the bundle was built from. `path` is the relative path inside the
 * built `dist/` tree, sanitised against absolute paths, traversal,
 * and control characters.
 *
 * ## Cache policy
 *
 *   - `*.html` → `no-store`. HTML is the entry point; the iframe must
 *     always re-fetch so a fresh commit on the same `previewId` (under
 *     a new `sha` URL) doesn't get a stale shell from a CDN.
 *   - `assets/*-<hash>.<ext>` → `public, max-age=31536000, immutable`.
 *     Vite's hashed asset names are content-hashes, safe to long-cache.
 *   - Everything else → `no-store`. Conservative default; can be loosened
 *     per-path later if a specific need emerges.
 *
 * ## Privacy posture
 *
 * Object keys NEVER contain user-derived identifiers (no email, no
 * draft repo name, no owner). The opaque previewId carries all
 * identity binding. The owner email gate lives at the route layer
 * (see `worker/preview-route.ts`), not in storage.
 *
 * ## Status
 *
 * This slice ships ONLY the storage helpers. The build pipeline
 * (#270) and the route wiring (#271) will consume these in follow-up
 * slices — `handlePreview` in `worker/preview-route.ts` still returns
 * the 501 stub until #271.
 */

import {
  isValidPreviewId,
  isValidPreviewSha,
} from "../src/lib/draft-previews";

// ---------------------------------------------------------------- //
// Env type
// ---------------------------------------------------------------- //

/**
 * Narrow env subset the preview-bundle helpers need. Bound at the
 * Worker level as a dedicated R2 bucket — see `wrangler.jsonc` for the
 * bucket name + binding.
 */
export interface PreviewBundlesEnv {
  PREVIEW_BUNDLES: R2Bucket;
}

// ---------------------------------------------------------------- //
// Key + prefix helpers
// ---------------------------------------------------------------- //

/** Top-level prefix; isolates preview-bundle keys from anything else
 * that might end up in the same bucket in the future. */
const ROOT_PREFIX = "preview-bundles/";

/**
 * Inputs accepted by the key helpers. `previewId` + `sha` are validated
 * via the existing route contract regexes so we never write a malformed
 * key to R2 (and we never accidentally trust a caller-supplied id that
 * looks plausible but didn't come from our id generator).
 */
export interface PreviewBundleKeyInput {
  previewId: string;
  sha: string;
}

export interface PreviewBundleObjectInput extends PreviewBundleKeyInput {
  path: string;
}

function assertPreviewIdAndSha(input: PreviewBundleKeyInput): void {
  if (!isValidPreviewId(input.previewId)) {
    throw new Error(
      `invalid previewId: must match pv_<hex16+>; got ${JSON.stringify(input.previewId)}`,
    );
  }
  if (!isValidPreviewSha(input.sha)) {
    throw new Error(
      `invalid sha: must be 7-64 lowercase hex chars; got ${JSON.stringify(input.sha)}`,
    );
  }
}

/** `preview-bundles/<previewId>/<sha>/`. Trailing slash so prefix-list
 * operations don't accidentally match a longer previewId/sha that
 * shares a string-prefix. */
export function previewBundlePrefix(input: PreviewBundleKeyInput): string {
  assertPreviewIdAndSha(input);
  return `${ROOT_PREFIX}${input.previewId}/${input.sha}/`;
}

/** `preview-bundles/<previewId>/<sha>/<sanitized-path>`. */
export function previewBundleObjectKey(input: PreviewBundleObjectInput): string {
  return previewBundlePrefix(input) + sanitizePreviewBundlePath(input.path);
}

// ---------------------------------------------------------------- //
// Path sanitization
// ---------------------------------------------------------------- //

/**
 * Validate + normalize a path destined for the bundle prefix. The
 * function is defensive — it accepts only "obviously safe" paths and
 * rejects anything that could let a build pipeline (or a maliciously
 * crafted bundle entry) escape the prefix.
 *
 * Rejected:
 *   - Empty paths (`""`).
 *   - Absolute paths (leading `/`).
 *   - Backslashes anywhere (Windows-style separators are not a thing
 *     in R2 keys but might confuse downstream tooling).
 *   - Any segment equal to `.` or `..` (path traversal).
 *   - Empty segments (`foo//bar`, `foo/`) — these usually indicate a
 *     bug in the path-joining caller and produce surprising R2 keys.
 *   - Control characters (0x00–0x1F, 0x7F).
 *
 * Returns the input verbatim on success — there's no useful
 * normalization beyond rejection because R2 keys are byte-exact and
 * we don't want two different inputs to collide at the same key.
 */
export function sanitizePreviewBundlePath(path: string): string {
  if (typeof path !== "string" || path === "") {
    throw new Error("invalid bundle path: empty");
  }
  if (path.startsWith("/")) {
    throw new Error("invalid bundle path: absolute paths are rejected");
  }
  if (path.includes("\\")) {
    throw new Error(
      "invalid bundle path: backslashes are not allowed (use '/' separators)",
    );
  }
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(
        `invalid bundle path: control character at index ${i} (0x${code.toString(16)})`,
      );
    }
  }
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "") {
      throw new Error(
        "invalid bundle path: empty segment (leading/trailing/double slash)",
      );
    }
    if (seg === "." || seg === "..") {
      throw new Error(
        "invalid bundle path: path-traversal segment ('.' or '..') is rejected",
      );
    }
  }
  return path;
}

// ---------------------------------------------------------------- //
// Content-type inference
// ---------------------------------------------------------------- //

/**
 * Extension → MIME map for the file types a Vite-built deck bundle is
 * expected to ship. Anything outside the map falls through to
 * `application/octet-stream` so the caller can pass an explicit
 * `contentType` if they need to ship something unusual.
 *
 * We include the `; charset=utf-8` suffix on textual types so the
 * browser doesn't have to guess. R2 round-trips this verbatim.
 */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Best-effort MIME inference from a path's extension. Case-insensitive
 * on the extension. Returns `application/octet-stream` when the
 * extension is unknown or absent.
 */
export function inferPreviewContentType(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return DEFAULT_CONTENT_TYPE;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] ?? DEFAULT_CONTENT_TYPE;
}

// ---------------------------------------------------------------- //
// Cache-control policy
// ---------------------------------------------------------------- //

const NO_STORE = "no-store";
const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Vite hashed-asset filename pattern: a path under `assets/` whose
 * basename ends with `-<hash>.<ext>`, where the hash is 8+ alphanumeric
 * characters (Vite uses base64url-ish hashes — 8 chars in production
 * by default). We anchor to `assets/` because we only control the
 * hash convention for files Vite emits; a hash-looking name elsewhere
 * is not a contract we can rely on.
 */
const HASHED_ASSET_REGEX = /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

/**
 * Decide the `Cache-Control` value for a given bundle path. Pure
 * function — used both at PUT time (to stamp metadata on the R2
 * object) and at GET time by the eventual route handler (to copy
 * onto the response).
 *
 *   - `*.html` (any depth) → `no-store`.
 *   - `assets/<name>-<hash>.<ext>` → long-lived immutable.
 *   - everything else → `no-store` (conservative; safe).
 */
export function previewBundleCacheControl(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return NO_STORE;
  }
  if (HASHED_ASSET_REGEX.test(path)) {
    return IMMUTABLE;
  }
  return NO_STORE;
}

// ---------------------------------------------------------------- //
// put / get / delete primitives
// ---------------------------------------------------------------- //

export interface PutPreviewBundleObjectInput extends PreviewBundleObjectInput {
  body: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob;
  /** Optional override; otherwise inferred from the path. */
  contentType?: string;
}

/**
 * Write a single object into the bundle prefix. Stamps `contentType`
 * (caller override or extension-inferred) AND `cacheControl` (policy)
 * onto the R2 object's `httpMetadata` so the route handler can stream
 * them straight onto the response without re-deriving them per
 * request.
 */
export async function putPreviewBundleObject(
  env: PreviewBundlesEnv,
  input: PutPreviewBundleObjectInput,
): Promise<void> {
  const key = previewBundleObjectKey(input);
  const contentType = input.contentType ?? inferPreviewContentType(input.path);
  const cacheControl = previewBundleCacheControl(input.path);
  await env.PREVIEW_BUNDLES.put(key, input.body, {
    httpMetadata: { contentType, cacheControl },
  });
}

/**
 * Read a single object from the bundle prefix. Returns `null` (the
 * deterministic not-found shape) when the object doesn't exist. The
 * returned object exposes the original `httpMetadata` (including
 * `contentType` and `cacheControl`) for the caller to copy onto a
 * response.
 */
export async function getPreviewBundleObject(
  env: PreviewBundlesEnv,
  input: PreviewBundleObjectInput,
): Promise<R2ObjectBody | null> {
  const key = previewBundleObjectKey(input);
  return env.PREVIEW_BUNDLES.get(key);
}

/**
 * Delete every object under `preview-bundles/<previewId>/<sha>/`.
 * Paginates through `list()` to handle bundles larger than R2's
 * 1000-key page limit (a deck's `dist/` output is typically tens of
 * files, but we don't want to leak storage if a future deck grows
 * larger than that).
 *
 * Returns the number of objects deleted, so the caller can log /
 * report progress.
 *
 * Note: R2's `bucket.delete(string[])` accepts an array of keys in
 * one round trip per page, so we batch per page.
 */
export async function deletePreviewBundlePrefix(
  env: PreviewBundlesEnv,
  input: PreviewBundleKeyInput,
): Promise<{ deleted: number }> {
  const prefix = previewBundlePrefix(input);
  let deleted = 0;
  let cursor: string | undefined = undefined;

  // Loop until R2 reports no more pages. Hard cap on iterations as a
  // belt-and-braces guard against an upstream bug that never finishes.
  for (let i = 0; i < 1000; i++) {
    const page: R2Objects = await env.PREVIEW_BUNDLES.list({
      prefix,
      limit: 100,
      cursor,
    });
    const keys = page.objects.map((o) => o.key);
    if (keys.length > 0) {
      await env.PREVIEW_BUNDLES.delete(keys);
      deleted += keys.length;
    }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return { deleted };
}
