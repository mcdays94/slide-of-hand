/**
 * Token-counting helpers.
 *
 * Workers AI's chat-completion responses include a `usage` block on
 * OpenAI-compatible endpoints. When that's missing (e.g. older raw
 * /run/<model> endpoints), we fall back to a heuristic estimator
 * tuned against the cl100k_base tokenizer used by GPT-3.5/4.
 *
 * The heuristic: 1 token ≈ 4 characters of English text, plus a small
 * round-up for whitespace and punctuation. It overestimates slightly on
 * code (which uses lots of short symbols) — that's intentional, because
 * we'd rather *over*-report tokens for the MCP column (the loser) than
 * under-report for the Code Mode column (the winner) and look biased.
 */

export interface UsageRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export const ZERO_USAGE: UsageRecord = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

/**
 * Heuristic token estimator. Used when the model response doesn't
 * include `usage`. Roughly cl100k_base-like for English; not exact.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 chars/token + a constant per word break.
  const chars = text.length;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(chars / 4 + words * 0.15));
}

/**
 * Extract usage stats from a Workers AI response. Different model
 * families return slightly different shapes — we look for OpenAI-style
 * `usage` first, then a top-level `usage`, then estimate.
 *
 * Pass the original prompt (system + user) and the completion text so
 * we have a fallback for models that don't surface usage.
 */
export function extractUsage(
  resp: unknown,
  fallback?: { prompt: string; completion: string },
): UsageRecord {
  const r = resp as
    | {
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      }
    | undefined;
  const u = r?.usage;
  if (
    u &&
    typeof u.prompt_tokens === "number" &&
    typeof u.completion_tokens === "number"
  ) {
    return {
      promptTokens: u.prompt_tokens,
      completionTokens: u.completion_tokens,
      totalTokens: u.total_tokens ?? u.prompt_tokens + u.completion_tokens,
    };
  }
  if (fallback) {
    const promptTokens = estimateTokens(fallback.prompt);
    const completionTokens = estimateTokens(fallback.completion);
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }
  return ZERO_USAGE;
}

export function addUsage(a: UsageRecord, b: UsageRecord): UsageRecord {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}
