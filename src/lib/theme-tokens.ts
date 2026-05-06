/**
 * Shared theme-token contract — used by both the Worker (validating POST
 * bodies, persisting to KV) and the SPA (`useDeckTheme`, `<ThemeSidebar>`).
 *
 * v1 covers the four foundational brand tokens only. Typography / spacing /
 * the wider colour palette are deliberately deferred to v2 — see the PR for
 * issue #12.
 *
 * Source defaults below MUST stay in sync with the `@theme` block in
 * `src/styles/index.css`. They are duplicated here (instead of being
 * imported from CSS) because the Worker has no DOM access at request time
 * and runtime parsing of the bundled CSS would be brittle.
 */

export const THEME_TOKEN_NAMES = [
  "cf-bg-100",
  "cf-text",
  "cf-orange",
  "cf-border",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

/**
 * Hex strings only — `#RRGGBB`, exactly 7 characters.
 *
 * `#FFF` (3-char) is intentionally rejected: less ambiguity, one canonical
 * form, easier validation on both ends. The native `<input type="color">`
 * always produces a 7-char value.
 */
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export type ThemeTokens = Record<ThemeTokenName, string>;

export interface ThemeOverride {
  version: 1;
  tokens: ThemeTokens;
  /** ISO 8601 timestamp at write time. */
  updatedAt: string;
}

/**
 * Source defaults — must match `src/styles/index.css` `@theme`.
 *
 * Used by the sidebar to populate the "current" colour pickers when no
 * override exists, and by `useDeckTheme.clearDraft()` to revert the DOM to
 * a clean baseline on Reset.
 */
export const SOURCE_DEFAULTS: ThemeTokens = {
  "cf-bg-100": "#FFFBF5",
  "cf-text": "#521000",
  "cf-orange": "#FF4801",
  "cf-border": "#E0D3BD",
};

/** Human-readable label per token, for the sidebar UI. */
export const TOKEN_LABELS: Record<ThemeTokenName, string> = {
  "cf-bg-100": "Surface",
  "cf-text": "Text",
  "cf-orange": "Brand orange",
  "cf-border": "Border",
};

/**
 * Validate a candidate `tokens` object from a POST body.
 *
 * Requires:
 *  - exactly the four known keys (no missing, no extras)
 *  - every value matches `HEX_COLOR_REGEX`
 *
 * Returns the typed object on success, or null on failure.
 */
export function validateTokens(input: unknown): ThemeTokens | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== THEME_TOKEN_NAMES.length) return null;
  for (const name of THEME_TOKEN_NAMES) {
    const value = record[name];
    if (typeof value !== "string" || !HEX_COLOR_REGEX.test(value)) {
      return null;
    }
  }
  // Reject extras: every key must be a known token.
  for (const key of keys) {
    if (!THEME_TOKEN_NAMES.includes(key as ThemeTokenName)) return null;
  }
  return {
    "cf-bg-100": record["cf-bg-100"] as string,
    "cf-text": record["cf-text"] as string,
    "cf-orange": record["cf-orange"] as string,
    "cf-border": record["cf-border"] as string,
  };
}

/**
 * Slugs are kebab-case, lowercase, no leading/trailing hyphen, no `..`.
 * Same shape we accept in deck folders, so `/api/themes/<slug>` URLs map
 * cleanly to `theme:<slug>` KV keys.
 */
export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > 80) return false;
  if (slug.includes("..")) return false;
  return SLUG_REGEX.test(slug);
}
