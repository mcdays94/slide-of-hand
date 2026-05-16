/**
 * Draft preview contract — shared types, validators, and route parser
 * (issue #268 / PRD #178).
 *
 * The draft-preview surface exposes builds from the AI agent's draft
 * Artifacts repos under a URL whose only client-visible identifier is
 * an OPAQUE `previewId`:
 *
 *     /preview/<previewId>/<sha>/<path...>
 *
 * Examples:
 *   /preview/pv_0123456789abcdef/07a3259/index.html
 *   /preview/pv_0123456789abcdef/07a3259/assets/index-XYZ.js
 *
 * `previewId` is intentionally NOT derived from the draft repo name,
 * the deck slug, or the owner email. Those are all either user-typed
 * (sensitive) or guessable. The previewId is a server-minted random
 * token that maps via KV to the underlying record.
 *
 * The wire-visible mapping record is:
 *
 *     {
 *       previewId:       string  // pv_<hex...>
 *       ownerEmail:      string  // for owner gate; never logged or returned publicly
 *       draftRepoName:   string  // backing Artifacts repo (#270/#271)
 *       slug:            string  // deck slug (kebab-case)
 *       latestCommitSha: string  // most-recent commit served at the route
 *       createdAt:       string  // ISO 8601
 *       updatedAt:       string  // ISO 8601
 *     }
 *
 * Records live in the existing `DECKS` KV namespace (no new binding)
 * with key shape `draft-preview:<previewId>`. A second key
 * `draft-preview-by-slug:<ownerHash>:<slug>` lets future slices look
 * up the previewId for an owner+slug pair without scanning. The
 * owner key is HASHED so KV keys never contain raw emails.
 *
 * This module is shared between the Worker (which reads + writes
 * records) and the future Studio UI helpers. It contains NO storage
 * code — only types, validators, and the URL parser. Storage helpers
 * live in `worker/draft-previews-store.ts`.
 */

import { isValidSlug } from "./theme-tokens";

// ---------------------------------------------------------------- //
// Constants
// ---------------------------------------------------------------- //

/**
 * Opaque preview id. `pv_` prefix gives a clean visual identifier
 * (so an id leaked in logs is recognisable) plus at least 16 lowercase
 * hex characters of entropy. 16 hex chars = 64 bits, plenty for the
 * threat model — the id is supplied by the server, never guessable.
 */
const PREVIEW_ID_REGEX = /^pv_[0-9a-f]{16,}$/;

/**
 * Commit SHA — between 7 (git short) and 40 (full SHA-1), lowercase
 * hex. The full SHA-256 SHA (64 hex chars) is also accepted to be
 * future-proof against the eventual git transition.
 */
const SHA_REGEX = /^[0-9a-f]{7,64}$/;

const ROUTE_PREFIX = "/preview/";

// ---------------------------------------------------------------- //
// Types
// ---------------------------------------------------------------- //

export interface DraftPreviewMapping {
  /** Opaque server-minted id used in the public URL. */
  previewId: string;
  /**
   * Cloudflare Access user email of the draft owner. Used to gate
   * `/preview/...` requests so only the owning user can view their
   * own draft previews. NEVER returned to unauthenticated callers
   * and NEVER logged. Lives in admin-only KV.
   */
  ownerEmail: string;
  /**
   * Underlying Artifacts repo backing the draft. Internal-only:
   * exposing this would leak user-derived names in URLs (the exact
   * issue this contract was designed to fix).
   */
  draftRepoName: string;
  /** Deck slug. Kebab-case, matches the slug elsewhere in the system. */
  slug: string;
  /** Most-recent commit sha the preview surface should serve. */
  latestCommitSha: string;
  /** ISO 8601 record-creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
}

/** Result of `parsePreviewRoute()`. */
export type PreviewRouteParse =
  | {
      ok: true;
      previewId: string;
      sha: string;
      /** Remainder of the URL path after `<previewId>/<sha>/`. */
      path: string;
    }
  | { ok: false; reason: "not-preview" | "malformed" };

// ---------------------------------------------------------------- //
// Validators
// ---------------------------------------------------------------- //

export function isValidPreviewId(value: string): boolean {
  if (typeof value !== "string") return false;
  return PREVIEW_ID_REGEX.test(value);
}

export function isValidPreviewSha(value: string): boolean {
  if (typeof value !== "string") return false;
  return SHA_REGEX.test(value);
}

// ---------------------------------------------------------------- //
// Route parser
// ---------------------------------------------------------------- //

/**
 * Parse a request pathname against the `/preview/<previewId>/<sha>/<path...>`
 * contract. Returns a discriminated result so callers can distinguish:
 *
 *   - `not-preview`  → pathname is outside the route (fall through)
 *   - `malformed`    → pathname is inside `/preview/` but doesn't
 *                      match the contract (returned as 400 by the
 *                      route handler so callers can debug bad URLs)
 *   - `ok: true`     → parsed `previewId`, `sha`, and `path`
 *
 * `path` is what remains after `<previewId>/<sha>/`. It is REJECTED
 * (returned as malformed) when it contains `..` segments so a bad
 * URL cannot escape the bundle root via path traversal.
 */
export function parsePreviewRoute(pathname: string): PreviewRouteParse {
  if (!pathname.startsWith(ROUTE_PREFIX)) {
    return { ok: false, reason: "not-preview" };
  }
  const rest = pathname.slice(ROUTE_PREFIX.length);
  if (rest === "") return { ok: false, reason: "malformed" };

  // Split into at most 3 chunks: previewId, sha, and the rest of the
  // path (which may itself contain `/`). We split on the first two
  // `/` characters explicitly.
  const firstSlash = rest.indexOf("/");
  if (firstSlash <= 0) return { ok: false, reason: "malformed" };
  const previewId = rest.slice(0, firstSlash);
  const afterId = rest.slice(firstSlash + 1);
  if (afterId === "") return { ok: false, reason: "malformed" };

  const secondSlash = afterId.indexOf("/");
  if (secondSlash <= 0) return { ok: false, reason: "malformed" };
  const sha = afterId.slice(0, secondSlash);
  const path = afterId.slice(secondSlash + 1);

  if (!isValidPreviewId(previewId)) return { ok: false, reason: "malformed" };
  if (!isValidPreviewSha(sha)) return { ok: false, reason: "malformed" };
  if (path === "") return { ok: false, reason: "malformed" };

  // Defence in depth: reject path-traversal segments so a malformed
  // URL can't reach outside the bundle root. We check explicit `..`
  // segments rather than every dotted name (legitimate bundle paths
  // often contain `.` — e.g. `index-XYZ.js`, `vendor.123abc.js`).
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === ".." || seg === "" || seg === ".") {
      return { ok: false, reason: "malformed" };
    }
  }

  return { ok: true, previewId, sha, path };
}

// ---------------------------------------------------------------- //
// Wire-shape validator for KV records
// ---------------------------------------------------------------- //

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

/**
 * Validate the shape of a `DraftPreviewMapping` record. Used by the
 * KV upsert path to refuse malformed writes BEFORE they hit storage,
 * and by the KV read path to defend against stale / corrupted entries.
 *
 * Returns the parsed record on success or a human-readable error
 * string on failure.
 */
export function validateDraftPreviewMapping(
  raw: unknown,
):
  | { ok: true; value: DraftPreviewMapping }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "record must be an object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.previewId !== "string" || !isValidPreviewId(r.previewId)) {
    return { ok: false, error: "previewId must be a valid pv_<hex> id" };
  }
  if (typeof r.ownerEmail !== "string" || r.ownerEmail.trim() === "") {
    return { ok: false, error: "ownerEmail must be a non-empty string" };
  }
  if (typeof r.draftRepoName !== "string" || r.draftRepoName.trim() === "") {
    return { ok: false, error: "draftRepoName must be a non-empty string" };
  }
  if (typeof r.slug !== "string" || !isValidSlug(r.slug)) {
    return { ok: false, error: "slug must be a valid kebab-case slug" };
  }
  if (
    typeof r.latestCommitSha !== "string" ||
    !isValidPreviewSha(r.latestCommitSha)
  ) {
    return {
      ok: false,
      error: "latestCommitSha must be a lowercase hex sha (7-64 chars)",
    };
  }
  if (!isIsoTimestamp(r.createdAt)) {
    return { ok: false, error: "createdAt must be an ISO 8601 timestamp" };
  }
  if (!isIsoTimestamp(r.updatedAt)) {
    return { ok: false, error: "updatedAt must be an ISO 8601 timestamp" };
  }
  return {
    ok: true,
    value: {
      previewId: r.previewId,
      ownerEmail: r.ownerEmail,
      draftRepoName: r.draftRepoName,
      slug: r.slug,
      latestCommitSha: r.latestCommitSha,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    },
  };
}

// ---------------------------------------------------------------- //
// ID generation
// ---------------------------------------------------------------- //

/**
 * Generate a fresh `pv_<32-hex>` opaque preview id. 128 bits of entropy
 * — far more than needed for the threat model but cheap. Uses Web
 * Crypto (`crypto.getRandomValues`) which is available in both Workers
 * and modern browsers / Node 18+. Tests stub this via the calling
 * helper rather than mocking the global.
 */
export function generatePreviewId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `pv_${hex}`;
}
