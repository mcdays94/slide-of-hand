/**
 * Pure helpers for slide 10 — "Code Mode in plain English".
 *
 * The slide is a two-column comparison animated across 4 phases (0..3):
 *   Phase 0 — both columns idle, no extras
 *   Phase 1 — LEFT column piles up 8 round-trip sticky notes
 *   Phase 2 — RIGHT column performs ONE round-trip (recipe in, binder out)
 *   Phase 3 — token-cost banner fades in below both columns
 *
 * Most of the visual work is framer-motion path animation, but a few
 * data-shaped helpers benefit from being pure + unit-testable so the
 * placement of the sticky-note pile stays deterministic across renders
 * and the per-trip delays don't drift.
 */

/** Number of round-trip sticky notes the LEFT column piles up at phase 1. */
export const TOTAL_ROUND_TRIPS = 8;

/** Phase at which the RIGHT column animates its single round-trip. */
export const PHASE_RECIPE = 2;
/** Phase at which the token-cost banner reveals below both columns. */
export const PHASE_BANNER = 3;

export interface NotePlacement {
  /** Horizontal jitter from the pile centre (px). */
  x: number;
  /** Vertical offset — negative values stack the note higher (px). */
  y: number;
  /** Slight rotation so the pile feels hand-stacked (deg). */
  rotate: number;
}

/**
 * Deterministic sticky-note placement so the pile builds in a stable,
 * visually-pleasant tower without overlapping perfectly. Same `index`
 * always maps to the same coordinates, so re-renders don't jitter.
 *
 * `stackStep` controls vertical spacing between notes. Default 7px is
 * tuned so an 8-note pile fits inside the desk illustration.
 */
export function stickyNotePlacement(
  index: number,
  stackStep: number = 7,
): NotePlacement {
  if (index < 0) {
    throw new RangeError(`index must be >= 0 (got ${index})`);
  }
  // Cheap deterministic pseudo-jitter from index. Avoids Math.random
  // so SSR / reduced-motion / re-renders stay pixel-stable.
  const xJitter = (((index * 7) % 11) - 5) * 1.6;
  const rotJitter = (((index * 13) % 7) - 3) * 1.4;
  return {
    x: xJitter,
    y: index === 0 ? 0 : -(index * stackStep),
    rotate: rotJitter,
  };
}

/**
 * Per-round-trip animation start time in seconds. With the default
 * `perTrip` of 0.4s, phase 1 lasts ~3.2s — fast enough to feel
 * frantic, slow enough that the audience can read the counter ticking
 * "Round-trip 1, 2, 3, …".
 */
export function roundTripStartTime(
  index: number,
  perTrip: number = 0.4,
): number {
  if (index < 0) {
    throw new RangeError(`index must be >= 0 (got ${index})`);
  }
  if (perTrip < 0) {
    throw new RangeError(`perTrip must be >= 0 (got ${perTrip})`);
  }
  return index * perTrip;
}

/**
 * Total animation duration of phase 1 — useful for sequencing the
 * phase-1 → phase-2 hand-off, e.g. for a presenter timer.
 */
export function totalRoundTripDuration(
  count: number = TOTAL_ROUND_TRIPS,
  perTrip: number = 0.4,
  noteFlyDuration: number = 0.35,
): number {
  if (count <= 0) return 0;
  return roundTripStartTime(count - 1, perTrip) + noteFlyDuration;
}

export function showRoundTripsAt(phase: number): boolean {
  return phase >= 1;
}
export function showRecipeAt(phase: number): boolean {
  return phase >= PHASE_RECIPE;
}
export function showBannerAt(phase: number): boolean {
  return phase >= PHASE_BANNER;
}

/**
 * How many sticky-note round-trips are visible at the given phase.
 * Before phase 1 nothing is on screen; at/after phase 1 all 8 are
 * present (each note's individual delay handles its own fly-in).
 */
export function visibleNoteCount(phase: number, total: number = TOTAL_ROUND_TRIPS): number {
  return phase >= 1 ? total : 0;
}
