/**
 * Tool-scope resolution.
 *
 * Item E (issue #111). Tools previously listened on the whole window, so
 * the laser dot / magnifier lens / marker canvas would track the cursor
 * everywhere — including the presenter window's notes panel and chrome.
 *
 * To scope tools to a specific region (e.g. the current-slide preview
 * panel inside `<PresenterWindow>`), the consumer marks an element with
 * `data-presenter-tools-scope="true"`. The tools then:
 *
 *   - ignore cursor positions outside the scope's bounding rect,
 *   - treat the scope as the magnifier's clone source (instead of the
 *     deck's `[data-testid='slide-shell']`),
 *   - position the marker canvas over the scope (instead of the slide).
 *
 * Fallback: if no scope element is present, tools fall back to the
 * existing `[data-testid='slide-shell']` behaviour. That's the case for
 * the audience deck-route mounts, where the slide IS the scope and no
 * extra opt-in markup is needed.
 *
 * The scope is resolved on-demand (not cached): the consumer can mount
 * and unmount the scope element freely, and tools pick up the change
 * on the next cursor event without coordinating React state.
 */
import type { CursorPos } from "./useCursorPosition";

const SCOPE_SELECTOR = "[data-presenter-tools-scope='true']";
const FALLBACK_SELECTOR = "[data-testid='slide-shell']";

/**
 * Resolve the active tool-scope element. Returns the explicit scope
 * marker if present, otherwise the slide shell (audience-mode default),
 * otherwise null. SSR-safe.
 */
export function getToolScope(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const explicit = document.querySelector<HTMLElement>(SCOPE_SELECTOR);
  if (explicit) return explicit;
  return document.querySelector<HTMLElement>(FALLBACK_SELECTOR);
}

/**
 * True when the explicit scope marker is present (i.e. the consumer
 * has opted-in to scoped tools). Lets tools change behaviour ONLY when
 * scoping is requested — otherwise they keep their existing window-
 * wide behaviour for backwards compatibility.
 */
export function hasExplicitToolScope(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(SCOPE_SELECTOR));
}

/**
 * True when the cursor position is inside the scope's bounding rect.
 * If the scope is null (SSR or pre-mount) this returns true so tools
 * don't accidentally hide on the very first paint.
 */
export function isCursorInScope(
  pos: CursorPos | null,
  scope: HTMLElement | null,
): boolean {
  if (!scope) return true; // permissive — no scope = no constraint
  if (!pos) return true;
  const r = scope.getBoundingClientRect();
  return (
    pos.x >= r.left &&
    pos.x <= r.right &&
    pos.y >= r.top &&
    pos.y <= r.bottom
  );
}

/**
 * Normalise a viewport-coordinate cursor position to 0..1 within the
 * scope's bounding rect. Used by item F's cross-window broadcast to
 * send size-agnostic coordinates.
 *
 * Returns null when the scope is missing or the cursor is outside.
 */
export function normalizeCursorToScope(
  pos: CursorPos | null,
  scope: HTMLElement | null,
): { x: number; y: number } | null {
  if (!pos || !scope) return null;
  const r = scope.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const x = (pos.x - r.left) / r.width;
  const y = (pos.y - r.top) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/**
 * Inverse of `normalizeCursorToScope` — map a 0..1 coordinate back to
 * viewport pixels for the GIVEN scope element. Used by the audience
 * window in item F to render an overlay at coordinates broadcast by
 * the presenter window.
 */
export function denormalizeCursorFromScope(
  norm: { x: number; y: number },
  scope: HTMLElement | null,
): CursorPos | null {
  if (!scope) return null;
  const r = scope.getBoundingClientRect();
  return {
    x: r.left + norm.x * r.width,
    y: r.top + norm.y * r.height,
  };
}
