/**
 * Pure logic for slide 15 ("Four things to remember.") — extracted so it
 * can be unit-tested without React.
 *
 * The recap fires a "tokens saved" counter that climbs as each of the
 * four pillars reveals. The published Code Mode launch post quotes the
 * round-trip difference as moving from ~18,000 tokens (15 MCP servers,
 * full schema upload + tool-call back-and-forth) down to ~1,069 tokens
 * (a single Code Mode round-trip). That ~17,000-token delta is the
 * counter's terminal value.
 *
 * Distribution per pillar is intentionally non-uniform — the most
 * impactful insight (Code Mode = one round-trip) gets the biggest jump
 * so the counter feels weighted toward the punchline, not metronomic.
 */

export const PILLAR_COUNT = 4;

/** Final tokens-saved figure. ~18k − ~1k ≈ 17,000. */
export const TOTAL_TOKENS_SAVED = 17000;

/**
 * Per-phase increments. Sum === TOTAL_TOKENS_SAVED. Each delta sits
 * around ~4,250 with the keystone (Code Mode) pillar getting the
 * biggest jump so the counter feels weighted toward the punchline.
 *
 *   pillar 1 (MCP = connectivity)        +4,000
 *   pillar 2 (LLMs are coders)           +4,000
 *   pillar 3 (Code Mode = one round-trip) +5,000  ← the big one
 *   pillar 4 (V8 isolates)               +4,000
 *                                       ───────
 *                                       17,000
 */
const INCREMENTS = [4000, 4000, 5000, 4000] as const;

export type Phase = 0 | 1 | 2 | 3 | 4;

export function tokensSavedAfterPhase(phase: Phase): number {
  // Defensive clamping — the deck's phase counter shouldn't overshoot,
  // but if presenter spams the arrow key we don't want NaN on stage.
  const p = Math.max(0, Math.min(PILLAR_COUNT, Math.floor(phase as number)));
  let total = 0;
  for (let i = 0; i < p; i++) total += INCREMENTS[i];
  return total;
}

/** Increment a presenter would see between phase n-1 and n. */
export function incrementForPhase(phase: 1 | 2 | 3 | 4): number {
  return INCREMENTS[phase - 1];
}
