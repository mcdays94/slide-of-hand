/**
 * Cloudflare Code Mode & Dynamic Workers — imported from the upstream
 * `cf-code-mode-and-dynamic-workers` repo. The deck is a self-contained
 * port: every slide / component / primitive / motion preset lives under
 * this folder, and only the framework primitives (`SlideDef`, `usePhase`,
 * `PhaseContext`) are imported from Slide of Hand.
 *
 * Source repo: gitlab.cfdata.org/mdias/cf-code-mode-and-dynamic-workers
 *
 * Live-demo note: slide 12 calls `/api/health`, `/api/models`,
 * `/api/prompts`, `/api/run-mcp` (SSE), and `/api/run-code-mode` (SSE).
 * Slide of Hand's worker doesn't yet host those endpoints — the slide
 * gracefully falls back to its bundled "recorded" run when the health
 * probe fails, so it remains presentable. To restore full live demo
 * capability, port the worker bindings (AI, LOADER, CF_API_TOKEN,
 * AI_GATEWAY_TOKEN) and the corresponding routes from the source repo.
 */
import type { Deck } from "@/framework/viewer/types";

import { titleSlide } from "./slides/01-title";
import { hookSlide } from "./slides/02-hook";
import {
  sectionAgents,
  sectionProblem,
  sectionInsight,
  sectionCodeMode,
  sectionLiveDemo,
  sectionFoundation,
  sectionWrapUp,
} from "./slides/sections";
import { whatIsAnAgentSlide } from "./slides/03-what-is-an-agent";
import { whatIsMcpSlide } from "./slides/04-what-is-mcp";
import { anatomyOfToolCallSlide } from "./slides/05-anatomy-of-a-tool-call";
import { tokenExplosionSlide } from "./slides/06-token-explosion";
import { llmsLoveTypescriptSlide } from "./slides/08-llms-love-typescript";
import { shakespeareQuoteSlide } from "./slides/09-shakespeare-quote";
import { codeModeInPlainEnglishSlide } from "./slides/10-code-mode-plain-english";
import { howItWorksDiagramSlide } from "./slides/11-how-it-works-diagram";
import { liveDemoSlide } from "./slides/12-live-demo";
import { dynamicWorkersSlide } from "./slides/13-dynamic-workers";
import { dynamicWorkerDemoSlide } from "./slides/13c-dynamic-worker-demo";
import { serverSideCodeModeSlide } from "./slides/13d-server-side-code-mode";
import { recapSlide } from "./slides/15-recap";
import { closingSlide } from "./slides/16-try-it-now";

const deck: Deck = {
  meta: {
    slug: "cf-code-mode",
    title: "Cloudflare Code Mode & Dynamic Workers",
    description:
      "DTX Manchester 2026 booth deck. Interactive slides with live MCP-vs-Code-Mode comparison powered by Workers AI.",
    date: "2026-05-06",
    author: "Miguel Caetano Dias",
    event: "DTX Manchester 2026",
    tags: ["code-mode", "mcp", "ai"],
    runtimeMinutes: 20,
  },
  slides: [
    titleSlide,
    hookSlide,
    sectionAgents,
    whatIsAnAgentSlide,
    whatIsMcpSlide,
    anatomyOfToolCallSlide,
    sectionProblem,
    tokenExplosionSlide,
    sectionInsight,
    llmsLoveTypescriptSlide,
    shakespeareQuoteSlide,
    sectionCodeMode,
    codeModeInPlainEnglishSlide,
    howItWorksDiagramSlide,
    sectionLiveDemo,
    liveDemoSlide,
    sectionFoundation,
    dynamicWorkersSlide,
    dynamicWorkerDemoSlide,
    serverSideCodeModeSlide,
    sectionWrapUp,
    recapSlide,
    closingSlide,
  ],
};

export default deck;
