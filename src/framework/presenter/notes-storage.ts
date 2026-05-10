/**
 * Per-slide notes overrides — localStorage layer.
 *
 * Item G (issue #111). Speaker notes authored at build-time live on
 * `slide.notes` (a `ReactNode` in the deck source). The presenter view
 * lets the user edit notes in-place; their edits are saved to
 * localStorage so reloads keep them, and the presenter can return to
 * the build-time default by clearing.
 *
 * Storage shape per the brief:
 *   key   = `slide-of-hand-notes:<deck-slug>:<slide-index>`
 *   value = the user's edited markdown source (NOT HTML)
 *
 * The presenter UI converts between markdown <-> HTML for the
 * WYSIWYG view, but the persistence boundary is markdown — a stable,
 * portable format that survives editor changes.
 *
 * Future: a sync layer can replace the localStorage backend without
 * changing the storage key shape.
 */

const KEY_PREFIX = "slide-of-hand-notes";

export function notesStorageKey(slug: string, slideIndex: number): string {
  return `${KEY_PREFIX}:${slug}:${slideIndex}`;
}

/**
 * Read the persisted markdown override for a (deck, slide) pair.
 * Returns null when nothing is persisted (use the build-time default).
 * SSR-safe.
 */
export function readNotesOverride(
  slug: string,
  slideIndex: number,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(notesStorageKey(slug, slideIndex));
    return raw;
  } catch {
    return null;
  }
}

/** Write a markdown override. Empty string clears (calls remove). */
export function writeNotesOverride(
  slug: string,
  slideIndex: number,
  markdown: string,
): void {
  if (typeof window === "undefined") return;
  try {
    if (markdown === "") {
      window.localStorage.removeItem(notesStorageKey(slug, slideIndex));
    } else {
      window.localStorage.setItem(
        notesStorageKey(slug, slideIndex),
        markdown,
      );
    }
  } catch {
    /* quota / private mode */
  }
}

/** Remove the override (revert to build-time default). */
export function clearNotesOverride(slug: string, slideIndex: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(notesStorageKey(slug, slideIndex));
  } catch {
    /* ignore */
  }
}
