/**
 * Pure helpers for the slide-03 "Talk → Decide → Act → Read" loop.
 *
 * The slide draws an animated loop with N nodes evenly spaced around a
 * circle. A "presence" dot moves continuously around the loop after the
 * second card has been revealed. The math here is split out so we can
 * unit-test it without rendering anything — keeping the slide component
 * itself as straight presentation code.
 */

/** Labels shown on the loop, in cycle order. */
export const LOOP_NODES = ["Talk", "Decide", "Act", "Read"] as const;

export type LoopNodeLabel = (typeof LOOP_NODES)[number];

export interface PointOnCircle {
  /** Cartesian X, with 0 at the centre of the circle. */
  x: number;
  /** Cartesian Y, with 0 at the centre. SVG-style: positive = down. */
  y: number;
}

/**
 * Position the i-th of `count` nodes on a circle of radius `r`.
 * Node 0 is placed at the *top* (12 o'clock) so the loop reads clockwise
 * and the first label ("Talk") sits where eyes naturally land.
 */
export function nodePosition(
  i: number,
  count: number,
  r: number,
): PointOnCircle {
  if (count <= 0) {
    throw new RangeError("count must be > 0");
  }
  // Start at -π/2 so node 0 is at 12 o'clock, then walk clockwise.
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
  return {
    x: r * Math.cos(angle),
    y: r * Math.sin(angle),
  };
}

/**
 * Position of the moving "presence" dot on the loop at time `t`
 * (seconds), given a full cycle period in seconds.
 *
 * The dot moves CONTINUOUSLY — it's never quantised to nodes — so a
 * presenter can leave the slide running and the loop "breathes".
 */
export function dotPosition(
  t: number,
  period: number,
  r: number,
): PointOnCircle {
  if (period <= 0) {
    throw new RangeError("period must be > 0");
  }
  // Normalise to [0, 1) — protect against negative t (e.g. paused clock).
  const phase = ((t % period) + period) % period;
  const angle = -Math.PI / 2 + (phase / period) * 2 * Math.PI;
  return {
    x: r * Math.cos(angle),
    y: r * Math.sin(angle),
  };
}
