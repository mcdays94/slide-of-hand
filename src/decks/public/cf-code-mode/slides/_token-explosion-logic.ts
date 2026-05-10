/**
 * Pure helpers for the slide-06 "token explosion" visualization.
 *
 * The slide animates a beaker filling up with MCP-tool-schema "cards"
 * before pivoting to the Code Mode equivalent (one tool: `code()`).
 * Everything renderable is derived from data here so the UI stays a
 * dumb projection of these values — and so we can unit-test the math
 * without rendering the SVG.
 *
 * Numbers are inspired by the Cloudflare blog post and the visual at
 * https://cloudflare.leo.arsen.in/deck/codemode (slide 1):
 *
 *   - 8 representative MCP servers covering the most common workplace
 *     tools (Excalidraw, Jira, Confluence, CF Docs, GitHub, Slack,
 *     Workers, R2). The full internal example used 15 servers / 2,594
 *     endpoints — we depict 8 visually because that's what fits cleanly
 *     in a fan around a central agent node.
 *   - Per-server token costs are realistic order-of-magnitude estimates
 *     for a server's full tool-schema payload (descriptions + JSON
 *     Schema for every tool). They sum to ~50,000 — the same headline
 *     "context explosion" figure cited in the inspiration deck.
 *   - Code Mode collapses all of that into a single `code()` tool whose
 *     schema is ~1,069 tokens.
 */

export interface McpServer {
  /** Stable id used as a React key and for icon lookup. */
  id: string;
  /** Display label shown next to the icon. */
  label: string;
  /** Approximate tokens this server's tool-schemas inject into context. */
  tokens: number;
}

/**
 * The 8 MCP servers depicted in the visualization. Token costs are
 * deliberately varied — Jira/Confluence have huge tool surfaces while
 * R2/Slack are leaner — so the "cards" pouring into the beaker land
 * with visibly different weights, reinforcing the "schema bloat" point.
 *
 * Sum: 51,200 tokens (close to the 50K figure called out in the brief).
 */
export const MCP_SERVERS: readonly McpServer[] = [
  { id: "github", label: "GitHub", tokens: 8_400 },
  { id: "jira", label: "Jira", tokens: 9_600 },
  { id: "confluence", label: "Confluence", tokens: 7_200 },
  { id: "cf-docs", label: "CF Docs", tokens: 5_800 },
  { id: "workers", label: "Workers", tokens: 6_400 },
  { id: "slack", label: "Slack", tokens: 5_200 },
  { id: "excalidraw", label: "Excalidraw", tokens: 4_800 },
  { id: "r2", label: "R2", tokens: 3_800 },
];

/** Code Mode equivalent — a single `code()` tool whose schema is tiny. */
export const CODE_MODE_TOKENS = 1_069;

/** Total token cost of all schemas in `servers` (sum of `tokens`). */
export function totalTokens(servers: readonly McpServer[]): number {
  let n = 0;
  for (const s of servers) n += s.tokens;
  return n;
}

/**
 * Running totals after each server is added, in order. Returns an array
 * of the same length as `servers` where index `i` holds the cumulative
 * token count once schemas 0..i have been poured into the beaker.
 *
 *   computeRunningTotals([{tokens:100}, {tokens:50}, {tokens:25}])
 *     // → [100, 150, 175]
 */
export function computeRunningTotals(servers: readonly McpServer[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of servers) {
    acc += s.tokens;
    out.push(acc);
  }
  return out;
}

/**
 * Fraction (0..1) of how full the beaker is after `index` schemas have
 * been added. `index` is the COUNT of schemas added (0 = empty, N = full).
 * Negative indexes clamp to 0; indexes past the end clamp to 1.
 */
export function fillFractionAt(
  index: number,
  servers: readonly McpServer[],
): number {
  if (index <= 0) return 0;
  const total = totalTokens(servers);
  if (total === 0) return 0;
  if (index >= servers.length) return 1;
  let acc = 0;
  for (let i = 0; i < index; i++) acc += servers[i].tokens;
  return Math.min(1, acc / total);
}

/**
 * Token-counter value at a given step, where step 0 = 0 tokens (no
 * schemas added) and step N = totalTokens(servers). Use this to drive
 * a snapped-to-step display when the animation is keyed off discrete
 * schema-arrival events rather than a smooth continuous count.
 */
export function countAt(
  index: number,
  servers: readonly McpServer[],
): number {
  if (index <= 0) return 0;
  if (index >= servers.length) return totalTokens(servers);
  let acc = 0;
  for (let i = 0; i < index; i++) acc += servers[i].tokens;
  return acc;
}

/**
 * Percent of tokens saved going from `before` to `after`. Returns a
 * non-negative integer in [0, 100]. Edge cases: 0 if before<=0, 100 if
 * after is 0 and before is positive.
 */
export function tokenSavingsPct(before: number, after: number): number {
  if (before <= 0) return 0;
  if (after <= 0) return 100;
  const ratio = after / before;
  const pct = (1 - ratio) * 100;
  if (pct <= 0) return 0;
  if (pct >= 100) return 100;
  return Math.round(pct);
}
