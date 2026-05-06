/**
 * Slide-manifest contract — shared between the Worker (validating POST
 * bodies, persisting to KV) and the SPA (`useDeckManifest`,
 * `<SlideManager>`, `<Deck>`).
 *
 * A manifest is a thin layer over a deck's source slide list. It lets
 * the author reorder slides, hide/show them, rename them, and replace
 * their speaker notes with a markdown blob — all without editing the
 * source `.tsx`. Anything more invasive (creating or deleting slides)
 * is intentionally out of scope and lives in the IDE.
 *
 * Shape (as persisted to KV at `manifest:<slug>`):
 *
 *   {
 *     version: 1,
 *     order: ["title", "intro", "middle", "end"],
 *     overrides: {
 *       intro: { hidden: false, title: "Renamed", notes: "**bold**" }
 *     },
 *     updatedAt: "2026-05-06T10:00:00.000Z"
 *   }
 *
 * This file is JSX-free — it is imported by the Worker (which has no
 * React runtime). The merge step that turns markdown notes into
 * ReactNodes lives in `manifest-merge.tsx` alongside `mergeNotes`.
 */

export const MANIFEST_VERSION = 1 as const;

/** A per-slide override. All fields are optional. */
export interface SlideOverride {
  hidden?: boolean;
  title?: string;
  /** Markdown source. Rendered to JSX by `mergeNotes`. */
  notes?: string;
}

export interface Manifest {
  version: typeof MANIFEST_VERSION;
  /** Slide IDs in the desired display order. */
  order: string[];
  /** Sparse map of slide ID → override fields. */
  overrides: Record<string, SlideOverride>;
  /** ISO 8601 timestamp at write time. */
  updatedAt: string;
}

/** The unwrapped record persisted to KV (no `version` / no `updatedAt`). */
export interface ManifestPayload {
  order: string[];
  overrides: Record<string, SlideOverride>;
}

// Slide IDs are kebab-case identifiers — same shape as the source slide
// `id` field. Reuse the slug regex from theme-tokens (deliberately
// duplicated here to avoid coupling the manifest module to the theme
// module).
const ID_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const MAX_TITLE = 200;
export const MAX_NOTES_LENGTH = 10_000;

const ALLOWED_OVERRIDE_KEYS = new Set(["hidden", "title", "notes"]);

// ── Validation ────────────────────────────────────────────────────────────

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input)
  );
}

/**
 * Validate the body of `POST /api/admin/manifests/<slug>` and return a
 * normalized payload.
 *
 * Required:
 *  - `order` is an array of unique kebab-case strings
 *  - `overrides` is an object whose values are objects with optional
 *    `hidden` (boolean), `title` (string ≤ 200), `notes` (string ≤
 *    10000) — and no other keys
 */
export function validateManifestBody(
  input: unknown,
): ValidationResult<ManifestPayload> {
  if (!isPlainObject(input)) return fail("body must be an object");

  const { order, overrides } = input;

  if (!Array.isArray(order)) return fail("order must be an array");
  const seen = new Set<string>();
  for (const id of order) {
    if (typeof id !== "string") {
      return fail("order entries must be strings");
    }
    if (id.length === 0 || id.length > 80) {
      return fail("order entries must be 1–80 chars");
    }
    if (id.includes("..") || !ID_REGEX.test(id)) {
      return fail(`order entry "${id}" is not a valid slide id`);
    }
    if (seen.has(id)) return fail(`order contains duplicate "${id}"`);
    seen.add(id);
  }

  if (!isPlainObject(overrides)) return fail("overrides must be an object");
  const normalizedOverrides: Record<string, SlideOverride> = {};
  for (const [key, raw] of Object.entries(overrides)) {
    if (!isPlainObject(raw)) {
      return fail(`override "${key}" must be an object`);
    }
    for (const k of Object.keys(raw)) {
      if (!ALLOWED_OVERRIDE_KEYS.has(k)) {
        return fail(`override "${key}" has unknown field "${k}"`);
      }
    }
    const entry: SlideOverride = {};
    if ("hidden" in raw) {
      if (typeof raw.hidden !== "boolean") {
        return fail(`override "${key}".hidden must be a boolean`);
      }
      entry.hidden = raw.hidden;
    }
    if ("title" in raw) {
      if (typeof raw.title !== "string") {
        return fail(`override "${key}".title must be a string`);
      }
      if (raw.title.length > MAX_TITLE) {
        return fail(
          `override "${key}".title exceeds ${MAX_TITLE} chars`,
        );
      }
      entry.title = raw.title;
    }
    if ("notes" in raw) {
      if (typeof raw.notes !== "string") {
        return fail(`override "${key}".notes must be a string`);
      }
      if (raw.notes.length > MAX_NOTES_LENGTH) {
        return fail(
          `override "${key}".notes exceeds ${MAX_NOTES_LENGTH} chars`,
        );
      }
      entry.notes = raw.notes;
    }
    normalizedOverrides[key] = entry;
  }

  return { ok: true, value: { order, overrides: normalizedOverrides } };
}

/**
 * Slugs are kebab-case, lowercase, no leading/trailing hyphen, no `..`.
 * Mirrors `isValidSlug` in `theme-tokens.ts` — duplicated to keep the
 * manifest module self-contained.
 */
export function isValidSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > 80) return false;
  if (slug.includes("..")) return false;
  return ID_REGEX.test(slug);
}
