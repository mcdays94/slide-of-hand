import type { DemoModel } from "../types";

/**
 * Workers AI models surfaced in the live demo's model selector.
 *
 * Selection criteria:
 *  1. Native function calling (so the MCP column has a fair shot —
 *     otherwise it can't do tool calls at all).
 *  2. A mix of sizes: small/fast for snappy demos, larger for quality.
 *  3. Mix of providers so the audience sees the diversity of Workers AI.
 *
 * Source: developers.cloudflare.com/workers-ai/models/, filtered to
 * `Function calling` capability.
 *
 * Note: model availability changes over time. The Worker validates the
 * id at request time and falls back to the default if a model is gone.
 */
/**
 * Order = UI dropdown order = default model is first.
 *
 * Live QA across the four preset prompts (every model × every preset,
 * via curl against the deployed Worker on the user's real Lusostreams
 * account, on 2026-04-30 morning):
 *
 *   • Llama 3.3 70B fp8-fast — Best behaviour on BOTH columns:
 *                              - Code Mode: 4/4 real answers (DNS-by-
 *                                type, busiest domain, WAF audit, zone
 *                                overview) in ~700 tokens, 2–15 s.
 *                              - MCP: actually iterates tools — calls
 *                                listZones first, then the per-zone tool
 *                                with REAL ids, hits the 6-round-trip
 *                                cap on the WAF audit (which is THE
 *                                demo's "token explosion" punchline).
 *                              Now the default.
 *   • Llama 3.1 8B fast      — Reliable on Code Mode side (4/4) but on
 *                              MCP it tends to hallucinate placeholder
 *                              zoneIds ("your_zone_id", "all") rather
 *                              than calling listZones first. Caught by
 *                              the cf-api zoneId validator (visible
 *                              error in the transcript). Still listed
 *                              as the speedy option.
 *   • Hermes 2 Pro 7B        — Mistral fine-tuned for function calling.
 *                              Works when the shared 7B GPU isn't
 *                              saturated; on busy days it OOMs mid-run.
 *   • Llama 4 Scout 17B      — Workers AI 3030 Internal Server Error on
 *                              tool calls. Listed but flagged
 *                              experimental until that's resolved.
 */
export const DEMO_MODELS: DemoModel[] = [
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    label: "Llama 3.3 70B · fp8-fast",
    provider: "meta",
    functionCalling: true,
    blurb:
      "Big-brain Llama 3.3, 128K context. Real iteration on both MCP and Code Mode; hits the 6-round-trip cap on WAF audit — that IS the token-explosion punchline. Default for the demo.",
  },
  {
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    label: "Llama 3.1 8B · fast",
    provider: "meta",
    functionCalling: true,
    fast: true,
    blurb:
      "Smallest and fastest Llama. Code Mode side reliable; MCP side often hallucinates placeholder zoneIds — visible failure mode for the demo.",
  },
  {
    id: "@hf/nousresearch/hermes-2-pro-mistral-7b",
    label: "Hermes 2 Pro · 7B",
    provider: "nousresearch",
    functionCalling: true,
    fast: true,
    blurb:
      "Mistral 7B fine-tuned for function calling. Snappy when the shared GPU isn't saturated; may hit CUDA OOM mid-run on busy days.",
  },
  {
    id: "@cf/google/gemma-4-26b-a4b-it",
    label: "Gemma 4 · 26B (a4b)",
    provider: "google",
    functionCalling: true,
    blurb:
      "Google's latest Gemma — 26B mixture-of-experts (4B active), 256K context, native function calling. Released April 2026 on Workers AI.",
  },
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout · 17B (experimental)",
    provider: "meta",
    functionCalling: true,
    blurb:
      "Meta's first Llama 4, mixture-of-experts. Currently returns a Workers AI 3030 on tool calls — leave for after the talk.",
  },
];

export function findModel(id: string): DemoModel | undefined {
  return DEMO_MODELS.find((m) => m.id === id);
}

export const DEFAULT_MODEL_ID: string = DEMO_MODELS[0]!.id;
