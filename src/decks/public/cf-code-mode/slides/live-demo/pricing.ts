/**
 * Approximate Workers AI pricing.
 *
 * Cloudflare's published Workers AI rates (developers.cloudflare.com/
 * workers-ai/platform/pricing) blend across model families. For the
 * deck's headline "$" counter we use a conservative middle-of-the-road
 * rate: input USD/1M ≈ 0.16, output USD/1M ≈ 0.66. The exact figure is
 * less important than that both columns use the SAME rate, so the
 * comparison is honest.
 *
 * A presenter who wants to be precise can update these constants for a
 * specific model — the rest of the UI follows automatically.
 */
export const WORKERS_AI_PRICING = {
  /** USD per 1,000,000 input (prompt) tokens. */
  inputPer1M: 0.16,
  /** USD per 1,000,000 output (completion) tokens. */
  outputPer1M: 0.66,
} as const;

/**
 * Estimate USD cost for a given prompt+completion split. The two demo
 * columns share this function so they're judged by the same yardstick.
 */
export function estimateCost(opts: {
  promptTokens: number;
  completionTokens: number;
}): number {
  const inputUsd =
    (opts.promptTokens / 1_000_000) * WORKERS_AI_PRICING.inputPer1M;
  const outputUsd =
    (opts.completionTokens / 1_000_000) * WORKERS_AI_PRICING.outputPer1M;
  return inputUsd + outputUsd;
}
