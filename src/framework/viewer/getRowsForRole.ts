/**
 * `getRowsForRole` — pure helper mapping the effective slide list to the
 * per-role row list rendered by `<SlideManager>` (a.k.a. ToC sidebar).
 *
 * Per CONTEXT.md:
 *   - **Admin** sees ALL effective slides in the sidebar (Hidden ones
 *     rendered with muted text + strike-through, still clickable).
 *   - **Audience** sees only non-Hidden effective slides — Hidden ones
 *     are filtered out entirely (no muted row, no eye affordance).
 *
 * Per ADR 0003 the deck cursor is keyed against `effectiveSlides`, NOT
 * the filtered audience list. So each row carries its original
 * `effectiveIndex` — i.e. its position in the unfiltered list — and
 * row-click navigation (admin AND audience) calls
 * `gotoEffectiveWithBeacon(row.effectiveIndex)` so the cursor lands on
 * the right slide regardless of how many hidden slides preceded it.
 */

import type { SlideDef } from "./types";

export type SlideManagerRole = "admin" | "audience";

export interface SlideManagerRow {
  /** The effective slide rendered by this row. Same reference as the input. */
  slide: SlideDef;
  /** Position of `slide` in the UNFILTERED `effectiveSlides` list. */
  effectiveIndex: number;
}

/**
 * Project the effective slides list to the role-appropriate row list.
 * Pure: no mutation, deterministic, no side effects.
 */
export function getRowsForRole(
  effectiveSlides: SlideDef[],
  role: SlideManagerRole,
): SlideManagerRow[] {
  const rows: SlideManagerRow[] = [];
  for (let i = 0; i < effectiveSlides.length; i++) {
    const slide = effectiveSlides[i];
    if (role === "audience" && slide.hidden === true) continue;
    rows.push({ slide, effectiveIndex: i });
  }
  return rows;
}
