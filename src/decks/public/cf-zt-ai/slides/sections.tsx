import type { SlideDef } from "@/framework/viewer/types";
import { SectionIntro } from "../components/primitives/SectionIntro";

export const sectionDiscover: SlideDef = {
  id: "section-discover",
  title: "01 · Discover",
  layout: "section",
  sectionLabel: "DISCOVER",
  sectionNumber: "01",
  render: () => (
    <SectionIntro
      number="01"
      label="DISCOVER"
      title="Find every AI tool"
      blurb="Before you can govern AI, you have to see it. Most orgs find more AI in use than IT had on its list."
    />
  ),
};

export const sectionGovern: SlideDef = {
  id: "section-govern",
  title: "02 · Govern",
  layout: "section",
  sectionLabel: "GOVERN",
  sectionNumber: "02",
  render: () => (
    <SectionIntro
      number="02"
      label="GOVERN"
      title="Decide who, what, where"
      blurb="One catalog of approved AI apps. Identity-aware policies. Posture-aware access. No more spreadsheet of tools."
      accent="var(--color-cf-compute)"
    />
  ),
};

export const sectionProtect: SlideDef = {
  id: "section-protect",
  title: "03 · Protect",
  layout: "section",
  sectionLabel: "PROTECT",
  sectionNumber: "03",
  render: () => (
    <SectionIntro
      number="03"
      label="PROTECT"
      title="Keep secrets out, threats off"
      blurb="DLP on prompts, isolation for risky tools, a gateway for every model call. None of it slows your developers down."
      accent="var(--color-cf-error)"
    />
  ),
};

export const sectionObserve: SlideDef = {
  id: "section-observe",
  title: "04 · Observe",
  layout: "section",
  sectionLabel: "OBSERVE",
  sectionNumber: "04",
  render: () => (
    <SectionIntro
      number="04"
      label="OBSERVE"
      title="Audit every prompt"
      blurb="Full request and response captured by default for every call: tokens, latency, cost, verdict, content. When DLP or a guardrail fires, the entry gains structured forensic fields. Stored in your tenant via Logpush."
      accent="var(--color-cf-info)"
    />
  ),
};

export const sectionEmpower: SlideDef = {
  id: "section-empower",
  title: "05 · Empower",
  layout: "section",
  sectionLabel: "EMPOWER",
  sectionNumber: "05",
  render: () => (
    <SectionIntro
      number="05"
      label="EMPOWER"
      title="Give them MCP"
      blurb="Curated MCP server portal. Identity-aware tool access. Agents that work on real data, safely."
      accent="var(--color-cf-ai)"
    />
  ),
};
