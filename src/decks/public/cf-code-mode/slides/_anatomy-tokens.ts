/**
 * Token-counter math for slide 05 — "Anatomy of a tool call".
 *
 * These numbers are illustrative — they round to a clean cadence so the
 * audience can mentally track them, but they reflect the real shape of
 * the cost: the JSON tool-result re-flowing back into the model on
 * phase 2 is by far the biggest jump.
 *
 *   Phase 0  · user prompt                                   →  20
 *   Phase 1  · LLM emits <|tool_call|> JSON                  →  50
 *   Phase 2  · <|tool_result|> JSON is appended as INPUT     → 110  ← jump
 *   Phase 3  · LLM speaks the natural-language answer        → 140
 *
 * The big middle jump is the punch line of the slide: every tool result
 * gets re-fed through the model. That's why naive MCP gets expensive
 * fast — and why Code Mode (next section) wins.
 */
export const TOKENS_BY_PHASE = [20, 50, 110, 140] as const;

export type AnatomyPhase = 0 | 1 | 2 | 3;

/** Cumulative token count after the given phase has fully revealed. */
export function tokensAfterPhase(phase: AnatomyPhase): number {
  return TOKENS_BY_PHASE[phase];
}

/**
 * The number of tokens *added* by entering this phase (delta from the
 * previous phase). Used to drive the red-flash highlight on the
 * counter — phase 2 is by design the biggest jump.
 */
export function tokenJumpAtPhase(phase: AnatomyPhase): number {
  if (phase === 0) return 0;
  return TOKENS_BY_PHASE[phase] - TOKENS_BY_PHASE[phase - 1];
}
