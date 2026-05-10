import type { SlideDef } from "@/framework/viewer/types";
import { SectionIntro } from "../components/primitives/SectionIntro";

/**
 * Section divider slides — full-bleed numbered intros that break the
 * deck into chapters. The accent colour is tied to the chapter's tone.
 */

export const sectionAgents: SlideDef = {
  id: "section-agents",
  layout: "section",
  render: () => (
    <SectionIntro
      number="01"
      label="Agents & MCP"
      title="The new shape of AI software."
      blurb="Before we can talk about why MCP needs a better front-end, we need a shared picture of what an agent is and what MCP actually does."
    />
  ),
};

export const sectionProblem: SlideDef = {
  id: "section-problem",
  layout: "section",
  render: () => (
    <SectionIntro
      number="02"
      label="The problem"
      title="Tools were never the natural shape."
      blurb="As the number of tools grows, traditional MCP starts to creak. Latency, cost, and confusion all stack up — token by token."
      accent="var(--color-cf-error)"
    />
  ),
};

export const sectionInsight: SlideDef = {
  id: "section-insight",
  layout: "section",
  render: () => (
    <SectionIntro
      number="03"
      label="The insight"
      title="LLMs are not tool callers. They are coders."
      blurb="GitHub trained these models more than any synthetic tool-call dataset ever could. We've been speaking to them in the wrong language."
      accent="var(--color-cf-info)"
    />
  ),
};

export const sectionCodeMode: SlideDef = {
  id: "section-code-mode",
  layout: "section",
  render: () => (
    <SectionIntro
      number="04"
      label="Code Mode"
      title="Give the agent a TypeScript API. Let it write code."
      blurb="One tool. One round-trip. The agent orchestrates calls itself, in a sandbox, and returns only the answer you actually wanted."
      accent="var(--color-cf-orange)"
    />
  ),
};

export const sectionLiveDemo: SlideDef = {
  id: "section-live-demo",
  layout: "section",
  render: () => (
    <SectionIntro
      number="05"
      label="Live demo"
      title="MCP vs. Code Mode — same prompt. Same model. Two front-ends."
      blurb="Both columns hit Workers AI live. Same Cloudflare account, same tools. Watch the token counters."
      accent="var(--color-cf-ai)"
    />
  ),
};

export const sectionFoundation: SlideDef = {
  id: "section-foundation",
  layout: "section",
  render: () => (
    <SectionIntro
      number="06"
      label="The foundation"
      title="Why is this only possible on Cloudflare?"
      blurb="Dynamic Workers spin up a fresh V8 isolate per snippet — in milliseconds. No containers. No cold starts. No leaked secrets."
      accent="var(--color-cf-compute)"
    />
  ),
};

export const sectionWrapUp = {
  id: "section-wrap-up",
  layout: "section",
  render: () => (
    <SectionIntro
      number="07"
      label="Takeaways"
      title="What you can do tomorrow."
      blurb="Five things to remember when you go back to your team."
      accent="var(--color-cf-storage)"
    />
  ),
} as const satisfies SlideDef;
