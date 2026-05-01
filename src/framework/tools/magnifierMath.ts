/**
 * Pure math for the Magnifier.
 *
 * Extracted from `Magnifier.tsx` so it can be unit-tested without happy-dom
 * canvas / fixed-positioning quirks.
 *
 * Coordinate model:
 *   - `mouseX` / `mouseY` are viewport-relative (page coords from MouseEvent).
 *   - `slideRect` is the slide-shell's `getBoundingClientRect()`.
 *   - The magnifier is a circular overlay of `size`×`size` pixels whose
 *     CENTER tracks the cursor.
 *   - Inside the overlay we render an absolutely-positioned clone of the
 *     slide DOM, scaled by `zoom` from its top-left corner.
 *
 * What we compute:
 *   - `left` / `top` — fixed-position coords for the overlay (so the cursor
 *     lands at the overlay's center).
 *   - `cloneOriginX` / `cloneOriginY` — offset for the cloned slide inside
 *     the overlay so that, after scaling, the slide-relative point under
 *     the cursor lands at the overlay's center.
 */

export const MAGNIFIER_ZOOM = 2;
export const MAGNIFIER_SIZE = 250;

export interface SlideRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MagnifierPlacement {
  /** Overlay position (fixed-coords). */
  left: number;
  top: number;
  /** Clone position inside the overlay (so cursor's slide point lands at center). */
  cloneOriginX: number;
  cloneOriginY: number;
}

export function computeMagnifierPlacement(
  mouseX: number,
  mouseY: number,
  slideRect: SlideRect,
  zoom: number = MAGNIFIER_ZOOM,
  size: number = MAGNIFIER_SIZE,
): MagnifierPlacement {
  const half = size / 2;

  // Overlay center tracks cursor.
  const left = mouseX - half;
  const top = mouseY - half;

  // Cursor position in slide-local coords.
  const localX = mouseX - slideRect.left;
  const localY = mouseY - slideRect.top;

  // After scaling by `zoom` from origin (0,0), the local point lands at
  // (localX*zoom, localY*zoom). We want it at (half, half), so shift the
  // clone by the difference.
  const cloneOriginX = half - localX * zoom;
  const cloneOriginY = half - localY * zoom;

  return { left, top, cloneOriginX, cloneOriginY };
}
