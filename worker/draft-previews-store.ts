/**
 * Draft-preview mapping storage (issue #268 / PRD #178).
 *
 * Reads + writes opaque `pv_<hex>` → `DraftPreviewMapping` records
 * against the existing `DECKS` KV namespace. No new Cloudflare binding
 * is introduced. Two key shapes:
 *
 *   - `draft-preview:<previewId>`                  — source of truth
 *     for a single preview. JSON-serialised `DraftPreviewMapping`.
 *
 *   - `draft-preview-by-slug:<ownerHash>:<slug>`   — pointer to the
 *     `previewId` for a given (owner, slug) pair. Lets future slices
 *     (#270 / #271) look up the current preview for "the draft I'm
 *     about to commit to" without scanning every previewId. The owner
 *     half of the key is HASHED (`hashOwnerForKey`) so raw email
 *     addresses never appear in KV keys.
 *
 * The record itself includes `ownerEmail` in plaintext — KV is an
 * admin-only surface (Access-gated everywhere it's exposed). The
 * downstream rule that the route handler is responsible for: NEVER
 * surface `ownerEmail` or `draftRepoName` to an unauthenticated or
 * non-owner caller. See `worker/preview-route.ts` for the gate.
 *
 * Eventual-consistency note: KV has no transactions, so we accept that
 * the by-slug pointer + the record can drift. The record key is the
 * source of truth; the by-slug pointer is a cache. On every upsert we
 * re-write both; on every delete we remove both.
 */

import {
  generatePreviewId,
  isValidPreviewId,
  isValidPreviewSha,
  validateDraftPreviewMapping,
  type DraftPreviewMapping,
} from "../src/lib/draft-previews";
import { isValidSlug } from "../src/lib/theme-tokens";

// ---------------------------------------------------------------- //
// Env + key shapes
// ---------------------------------------------------------------- //

export interface DraftPreviewStoreEnv {
  DECKS: KVNamespace;
}

const RECORD_PREFIX = "draft-preview:";
const BY_SLUG_PREFIX = "draft-preview-by-slug:";

export function draftPreviewKey(previewId: string): string {
  return `${RECORD_PREFIX}${previewId}`;
}

export function draftPreviewBySlugKey(ownerHash: string, slug: string): string {
  return `${BY_SLUG_PREFIX}${ownerHash}:${slug}`;
}

// ---------------------------------------------------------------- //
// Owner hash
// ---------------------------------------------------------------- //

/**
 * Hash an owner email for use in a KV key. SHA-256, hex-encoded,
 * lowercased + trimmed input. This is a privacy / hygiene measure:
 * KV key names appear in dashboards, logs, and (when you `wrangler
 * kv key list`) bulk output. Raw emails in keys are an easy
 * surface-area leak. The hash is non-cryptographically-strong against
 * a determined attacker who already has the email (they can hash it
 * themselves and probe for the key) but that's outside our threat
 * model — KV is admin-only anyway. The hash buys us no-incidental-leak
 * hygiene.
 *
 * Truncated to 32 hex chars (128 bits) for compactness. Collision
 * resistance at 128 bits is plenty for tens of thousands of users.
 */
export async function hashOwnerForKey(owner: string): Promise<string> {
  const normalized = owner.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex.slice(0, 32);
}

// ---------------------------------------------------------------- //
// Upsert
// ---------------------------------------------------------------- //

export interface UpsertDraftPreviewInput {
  ownerEmail: string;
  slug: string;
  draftRepoName: string;
  latestCommitSha: string;
  /** Test seam — defaults to `new Date()` when omitted. */
  now?: Date;
}

/**
 * Create or update the mapping for `(ownerEmail, slug)`. If a previous
 * mapping exists for the same pair, the existing `previewId` and
 * `createdAt` are preserved; `latestCommitSha`, `draftRepoName` and
 * `updatedAt` are refreshed.
 *
 * Throws on invalid input shape — callers should validate at the
 * route layer before calling (the throw is a backstop).
 */
export async function upsertDraftPreviewMapping(
  env: DraftPreviewStoreEnv,
  input: UpsertDraftPreviewInput,
): Promise<DraftPreviewMapping> {
  if (typeof input.ownerEmail !== "string" || input.ownerEmail.trim() === "") {
    throw new Error("ownerEmail must be a non-empty string");
  }
  if (!isValidSlug(input.slug)) {
    throw new Error(`invalid slug: ${input.slug}`);
  }
  if (typeof input.draftRepoName !== "string" || input.draftRepoName.trim() === "") {
    throw new Error("draftRepoName must be a non-empty string");
  }
  if (!isValidPreviewSha(input.latestCommitSha)) {
    throw new Error(
      `invalid commit sha (expected 7-64 lowercase hex chars): ${input.latestCommitSha}`,
    );
  }

  const now = (input.now ?? new Date()).toISOString();
  const ownerHash = await hashOwnerForKey(input.ownerEmail);
  const pointerKey = draftPreviewBySlugKey(ownerHash, input.slug);

  // Reuse an existing previewId for this (owner, slug) pair so future
  // commits don't churn opaque ids.
  const existingPreviewId = await env.DECKS.get(pointerKey);
  let createdAt = now;
  let previewId: string;
  if (existingPreviewId && isValidPreviewId(existingPreviewId)) {
    previewId = existingPreviewId;
    const stored = (await env.DECKS.get(
      draftPreviewKey(previewId),
      "json",
    )) as unknown;
    const parsed = validateDraftPreviewMapping(stored);
    if (parsed.ok) createdAt = parsed.value.createdAt;
  } else {
    previewId = generatePreviewId();
  }

  const record: DraftPreviewMapping = {
    previewId,
    ownerEmail: input.ownerEmail,
    draftRepoName: input.draftRepoName,
    slug: input.slug,
    latestCommitSha: input.latestCommitSha,
    createdAt,
    updatedAt: now,
  };

  await env.DECKS.put(draftPreviewKey(previewId), JSON.stringify(record));
  await env.DECKS.put(pointerKey, previewId);

  return record;
}

// ---------------------------------------------------------------- //
// Lookup
// ---------------------------------------------------------------- //

/**
 * Look up a mapping by opaque previewId. Returns `null` for unknown
 * ids OR for syntactically invalid ids (so route handlers can pass the
 * raw URL chunk through without pre-validating).
 *
 * Also returns `null` when the stored record fails validation — a
 * corrupted record is treated as missing. The corresponding
 * `draft-preview:<previewId>` key is left in place so an operator
 * notices the corruption rather than the system silently rewriting
 * the bad value.
 */
export async function getDraftPreviewMapping(
  env: DraftPreviewStoreEnv,
  previewId: string,
): Promise<DraftPreviewMapping | null> {
  if (!isValidPreviewId(previewId)) return null;
  const stored = (await env.DECKS.get(
    draftPreviewKey(previewId),
    "json",
  )) as unknown;
  if (stored === null) return null;
  const parsed = validateDraftPreviewMapping(stored);
  if (!parsed.ok) return null;
  return parsed.value;
}

/**
 * Look up a mapping by (owner, slug). Walks the by-slug pointer +
 * record. Returns `null` if the pointer is missing or the record
 * fails validation.
 */
export async function getDraftPreviewMappingBySlug(
  env: DraftPreviewStoreEnv,
  ownerEmail: string,
  slug: string,
): Promise<DraftPreviewMapping | null> {
  if (!isValidSlug(slug)) return null;
  if (typeof ownerEmail !== "string" || ownerEmail.trim() === "") return null;
  const ownerHash = await hashOwnerForKey(ownerEmail);
  const previewId = await env.DECKS.get(draftPreviewBySlugKey(ownerHash, slug));
  if (!previewId) return null;
  return getDraftPreviewMapping(env, previewId);
}

// ---------------------------------------------------------------- //
// Delete
// ---------------------------------------------------------------- //

/**
 * Remove a mapping by previewId. Idempotent — calling with an unknown
 * or invalid id is a no-op. Removes both the record AND the by-slug
 * pointer (looked up from the record before deletion).
 */
export async function deleteDraftPreviewMapping(
  env: DraftPreviewStoreEnv,
  previewId: string,
): Promise<void> {
  if (!isValidPreviewId(previewId)) return;
  const existing = await getDraftPreviewMapping(env, previewId);
  await env.DECKS.delete(draftPreviewKey(previewId));
  if (existing) {
    const ownerHash = await hashOwnerForKey(existing.ownerEmail);
    await env.DECKS.delete(draftPreviewBySlugKey(ownerHash, existing.slug));
  }
}
