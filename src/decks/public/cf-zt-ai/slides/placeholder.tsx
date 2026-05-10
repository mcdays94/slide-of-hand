import { Construction } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";

/**
 * Temporary stubs for slides that BATCH 2 / 3 will fill in.
 * Each placeholder still renders a properly-themed slide so the deck is
 * navigable end-to-end while we build the real interactive components.
 */
function makeStub({
  id,
  title,
  sectionLabel,
  sectionNumber,
  blurb,
}: {
  id: string;
  title: string;
  sectionLabel: string;
  sectionNumber: string;
  blurb: string;
}): SlideDef {
  return {
    id,
    title,
    sectionLabel,
    sectionNumber,
    layout: "default",
    render: () => (
      <div className="mx-auto flex h-full w-full max-w-[1200px] flex-col">
        <div className="flex items-center gap-3">
          <Tag>{sectionLabel}</Tag>
          <Tag tone="muted">In progress</Tag>
        </div>
        <h2 className="mt-6 text-4xl tracking-[-0.035em] sm:text-6xl">
          {title}
        </h2>
        <p className="mt-4 max-w-2xl text-cf-text-muted">{blurb}</p>

        <div className="mt-10 flex flex-1 items-center justify-center">
          <CornerBrackets className="cf-card flex max-w-md flex-col items-center gap-3 p-10 text-center">
            <Construction className="h-8 w-8 text-cf-orange" />
            <h3 className="text-xl">Interactive component pending</h3>
            <p className="text-sm text-cf-text-muted">
              This slide is wired up. Its interactive primitive lands in
              BATCH&nbsp;2 / 3 of the build.
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              ID · {id}
            </span>
          </CornerBrackets>
        </div>
      </div>
    ),
  };
}

export const Placeholder = {
  shadowAiRadar: makeStub({
    id: "shadow-ai-radar",
    title: "Shadow AI on the radar",
    sectionLabel: "DISCOVER",
    sectionNumber: "01",
    blurb:
      "Cloudflare's CASB and Gateway sweep your traffic for unsanctioned AI tools — ChatGPT, Claude, Gemini, Perplexity, Copilot, Cursor and 200+ more.",
  }),
  appLibrary: makeStub({
    id: "app-library",
    title: "AI app library — one catalog",
    sectionLabel: "GOVERN",
    sectionNumber: "02",
    blurb:
      "Browse, allow, isolate, or block. Every AI app gets a policy. Your team gets one place to ask permission.",
  }),
  accessPolicies: makeStub({
    id: "access-policies",
    title: "Identity- and posture-aware access",
    sectionLabel: "GOVERN",
    sectionNumber: "02",
    blurb:
      "Who you are, what device you're on, where you're calling from, what role you have — all evaluated before AI access is granted.",
  }),
  promptGuard: makeStub({
    id: "prompt-guard",
    title: "DLP on prompts — block the leak",
    sectionLabel: "PROTECT",
    sectionNumber: "03",
    blurb:
      "Inspect prompts at the edge. Detect source code, secrets, PII, regulated data. Block, redact, or warn — your call.",
  }),
  browserIsolation: makeStub({
    id: "browser-isolation",
    title: "Browser isolation for risky AI",
    sectionLabel: "PROTECT",
    sectionNumber: "03",
    blurb:
      "Render the AI tool in a remote browser. Your laptop only sees pixels. No copy, no paste, no upload, no exfil.",
  }),
  aiGateway: makeStub({
    id: "ai-gateway",
    title: "AI Gateway in front of every model",
    sectionLabel: "PROTECT",
    sectionNumber: "03",
    blurb:
      "Cache, rate-limit, fall back, and log every model call. Use the same API surface; switch providers without app changes.",
  }),
  promptLog: makeStub({
    id: "prompt-log",
    title: "Every prompt, every token, every cost",
    sectionLabel: "OBSERVE",
    sectionNumber: "04",
    blurb:
      "Logpush prompts to R2, S3, Splunk, or Datadog. Tokens in/out, latency, model, user, content snippet, policy verdict.",
  }),
  mcpPortal: makeStub({
    id: "mcp-portal",
    title: "MCP server portal",
    sectionLabel: "EMPOWER",
    sectionNumber: "05",
    blurb:
      "A curated, governed marketplace of MCP servers — your tools, secured by Zero Trust, callable from any agent.",
  }),
  mcpInAction: makeStub({
    id: "mcp-in-action",
    title: "MCP in action",
    sectionLabel: "EMPOWER",
    sectionNumber: "05",
    blurb:
      "Watch an agent call a Slack search, fetch a Jira issue, and post a summary — all through one MCP endpoint, all logged.",
  }),
};
