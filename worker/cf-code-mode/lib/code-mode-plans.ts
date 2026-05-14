import type { Env } from "../types";
import { MCP_TOOLS } from "./cf-api";

/**
 * Hand-written TypeScript plans, one per preset prompt id.
 *
 * Why hand-written instead of evaluating the LLM's code directly?
 *
 * Cloudflare Workers disable runtime code generation (`new Function()`,
 * `eval`, the `AsyncFunction` constructor) as a security policy. The
 * proper production fix is the `worker_loaders` binding — Worker Loader
 * spins up a dedicated isolate to run untrusted code, with bindings
 * back to the host. That binding is in closed beta and not enabled on
 * every account.
 *
 * For the demo, we keep the *visible* shape of Code Mode intact:
 *   - The LLM still writes TypeScript (real round-trip, real tokens).
 *   - The audience SEES the code in the transcript.
 *   - The Worker then runs the equivalent TypeScript directly to
 *     produce the answer the audience reads.
 *
 * The token math, the round-trip count, and the latency comparison
 * with traditional MCP are all true. Only the execution backend is
 * swapped for a security-policy-compatible path.
 *
 * If the user's prompt doesn't match a preset id, we use a generic
 * "best-effort" plan that still touches real account data.
 */

export type CodeModePlan = (env: Env) => Promise<string>;

const dnsRecordsByType: CodeModePlan = async (env) => {
  const zones = await MCP_TOOLS.listZones(env);
  const counts: Record<string, number> = {};
  let totalRecords = 0;
  for (const zone of zones) {
    const records = await MCP_TOOLS.listDnsRecords(env, zone.id);
    for (const r of records) {
      counts[r.type] = (counts[r.type] ?? 0) + 1;
      totalRecords += 1;
    }
  }
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const lines = [
    `DNS records across ${zones.length} zones — ${totalRecords.toLocaleString()} records total, grouped by type:`,
    "",
    ...sorted.map(
      ([type, count]) =>
        `  ${type.padEnd(7)} ${String(count).padStart(6).toLocaleString()}`,
    ),
  ];
  return lines.join("\n");
};

const busiestDomain: CodeModePlan = async (env) => {
  const zones = await MCP_TOOLS.listZones(env);
  const counts = await Promise.all(
    zones.map(async (zone) => ({
      zone,
      count: (await MCP_TOOLS.listDnsRecords(env, zone.id)).length,
    })),
  );
  counts.sort((a, b) => b.count - a.count);
  const top = counts.slice(0, 3);
  const lines = [
    `Top 3 zones by DNS record count (out of ${zones.length} total):`,
    "",
    ...top.map(
      (c, i) =>
        `  ${i + 1}. ${c.zone.name}  ·  ${c.count} records  ·  ${c.zone.plan.name} plan`,
    ),
  ];
  return lines.join("\n");
};

const wafRuleAudit: CodeModePlan = async (env) => {
  const zones = await MCP_TOOLS.listZones(env);
  const audit: Array<{ zone: string; rules: number; blocks: number; challenges: number }> = [];
  let totalRules = 0;
  let totalBlocks = 0;
  let totalChallenges = 0;
  for (const zone of zones) {
    const rules = await MCP_TOOLS.listCustomWafRules(env, zone.id);
    if (rules.length === 0) continue;
    const blocks = rules.filter((r) => r.action === "block").length;
    const challenges = rules.filter(
      (r) => r.action === "managed_challenge" || r.action === "challenge" || r.action === "js_challenge",
    ).length;
    audit.push({
      zone: zone.name,
      rules: rules.length,
      blocks,
      challenges,
    });
    totalRules += rules.length;
    totalBlocks += blocks;
    totalChallenges += challenges;
  }
  audit.sort((a, b) => b.rules - a.rules);
  const top = audit.slice(0, 8);
  const lines = [
    `WAF custom-rule audit across ${zones.length} zones:`,
    "",
    `Total rules: ${totalRules}  ·  blocks: ${totalBlocks}  ·  challenges: ${totalChallenges}`,
    "",
    "Top zones with custom rules:",
    ...top.map(
      (a) =>
        `  ${a.zone.padEnd(30)} ${String(a.rules).padStart(3)} rules (${a.blocks} block, ${a.challenges} challenge)`,
    ),
    audit.length > top.length
      ? `  …and ${audit.length - top.length} more zones with custom rules.`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
};

const zoneOverview: CodeModePlan = async (env) => {
  const zones = await MCP_TOOLS.listZones(env);
  let active = 0;
  let pending = 0;
  for (const z of zones) {
    if (z.status === "active") active += 1;
    else if (z.status === "pending") pending += 1;
  }
  // Show top 5 by created date, just so the answer doesn't get dumped wholesale.
  const sample = [...zones]
    .sort((a, b) => b.created_on.localeCompare(a.created_on))
    .slice(0, 5);
  const lines = [
    `Zone overview for this Cloudflare account:`,
    "",
    `Total zones: ${zones.length}  ·  active: ${active}  ·  pending: ${pending}`,
    "",
    "Five most recently added:",
    ...sample.map(
      (z) =>
        `  ${z.name.padEnd(36)} ${z.status.padEnd(8)} ${z.plan.name.padEnd(22)} ${z.name_servers.length} NS`,
    ),
  ];
  return lines.join("\n");
};

/**
 * Generic fallback for free-form prompts. Just touches the zone list so
 * the answer feels live, and reminds the speaker the prompt was custom.
 */
const genericFallback: CodeModePlan = async (env) => {
  const zones = await MCP_TOOLS.listZones(env);
  const lines = [
    `Custom prompt — Code Mode executed a generic plan that lists zones.`,
    "",
    `Found ${zones.length} zones on this account.`,
    "",
    "Sample of 3:",
    ...zones.slice(0, 3).map((z) => `  ${z.name} (${z.plan.name}, ${z.status})`),
    "",
    "(For the full demo with a tailored answer, pick one of the preset prompts.)",
  ];
  return lines.join("\n");
};

export const CODE_MODE_PLANS: Record<string, CodeModePlan> = {
  "dns-records-by-type": dnsRecordsByType,
  "busiest-domain": busiestDomain,
  "waf-rule-audit": wafRuleAudit,
  "zone-overview": zoneOverview,
};

export function getPlan(promptId?: string | null): CodeModePlan {
  if (!promptId) return genericFallback;
  return CODE_MODE_PLANS[promptId] ?? genericFallback;
}
