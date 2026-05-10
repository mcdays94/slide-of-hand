/**
 * Pure-logic helpers for slide 13 — the V8-isolate-vs-VM-vs-container
 * race-track visual. Kept module-local (no React imports) so it's
 * unit-testable without a DOM and so the JSX layer stays declarative.
 *
 * The slide animates a virtual "elapsed time" cursor; phase advances
 * move the cursor to one of a handful of named instants:
 *
 *   phase 0 — t = 0     (everyone at start line)
 *   phase 1 — t = 5,000 (race plays out: V8 ≪ VM ≪ Container)
 *   phase 2 — t = 5,000 (V8 ghost-trail snapshot of 300+ races appears)
 *   phase 3 — t = 5,000 (cost stat slides in over the held frame)
 *
 * Phase 2 and 3 hold the elapsed-time cursor steady on purpose: the
 * race itself is over, the slide is now annotating what just happened.
 *
 * ## Wall-clock vs race-time
 *
 * A literal mapping from race-time to wall-time would put the V8
 * isolate at the finish line in 5/5000 = 0.001 of the wall-clock
 * duration — that's 5 ms of stage time, completely invisible.
 *
 * To keep the dramatic relationship ("V8 finishes long before the
 * container even gets going") legible to a live audience, we warp the
 * mapping with a cube-root curve. The container still takes the full
 * `RACE_WALL_DURATION_S` of wall time, but V8 and VM get a meaningful
 * head start that's still clearly ordered V8 < VM < Container.
 */

/** Reference runner durations (ms). Sourced from the Cloudflare blog. */
export const CONTAINER_MS = 5_000;
export const VM_MS = 1_500;
/** V8 isolates are 5–15 ms; we use the generous end of the range. */
export const ISOLATE_MS = 15;

/**
 * Wall-clock duration (seconds) for the slowest runner — the container
 * — to traverse the entire track. Faster runners derive their wall
 * time from this via {@link wallDurationForRunner}. Five seconds is
 * tuned for stage delivery: long enough to feel painful, short enough
 * not to bore the audience.
 */
export const RACE_WALL_DURATION_S = 5;

/**
 * Phase → elapsed-time (ms). Indexed by phase number 0..3 so a JSX
 * caller can do `RACE_PHASE_TIMES_MS[phase]` without a switch.
 */
export const RACE_PHASE_TIMES_MS: readonly number[] = [
  /* phase 0 */ 0,
  /* phase 1 */ 5_000,
  /* phase 2 */ 5_000,
  /* phase 3 */ 5_000,
] as const;

/**
 * How many isolate "races" finish in `t` ms when each takes
 * `isolateMs`. Floored — only completed races count. This is the
 * single source of truth for the slide's "300 races completed" badge.
 *
 * @throws RangeError if `t` < 0 or `isolateMs` <= 0.
 */
export function racesCompletedAt(t: number, isolateMs: number): number {
  if (t < 0) throw new RangeError("racesCompletedAt: t must be >= 0");
  if (isolateMs <= 0) throw new RangeError("racesCompletedAt: isolateMs must be > 0");
  return Math.floor(t / isolateMs);
}

/**
 * Position of a runner along its track (0 = start, 1 = finish).
 * Negative `elapsed` clamps to 0; `elapsed >= runnerMs` clamps to 1.
 *
 * @throws RangeError if `runnerMs` <= 0.
 */
export function progressFractionAt(elapsed: number, runnerMs: number): number {
  if (runnerMs <= 0) throw new RangeError("progressFractionAt: runnerMs must be > 0");
  if (elapsed <= 0) return 0;
  if (elapsed >= runnerMs) return 1;
  return elapsed / runnerMs;
}

/**
 * Wall-clock duration (seconds) of a runner's traversal animation.
 *
 * The container always anchors at `totalS`. Faster runners are warped
 * with a cube-root curve so a 333× speedup in race-time still maps to
 * a *visible* (~0.7 s) sprint on stage rather than a single frame.
 *
 *   wallDurationForRunner(   15) → ~0.72 s   ← V8 isolate
 *   wallDurationForRunner( 1500) → ~3.35 s   ← virtual machine
 *   wallDurationForRunner( 5000) →  5.00 s   ← container
 *
 * Critically, ordering is preserved: faster cold-start ⇒ shorter wall
 * time, so the audience sees V8 cross first, VM second, container last.
 *
 * @throws RangeError if any argument is non-positive.
 */
export function wallDurationForRunner(
  runnerMs: number,
  totalMs: number = CONTAINER_MS,
  totalS: number = RACE_WALL_DURATION_S,
): number {
  if (runnerMs <= 0) throw new RangeError("wallDurationForRunner: runnerMs must be > 0");
  if (totalMs <= 0) throw new RangeError("wallDurationForRunner: totalMs must be > 0");
  if (totalS <= 0) throw new RangeError("wallDurationForRunner: totalS must be > 0");
  if (runnerMs >= totalMs) return totalS;
  // Cube root preserves order, compresses large ratios, expands small
  // ones. A 333× speedup (5000/15) compresses to a ~7× wall-time gap
  // (5/0.72) — dramatic enough to read from row 12 of an event hall
  // without making V8 invisible.
  const warp = Math.cbrt(runnerMs / totalMs);
  return warp * totalS;
}

/**
 * Evenly-spaced fractional positions [0..1) representing where each
 * "ghost trail" copy of the V8 runner should sit behind the leading
 * runner. Caps at `max` ghosts so the SVG layer stays cheap (we never
 * actually render 300 trails — it'd be visual noise and slow). When
 * count < max, every ghost gets its own slot.
 *
 *   ghostTrailOffsets(3, 10) → [0.25, 0.50, 0.75]
 *   ghostTrailOffsets(5, 10) → [~0.166, ~0.333, ~0.5, ~0.666, ~0.833]
 *
 * @throws RangeError if count < 0 or max <= 0.
 */
export function ghostTrailOffsets(count: number, max: number): number[] {
  if (count < 0) throw new RangeError("ghostTrailOffsets: count must be >= 0");
  if (max <= 0) throw new RangeError("ghostTrailOffsets: max must be > 0");
  const n = Math.min(count, max);
  if (n === 0) return [];
  const offsets: number[] = [];
  for (let i = 1; i <= n; i++) {
    offsets.push(i / (n + 1));
  }
  return offsets;
}

/**
 * Render `ms` (rounded to a whole millisecond) with a comma thousands
 * separator and the trailing " ms" unit. Display-only — never feed
 * this back into a calculation.
 */
export function formatMillis(ms: number): string {
  const whole = Math.round(ms);
  return `${whole.toLocaleString("en-US")} ms`;
}
