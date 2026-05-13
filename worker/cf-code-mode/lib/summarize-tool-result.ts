/**
 * Summarise a tool result before feeding it back to the LLM.
 *
 * The full Cloudflare API result is the audience-visible truth (we
 * still emit it to the UI via `redactForUi`). But the LLM sees a
 * compressed version: a sample of items + aggregations. Two reasons:
 *
 *   1. **Tokens.** A `listZones` call on the user's account returns
 *      196 zones / 262 KB / ~66K tokens. Hermes-7B's context is 24K
 *      and even Llama 3.3 70B's 128K window gets blown after one
 *      retoken cycle. Pre-summarising drops the per-call cost from
 *      ~66K → ~3K tokens — the demo can actually complete.
 *
 *   2. **Quality.** Llama-3.x dumps fed massive arrays start
 *      hallucinating. Hand it a clean summary and it composes a real
 *      answer about the real account ("you have 196 zones, mostly
 *      Enterprise-plan, with 141 active and 51 pending").
 *
 * The token comparison vs Code Mode is preserved: MCP still pays
 * a real cost (~3-5K per round-trip) while Code Mode does the same
 * task in ~600 tokens total. 5-10× ratio is more than enough for the
 * demo punchline; we just don't blow the model up trying to make it
 * 60×.
 *
 * For prompts that genuinely need the raw data (e.g. "list every DNS
 * record on every zone"), the token explosion narrative still fires
 * — the per-zone calls multiply, the LLM context still overflows, the
 * UI still shows the friendly "context exceeded" final.
 */

const MAX_SAMPLE = 10;

interface ZoneLite {
  id: string;
  name: string;
  status: string;
  plan?: { name: string };
  name_servers?: string[];
}

interface DnsLite {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}

interface WafLite {
  id: string;
  description?: string;
  action: string;
  enabled: boolean;
}

/**
 * Build a compact JSON string suitable for putting back into the LLM
 * conversation as a `tool` message. The shape:
 *
 *   {
 *     count: <full length>,
 *     showing: <sample length>,
 *     sample: [<MAX_SAMPLE truncated items>],
 *     aggregates?: { byPlan?, byStatus?, byType?, byAction? },
 *     hint: <free-form prose telling the LLM how to reason about the rest>
 *   }
 */
export function summarizeForLlm(toolName: string, result: unknown): string {
  // Errors propagate — the LLM should see them and react.
  if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
    return JSON.stringify(result);
  }

  if (!Array.isArray(result)) {
    // Non-array results (e.g. getZone) are small enough to send raw.
    return JSON.stringify(result);
  }

  switch (toolName) {
    case "listZones":
      return summarizeZones(result as ZoneLite[]);
    case "listDnsRecords":
      return summarizeDnsRecords(result as DnsLite[]);
    case "listCustomWafRules":
      return summarizeWafRules(result as WafLite[]);
    default:
      // Unknown tool — fall back to a generic array summariser so the
      // LLM at least sees a count and a sample.
      return summarizeGeneric(result as unknown[]);
  }
}

function summarizeZones(zones: ZoneLite[]): string {
  const byPlan: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const z of zones) {
    const plan = z.plan?.name ?? "Unknown";
    byPlan[plan] = (byPlan[plan] ?? 0) + 1;
    byStatus[z.status] = (byStatus[z.status] ?? 0) + 1;
  }
  const sample = zones.slice(0, MAX_SAMPLE).map((z) => ({
    id: z.id,
    name: z.name,
    status: z.status,
    plan: z.plan?.name,
    nameServers: z.name_servers?.length ?? 0,
  }));
  return JSON.stringify({
    count: zones.length,
    showing: sample.length,
    sample,
    aggregates: { byPlan, byStatus },
    hint: zones.length > MAX_SAMPLE
      ? `Showing the first ${MAX_SAMPLE} of ${zones.length} zones. Use the 'aggregates' object for population breakdowns. To drill into a specific zone, call listDnsRecords or listCustomWafRules with one of the sample 'id' values.`
      : `All ${zones.length} zones returned in 'sample'.`,
  });
}

function summarizeDnsRecords(records: DnsLite[]): string {
  const byType: Record<string, number> = {};
  let proxiedCount = 0;
  for (const r of records) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    if (r.proxied) proxiedCount += 1;
  }
  const sample = records.slice(0, MAX_SAMPLE).map((r) => ({
    type: r.type,
    name: r.name,
    content: r.content,
    proxied: r.proxied,
  }));
  return JSON.stringify({
    count: records.length,
    showing: sample.length,
    sample,
    aggregates: { byType, proxied: proxiedCount, unproxied: records.length - proxiedCount },
    hint: records.length > MAX_SAMPLE
      ? `Showing the first ${MAX_SAMPLE} of ${records.length} DNS records. Use 'aggregates.byType' for the type breakdown.`
      : `All ${records.length} DNS records returned in 'sample'.`,
  });
}

function summarizeWafRules(rules: WafLite[]): string {
  const byAction: Record<string, number> = {};
  let enabled = 0;
  for (const r of rules) {
    byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    if (r.enabled) enabled += 1;
  }
  return JSON.stringify({
    count: rules.length,
    enabled,
    disabled: rules.length - enabled,
    aggregates: { byAction },
    rules: rules.slice(0, MAX_SAMPLE).map((r) => ({
      description: r.description ?? "(no description)",
      action: r.action,
      enabled: r.enabled,
    })),
  });
}

function summarizeGeneric(items: unknown[]): string {
  return JSON.stringify({
    count: items.length,
    showing: Math.min(items.length, MAX_SAMPLE),
    sample: items.slice(0, MAX_SAMPLE),
    hint: items.length > MAX_SAMPLE
      ? `Showing the first ${MAX_SAMPLE} of ${items.length} items.`
      : "All items returned.",
  });
}
