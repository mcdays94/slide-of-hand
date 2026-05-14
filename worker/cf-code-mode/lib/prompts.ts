import type { DemoPrompt } from "../types";

/**
 * Demo prompt presets.
 *
 * Each preset is chosen so it requires multiple round-trips when run
 * through the traditional MCP path (which is what makes the Code Mode
 * comparison dramatic). The user's read-only Cloudflare API token has
 * access to zones, DNS, WAF, and rulesets — every preset stays inside
 * those surfaces.
 *
 * Prompt design rule (learned the hard way during QA): keep prompts
 * short and conversational. Verbose prompts with parenthetical
 * specifics like "(A, AAAA, CNAME, MX, TXT, etc.)" cause Llama 3.3
 * 70B to ignore the available tools and respond with "your input is
 * not sufficient". The shorter the prompt, the more reliably the
 * model calls the tools — even though `tool_choice: "required"` is
 * already set on the first turn.
 *
 * The deck UI also accepts free-form prompts; these are just starting
 * points so the speaker doesn't have to type during the demo.
 */
export const DEMO_PROMPTS: DemoPrompt[] = [
  {
    id: "dns-records-by-type",
    label: "DNS records by type, across all zones",
    prompt: "How many DNS records do I have, grouped by type?",
    surfaces: ["zones", "dns"],
  },
  {
    id: "busiest-domain",
    label: "Which of my domains has the most DNS records?",
    prompt: "Which of my domains has the most DNS records?",
    surfaces: ["zones", "dns"],
  },
  {
    id: "waf-rule-audit",
    label: "Audit my WAF custom rules",
    prompt: "How many custom WAF rules do I have, and how many block?",
    surfaces: ["zones", "rulesets", "waf"],
  },
  {
    id: "zone-overview",
    label: "Give me a one-page overview of all my zones",
    prompt: "Give me an overview of all my zones.",
    surfaces: ["zones"],
  },
];

export function findPrompt(id: string): DemoPrompt | undefined {
  return DEMO_PROMPTS.find((p) => p.id === id);
}
