import type { RunEvent } from "../../lib/run-events";

/**
 * Pre-recorded MCP-vs-Code-Mode runs.
 *
 * If the Worker can't run the live demo (no AI binding on the preview
 * deployment, no internet at the booth, anything), we play back one of
 * these. They're synthesized from a real local capture with `wrangler dev`
 * + a read-only Cloudflare token; the numbers are realistic but fixed
 * so the audience always sees the same dramatic ratio.
 *
 * Schema invariants (enforced by tests):
 *   - Every trace starts with `start` and ends with `done`.
 *   - The MCP trace has strictly more total tokens than the Code Mode
 *     trace. (That's the demo's whole point.)
 *   - The MCP trace has more round-trips than the Code Mode trace.
 *   - The Code Mode trace has exactly 1 round-trip.
 */

export interface RecordedRun {
  id: string;
  prompt: string;
  model: string;
  /** Stage label shown next to the column when this run is played back. */
  modelLabel: string;
  /** Per-event delay (ms) when "playing back" this run for the audience. */
  playbackDelayMs?: number;
  mcp: RunEvent[];
  codeMode: RunEvent[];
}

/* ────────────────────────────────────────────────────────────────────
 *  Recorded run #1 — "DNS records by type, across all zones"
 *  Captured: Tue Apr 22 2026, against a real demo account with 4 zones.
 * ──────────────────────────────────────────────────────────────────── */

const RUN_DNS: RecordedRun = {
  id: "dns-records-by-type",
  prompt:
    "Across every zone on this Cloudflare account, count the DNS records grouped by their record type (A, AAAA, CNAME, MX, TXT, etc.). Return a single sorted list, biggest first.",
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  modelLabel: "Llama 3.3 70B · fp8-fast",
  playbackDelayMs: 320,
  mcp: [
    {
      type: "start",
      mode: "mcp",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      runId: "rec-dns-mcp",
    },
    {
      type: "thinking",
      text:
        "Loading tool schemas (listZones, listDnsRecords, listCustomWafRules, getZone) and asking the model to choose a tool…",
    },
    {
      type: "tool_call",
      name: "listZones",
      args: {},
      tokensSoFar: 612,
    },
    {
      type: "tool_result",
      name: "listZones",
      result: [
        { id: "z1", name: "miguel.codes", status: "active" },
        { id: "z2", name: "demo-acme.dev", status: "active" },
        { id: "z3", name: "side-project.app", status: "active" },
        "…and 1 more",
      ],
      sizeBytes: 4280,
      tokensSoFar: 1684,
    },
    {
      type: "thinking",
      text:
        "Round-trip #2: re-sending the full conversation back into the LLM with the new tool result.",
    },
    {
      type: "tool_call",
      name: "listDnsRecords",
      args: { zoneId: "z1" },
      tokensSoFar: 2410,
    },
    {
      type: "tool_result",
      name: "listDnsRecords",
      result: [
        { type: "A", name: "miguel.codes" },
        { type: "AAAA", name: "miguel.codes" },
        { type: "CNAME", name: "www" },
        "…and 22 more",
      ],
      sizeBytes: 9120,
      tokensSoFar: 4690,
    },
    {
      type: "thinking",
      text:
        "Round-trip #3: re-sending the full conversation back into the LLM with the new tool result.",
    },
    {
      type: "tool_call",
      name: "listDnsRecords",
      args: { zoneId: "z2" },
      tokensSoFar: 5360,
    },
    {
      type: "tool_result",
      name: "listDnsRecords",
      result: [
        { type: "A", name: "demo-acme.dev" },
        { type: "MX", name: "demo-acme.dev" },
        "…and 18 more",
      ],
      sizeBytes: 7400,
      tokensSoFar: 7200,
    },
    {
      type: "thinking",
      text:
        "Round-trip #4: re-sending the full conversation back into the LLM with the new tool result.",
    },
    {
      type: "tool_call",
      name: "listDnsRecords",
      args: { zoneId: "z3" },
      tokensSoFar: 7910,
    },
    {
      type: "tool_result",
      name: "listDnsRecords",
      result: [
        { type: "A", name: "side-project.app" },
        { type: "TXT", name: "_dmarc" },
        "…and 8 more",
      ],
      sizeBytes: 4100,
      tokensSoFar: 8932,
    },
    {
      type: "thinking",
      text:
        "Round-trip #5: re-sending the full conversation back into the LLM with the new tool result.",
    },
    {
      type: "tool_call",
      name: "listDnsRecords",
      args: { zoneId: "z4" },
      tokensSoFar: 9650,
    },
    {
      type: "tool_result",
      name: "listDnsRecords",
      result: [{ type: "CNAME", name: "www" }, "…and 5 more"],
      sizeBytes: 2400,
      tokensSoFar: 10245,
    },
    {
      type: "thinking",
      text:
        "Round-trip #6: re-sending the full conversation back into the LLM with the new tool result.",
    },
    {
      type: "final",
      answer:
        "Across the 4 zones I counted 78 DNS records, sorted by type:\n• A — 34\n• CNAME — 19\n• AAAA — 11\n• TXT — 8\n• MX — 4\n• NS — 2",
      promptTokens: 9420,
      completionTokens: 1270,
      totalTokens: 10690,
      roundTrips: 6,
      latencyMs: 11200,
    },
    {
      type: "done",
      mode: "mcp",
      promptTokens: 9420,
      completionTokens: 1270,
      totalTokens: 10690,
      roundTrips: 6,
      latencyMs: 11200,
    },
  ],
  codeMode: [
    {
      type: "start",
      mode: "code-mode",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      runId: "rec-dns-code",
    },
    {
      type: "thinking",
      text:
        "One round-trip: ask the LLM to write a TypeScript snippet that calls codemode.* and logs the answer.",
    },
    {
      type: "code",
      source:
        "const zones = await codemode.listZones();\n" +
        "const counts = new Map<string, number>();\n" +
        "for (const z of zones) {\n" +
        "  const records = await codemode.listDnsRecords(z.id);\n" +
        "  for (const r of records) {\n" +
        "    counts.set(r.type, (counts.get(r.type) ?? 0) + 1);\n" +
        "  }\n" +
        "}\n" +
        "const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);\n" +
        "const total = sorted.reduce((s, [, n]) => s + n, 0);\n" +
        `console.log("Across the " + zones.length + " zones I counted " + total + " DNS records, sorted by type:");\n` +
        'for (const [type, n] of sorted) console.log("• " + type + " — " + n);',
      tokensSoFar: 1069,
    },
    {
      type: "code_log",
      text: "Across the 4 zones I counted 78 DNS records, sorted by type:",
    },
    { type: "code_log", text: "• A — 34" },
    { type: "code_log", text: "• CNAME — 19" },
    { type: "code_log", text: "• AAAA — 11" },
    { type: "code_log", text: "• TXT — 8" },
    { type: "code_log", text: "• MX — 4" },
    { type: "code_log", text: "• NS — 2" },
    {
      type: "final",
      answer:
        "Across the 4 zones I counted 78 DNS records, sorted by type:\n• A — 34\n• CNAME — 19\n• AAAA — 11\n• TXT — 8\n• MX — 4\n• NS — 2",
      promptTokens: 920,
      completionTokens: 149,
      totalTokens: 1069,
      roundTrips: 1,
      latencyMs: 2100,
    },
    {
      type: "done",
      mode: "code-mode",
      promptTokens: 920,
      completionTokens: 149,
      totalTokens: 1069,
      roundTrips: 1,
      latencyMs: 2100,
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────
 *  Recorded run #2 — "Top 3 zones by DNS record count"
 * ──────────────────────────────────────────────────────────────────── */

const RUN_BUSIEST: RecordedRun = {
  id: "busiest-domain",
  prompt:
    "List my top 3 zones by total DNS record count. For each, show the zone name, the number of records, and what plan it's on.",
  model: "@hf/nousresearch/hermes-2-pro-mistral-7b",
  modelLabel: "Hermes 2 Pro · 7B",
  playbackDelayMs: 280,
  mcp: [
    {
      type: "start",
      mode: "mcp",
      model: "@hf/nousresearch/hermes-2-pro-mistral-7b",
      runId: "rec-busy-mcp",
    },
    {
      type: "thinking",
      text: "Loading tool schemas and asking the model to choose a tool…",
    },
    { type: "tool_call", name: "listZones", args: {}, tokensSoFar: 590 },
    {
      type: "tool_result",
      name: "listZones",
      result: [
        { id: "z1", name: "miguel.codes", plan: { name: "Free" } },
        { id: "z2", name: "demo-acme.dev", plan: { name: "Pro" } },
        "…and 2 more",
      ],
      sizeBytes: 3120,
      tokensSoFar: 1380,
    },
    {
      type: "thinking",
      text:
        "Round-trip #2: re-sending the full conversation back into the LLM with the new tool result.",
    },
    {
      type: "tool_call",
      name: "listDnsRecords",
      args: { zoneId: "z1" },
      tokensSoFar: 2010,
    },
    {
      type: "tool_result",
      name: "listDnsRecords",
      result: ["…25 records"],
      sizeBytes: 8800,
      tokensSoFar: 4180,
    },
    {
      type: "thinking",
      text:
        "Round-trip #3: re-sending the full conversation back into the LLM with the new tool result.",
    },
    {
      type: "tool_call",
      name: "listDnsRecords",
      args: { zoneId: "z2" },
      tokensSoFar: 4960,
    },
    {
      type: "tool_result",
      name: "listDnsRecords",
      result: ["…20 records"],
      sizeBytes: 7100,
      tokensSoFar: 6720,
    },
    {
      type: "thinking",
      text:
        "Round-trip #4: re-sending the full conversation back into the LLM with the new tool result.",
    },
    {
      type: "tool_call",
      name: "listDnsRecords",
      args: { zoneId: "z3" },
      tokensSoFar: 7440,
    },
    {
      type: "tool_result",
      name: "listDnsRecords",
      result: ["…11 records"],
      sizeBytes: 4200,
      tokensSoFar: 8860,
    },
    {
      type: "final",
      answer:
        "Top 3 zones by DNS record count:\n1. miguel.codes — 25 records (Free)\n2. demo-acme.dev — 20 records (Pro)\n3. side-project.app — 11 records (Free)",
      promptTokens: 7950,
      completionTokens: 980,
      totalTokens: 8930,
      roundTrips: 4,
      latencyMs: 8400,
    },
    {
      type: "done",
      mode: "mcp",
      promptTokens: 7950,
      completionTokens: 980,
      totalTokens: 8930,
      roundTrips: 4,
      latencyMs: 8400,
    },
  ],
  codeMode: [
    {
      type: "start",
      mode: "code-mode",
      model: "@hf/nousresearch/hermes-2-pro-mistral-7b",
      runId: "rec-busy-code",
    },
    {
      type: "thinking",
      text:
        "One round-trip: ask the LLM to write a TypeScript snippet that calls codemode.* and logs the answer.",
    },
    {
      type: "code",
      source:
        "const zones = await codemode.listZones();\n" +
        "const enriched = await Promise.all(zones.map(async (z) => ({\n" +
        "  zone: z,\n" +
        "  count: (await codemode.listDnsRecords(z.id)).length,\n" +
        "})));\n" +
        "enriched.sort((a, b) => b.count - a.count);\n" +
        'console.log("Top 3 zones by DNS record count:");\n' +
        "enriched.slice(0, 3).forEach((e, i) =>\n" +
        '  console.log(`${i + 1}. ${e.zone.name} — ${e.count} records (${e.zone.plan.name})`)\n' +
        ");",
      tokensSoFar: 940,
    },
    { type: "code_log", text: "Top 3 zones by DNS record count:" },
    { type: "code_log", text: "1. miguel.codes — 25 records (Free)" },
    { type: "code_log", text: "2. demo-acme.dev — 20 records (Pro)" },
    { type: "code_log", text: "3. side-project.app — 11 records (Free)" },
    {
      type: "final",
      answer:
        "Top 3 zones by DNS record count:\n1. miguel.codes — 25 records (Free)\n2. demo-acme.dev — 20 records (Pro)\n3. side-project.app — 11 records (Free)",
      promptTokens: 810,
      completionTokens: 130,
      totalTokens: 940,
      roundTrips: 1,
      latencyMs: 1800,
    },
    {
      type: "done",
      mode: "code-mode",
      promptTokens: 810,
      completionTokens: 130,
      totalTokens: 940,
      roundTrips: 1,
      latencyMs: 1800,
    },
  ],
};

export const RECORDED_RUNS: RecordedRun[] = [RUN_DNS, RUN_BUSIEST];

/**
 * Pick the recording that best matches the user's request. Prefers an
 * exact id match (when the user picked a preset from the dropdown);
 * falls back to the first recording so the demo is never empty for
 * free-form prompts.
 */
export function findRecordedRun(
  prompt: string,
  promptId?: string,
): RecordedRun {
  if (promptId) {
    const exact = RECORDED_RUNS.find((r) => r.id === promptId);
    if (exact) return exact;
  }
  // Exact-prompt match (the canned-prompt selector path passes the
  // verbatim prompt body).
  const exactByPrompt = RECORDED_RUNS.find((r) => r.prompt === prompt);
  if (exactByPrompt) return exactByPrompt;
  return RECORDED_RUNS[0]!;
}
