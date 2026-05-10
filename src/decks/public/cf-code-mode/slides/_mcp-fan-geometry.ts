/**
 * Pure geometry for slide 04 — "What is MCP?".
 *
 * The slide shows a central "Agent" node with N tool-logo nodes
 * arranged radially around it. The math for distributing those logos
 * — angle, x, y — lives here so it can be unit-tested without
 * dragging in any DOM/SVG concerns.
 *
 * Coordinate system: standard SVG (x→right, y→down). The default
 * `startAngle` is `-π/2` so the first logo sits directly above the
 * agent, which matches how a presenter naturally reads the visual.
 */

export interface FanPosition {
  /** Angle in radians (SVG convention: 0 = right, π/2 = down). */
  angle: number;
  /** X offset from the centre. */
  x: number;
  /** Y offset from the centre. */
  y: number;
}

export interface FanOptions {
  /** Angle of the first point. Default: -π/2 (straight up). */
  startAngle?: number;
  /** Total angular sweep across all points. Default: 2π (full circle). */
  sweep?: number;
}

/**
 * Distribute `count` points around a circle of `radius` centred on
 * (0, 0). For a full circle the points are spaced `2π / count`
 * apart so they don't overlap. For a partial arc (`sweep < 2π`) the
 * step is `sweep / count` — that way the last point doesn't crash
 * into the first if the arc were ever closed. (For our deck we use
 * the full-circle case, but the partial form is here so the helper
 * stays general and easier to test.)
 */
export function fanPositions(
  count: number,
  radius: number,
  options: FanOptions = {},
): FanPosition[] {
  if (count < 0 || !Number.isFinite(count)) {
    throw new RangeError(`count must be >= 0 (got ${count})`);
  }
  if (radius <= 0 || !Number.isFinite(radius)) {
    throw new RangeError(`radius must be > 0 (got ${radius})`);
  }
  const startAngle = options.startAngle ?? -Math.PI / 2;
  const sweep = options.sweep ?? Math.PI * 2;
  const out: FanPosition[] = [];
  if (count === 0) return out;
  // Divide the sweep evenly. For a full circle this makes the points
  // collide-safe (last one is exactly one step away from the first).
  const step = sweep / count;
  for (let i = 0; i < count; i++) {
    const angle = startAngle + i * step;
    out.push({
      angle,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
  return out;
}
