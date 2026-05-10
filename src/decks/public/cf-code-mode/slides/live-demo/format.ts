/**
 * Number / latency / cost formatters for the live-demo counters.
 *
 * Pure functions, no React, no Motion — all the formatting logic the
 * counters and winner badge depend on. Keeping this isolated means the
 * deck can render the same numbers consistently in tests, in the UI,
 * and in any future export (e.g. a screenshot for socials).
 */

/** Format an integer token count with thousand separators. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  const rounded = Math.round(n);
  return rounded.toLocaleString("en-US");
}

/**
 * Format milliseconds. Below 1 s we show "850 ms"; at or above 1 s we
 * show "1.2 s" — keeps the counter narrow on stage.
 */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Format an estimated USD cost. Tiny numbers get 4 decimal places so a
 * fraction-of-a-cent run doesn't render as "$0.00"; larger numbers get
 * the conventional 2.
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.0000";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

/** Cubic ease-out — smooth deceleration for the count-up animation. */
export function easeOutCubic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Interpolate between `start` and `end` at parameter `t∈[0,1]`,
 * applying a cubic ease-out and rounding to an integer. The counter
 * `useCountUp` hook drives this every requestAnimationFrame.
 */
export function interpolateCount(
  start: number,
  end: number,
  t: number,
): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const eased = easeOutCubic(clamped);
  return Math.round(start + (end - start) * eased);
}

/**
 * Compute who won the comparison based on total token usage.
 * Returns `null` if either side hasn't finished yet (totalTokens===0).
 *
 * Within 5% we call it a tie — otherwise the winner is reported with
 * a percentage saving relative to the loser.
 */
export function computeWinner(opts: {
  mcp: number;
  codeMode: number;
}): { winner: "mcp" | "code-mode" | "tie"; percentFewer: number } | null {
  const { mcp, codeMode } = opts;
  if (mcp <= 0 || codeMode <= 0) return null;

  if (codeMode < mcp) {
    const ratio = (mcp - codeMode) / mcp;
    if (ratio < 0.05) return { winner: "tie", percentFewer: 0 };
    return { winner: "code-mode", percentFewer: Math.round(ratio * 100) };
  }
  if (mcp < codeMode) {
    const ratio = (codeMode - mcp) / codeMode;
    if (ratio < 0.05) return { winner: "tie", percentFewer: 0 };
    return { winner: "mcp", percentFewer: Math.round(ratio * 100) };
  }
  return { winner: "tie", percentFewer: 0 };
}
