/**
 * Deck image API — issue #58 / deck creator Slice 2.
 *
 * Four endpoints, R2 + KV-backed:
 *
 *   POST   /api/admin/images/<slug>                 — multipart upload (Access-gated)
 *   GET    /api/admin/images/<slug>                 — image index for slug (Access-gated)
 *   DELETE /api/admin/images/<slug>/<contentHash>   — remove image (Access-gated)
 *   GET    /images/<path...>                        — public, immutable cache
 *
 * Storage is content-addressed: `decks/<slug>/<sha256>.<ext>` in R2. The
 * `IMAGES_INDEX` KV namespace holds `images-index:<slug>` → `ImageRecord[]`
 * for the admin picker UI (Slice 7 wires this up).
 *
 * ## Why content-addressed?
 *
 * Two reasons:
 *   1. Re-uploading the same bytes is a no-op — `head()` returns the
 *      existing object, the index is deduped by `contentHash`, the client
 *      gets back the same `src`. Idempotent by construction.
 *   2. Long-cache safety. The public serve route sets
 *      `Cache-Control: public, max-age=31536000, immutable` because the
 *      object's content can never change for a given URL — different
 *      bytes get a different hash and a different URL.
 *
 * ## Why per-slug namespacing?
 *
 * Two decks could legitimately use the same image bytes; per-slug keys
 * keep the storage owners distinct (so deleting all images for a deck
 * doesn't take an image away from a different deck). Costs roughly 2x
 * storage in the rare collision case — acceptable for v0.1, can revisit
 * with a global dedup layer once usage warrants it.
 *
 * ## Defense-in-depth Access auth
 *
 * Cloudflare Access guards `/api/admin/*` at the edge, but the Worker
 * ALSO validates the `cf-access-authenticated-user-email` header via
 * `requireAccessAuth()` so a misconfigured Access app fails closed
 * instead of open. See `worker/access-auth.ts` for the rationale.
 *
 * Returns:
 *   - a `Response` for any path it owns (200 / 204 / 400 / 403 / 405 / 413 / 415 / 404)
 *   - `null` for paths it does not own (so the caller can fall through
 *     to other handlers / the static assets binding).
 */

import { isValidSlug } from "../src/lib/theme-tokens";
import { requireAccessAuth } from "./access-auth";

export interface ImagesEnv {
  IMAGES: R2Bucket;
  IMAGES_INDEX: KVNamespace;
}

/**
 * One entry in `images-index:<slug>`. Persisted as a JSON array; the
 * admin picker UI consumes this directly.
 */
export interface ImageRecord {
  /** Public URL the client can paste into a slot value. */
  src: string;
  /** sha-256 of the bytes, lowercase hex. Stable across re-uploads. */
  contentHash: string;
  /** Byte length. */
  size: number;
  /** MIME type — one of the allowlist below. */
  mimeType: string;
  /** Original filename from the upload form. Best-effort; defaults to "upload". */
  originalFilename: string;
  /** ISO 8601 timestamp at upload (or last re-upload) time. */
  uploadedAt: string;
}

/** Index key shape — `images-index:<slug>`. */
const INDEX_KEY = (slug: string) => `images-index:${slug}`;

/** R2 object key shape — `decks/<slug>/<hash>.<ext>`. */
function r2Key(slug: string, hash: string, ext: string): string {
  return `decks/${slug}/${hash}.${ext}`;
}

/** Public URL shape — what clients embed. */
function publicSrc(slug: string, hash: string, ext: string): string {
  return `/images/decks/${slug}/${hash}.${ext}`;
}

const ADMIN_PATH = /^\/api\/admin\/images\/([^/]+)(?:\/([^/]+))?\/?$/;
const PUBLIC_PATH = /^\/images\/(.+)$/;

/**
 * MIME allowlist for v0.1. Maps MIME → file extension used in the R2 key.
 * Anything outside this map yields a 415 from the upload endpoint.
 */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/** Reverse map for serving — `ext → MIME` so we can guess on cache miss
 * (R2 stores the MIME on `httpMetadata.contentType` at PUT time, so this
 * is only a fallback for objects somehow stored without metadata). */
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/** 10 MiB. R2 itself accepts much larger uploads, but the v0.1 product
 * scope is "deck art" — anything bigger is almost certainly a mistake
 * (high-res raw photo, etc.) and should be rejected before it bloats the
 * bucket. Increase if a future deck genuinely needs it. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const NO_STORE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

/**
 * Public serve cache headers. Long max-age + `immutable` is safe because
 * a different content hash → different URL, so we can never serve stale
 * bytes for a given URL.
 */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function badRequest(message: string): Response {
  return jsonError(message, 400);
}

function payloadTooLarge(message: string): Response {
  return jsonError(message, 413);
}

function unsupportedMediaType(message: string): Response {
  return jsonError(message, 415);
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: { ...NO_STORE_HEADERS, allow: allowed.join(", ") },
  });
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: NO_STORE_HEADERS,
  });
}

/** Hex-encode an ArrayBuffer as a lowercase string. */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function isContentHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

async function readIndex(
  slug: string,
  env: ImagesEnv,
): Promise<ImageRecord[]> {
  const stored = (await env.IMAGES_INDEX.get(INDEX_KEY(slug), "json")) as
    | ImageRecord[]
    | null;
  return Array.isArray(stored) ? stored : [];
}

async function writeIndex(
  slug: string,
  records: ImageRecord[],
  env: ImagesEnv,
): Promise<void> {
  await env.IMAGES_INDEX.put(INDEX_KEY(slug), JSON.stringify(records));
}

/**
 * Multipart upload handler. The bytes are content-addressed (SHA-256),
 * the R2 PUT is skipped if the same hash already exists, and the index
 * is deduped by hash so re-uploads always converge on a single record.
 *
 * Failure paths:
 *   - 413 if `Content-Length` declares > 10 MiB (best-effort precheck).
 *   - 400 if multipart parsing fails or the `file` field is missing/empty.
 *   - 415 if the file's MIME type is outside the allowlist.
 *   - 413 if the buffered file ends up > 10 MiB anyway (final check).
 */
async function handleUpload(
  slug: string,
  request: Request,
  env: ImagesEnv,
): Promise<Response> {
  // Cheap precheck so a 1GB upload doesn't bother the Worker pipeline.
  // Authoritative size enforcement happens after parsing because the
  // header is client-supplied and not always present.
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return payloadTooLarge("upload exceeds 10MB limit");
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("invalid multipart body");
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return badRequest("missing file field");
  }

  // file is a `File`/`Blob`. Its `type` is the MIME the browser inferred;
  // its `name` is the original filename from the upload form (or empty
  // for non-file Blob entries).
  const blob = file as File;
  const mimeType = blob.type;
  if (!MIME_TO_EXT[mimeType]) {
    return unsupportedMediaType(
      `unsupported MIME type: ${mimeType || "(none)"}`,
    );
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    return payloadTooLarge("upload exceeds 10MB limit");
  }

  const buffer = await blob.arrayBuffer();
  if (buffer.byteLength === 0) {
    return badRequest("empty file");
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return payloadTooLarge("upload exceeds 10MB limit");
  }

  const contentHash = await sha256Hex(buffer);
  const ext = MIME_TO_EXT[mimeType];
  const key = r2Key(slug, contentHash, ext);
  const src = publicSrc(slug, contentHash, ext);
  const originalFilename = blob.name || "upload";
  const size = buffer.byteLength;

  // Skip the R2 PUT if the same bytes already live there. R2 PUT is
  // technically idempotent on its own (last-write-wins on the same key),
  // but skipping the upload saves bandwidth + write ops on re-uploads.
  const existing = await env.IMAGES.head(key);
  if (!existing) {
    await env.IMAGES.put(key, buffer, {
      httpMetadata: { contentType: mimeType },
    });
  }

  // Dedupe by contentHash: re-uploading the same bytes refreshes
  // `uploadedAt` + `originalFilename` but doesn't grow the list.
  const index = await readIndex(slug, env);
  const filtered = index.filter((r) => r.contentHash !== contentHash);
  const record: ImageRecord = {
    src,
    contentHash,
    size,
    mimeType,
    originalFilename,
    uploadedAt: new Date().toISOString(),
  };
  filtered.push(record);
  await writeIndex(slug, filtered, env);

  return new Response(JSON.stringify(record), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

async function handleIndexRead(
  slug: string,
  env: ImagesEnv,
): Promise<Response> {
  const records = await readIndex(slug, env);
  return new Response(JSON.stringify({ images: records }), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

/**
 * Idempotent delete: missing index entry → still 204 (so a double-tap of
 * the delete button doesn't error). When an entry exists, both the R2
 * object and the index entry are removed.
 */
async function handleDeleteImage(
  slug: string,
  contentHash: string,
  env: ImagesEnv,
): Promise<Response> {
  if (!isContentHash(contentHash)) {
    return badRequest("invalid contentHash");
  }
  const index = await readIndex(slug, env);
  const target = index.find((r) => r.contentHash === contentHash);
  if (target) {
    const ext = MIME_TO_EXT[target.mimeType];
    if (ext) {
      await env.IMAGES.delete(r2Key(slug, contentHash, ext));
    }
  }
  const remaining = index.filter((r) => r.contentHash !== contentHash);
  if (remaining.length !== index.length) {
    await writeIndex(slug, remaining, env);
  }
  return new Response(null, { status: 204 });
}

/**
 * Public serve. Path is the segment after `/images/` — typically
 * `decks/<slug>/<hash>.<ext>`. Streams the R2 body back with the
 * original `Content-Type` (preserved on PUT) and the immutable cache
 * header. 404 when the object isn't there.
 */
async function handlePublicServe(
  path: string,
  env: ImagesEnv,
): Promise<Response> {
  const obj = await env.IMAGES.get(path);
  if (!obj) return notFound();

  const headers = new Headers({ "cache-control": IMMUTABLE_CACHE });

  // Prefer the MIME stored on R2's httpMetadata (set by us at PUT). Fall
  // back to extension-based guessing for safety; if neither is available
  // we leave the header unset so the client/CDN can sniff.
  const storedType = obj.httpMetadata?.contentType;
  if (storedType) {
    headers.set("content-type", storedType);
  } else {
    const dot = path.lastIndexOf(".");
    if (dot >= 0) {
      const ext = path.slice(dot + 1).toLowerCase();
      const guessed = EXT_TO_MIME[ext];
      if (guessed) headers.set("content-type", guessed);
    }
  }

  return new Response(obj.body, { status: 200, headers });
}

/**
 * Route a request against the images API surface. Returns a `Response`
 * for paths this handler owns, or `null` for everything else (so the
 * Worker entry can fall through to other handlers / the static assets
 * binding).
 */
export async function handleImages(
  request: Request,
  env: ImagesEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  const adminMatch = path.match(ADMIN_PATH);
  if (adminMatch) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    const slug = decodeURIComponent(adminMatch[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");

    const contentHash = adminMatch[2]
      ? decodeURIComponent(adminMatch[2])
      : null;

    if (contentHash !== null) {
      // `/api/admin/images/<slug>/<hash>` — delete only.
      if (request.method === "DELETE") {
        return handleDeleteImage(slug, contentHash, env);
      }
      return methodNotAllowed(["DELETE"]);
    }

    // `/api/admin/images/<slug>` — POST upload, GET index.
    if (request.method === "POST") return handleUpload(slug, request, env);
    if (request.method === "GET" || request.method === "HEAD") {
      return handleIndexRead(slug, env);
    }
    return methodNotAllowed(["GET", "HEAD", "POST"]);
  }

  const publicMatch = path.match(PUBLIC_PATH);
  if (publicMatch) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed(["GET", "HEAD"]);
    }
    return handlePublicServe(publicMatch[1], env);
  }

  return null;
}
