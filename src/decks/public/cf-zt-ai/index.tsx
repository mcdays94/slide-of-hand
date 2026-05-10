/**
 * Cloudflare Zero Trust × AI — imported from the upstream `cf-zt-ai-slides`
 * repo. The deck is a self-contained port: every slide / component /
 * primitive / motion preset lives under this folder, and only the framework
 * primitives (`SlideDef`, `usePhase`, `PhaseContext`) are imported from
 * Slide of Hand.
 *
 * Source repo: gitlab.cfdata.org/mdias/cf-zt-ai-slides
 */
import type { Deck } from "@/framework/viewer/types";
import { meta } from "./meta";

import { titleSlide } from "./slides/01-title";
import { aiMomentSlide } from "./slides/02-the-ai-moment";
import {
  sectionDiscover,
  sectionGovern,
  sectionProtect,
  sectionObserve,
  sectionEmpower,
} from "./slides/sections";
import { shadowAiRadarSlide } from "./slides/04-shadow-ai-radar";
import { appLibrarySlide } from "./slides/06-app-library";
import { accessPoliciesSlide } from "./slides/07-access-policies";
import { promptGuardSlide } from "./slides/09-prompt-guard";
import { browserIsolationSlide } from "./slides/10-browser-isolation";
import { aiGatewaySlide } from "./slides/11-ai-gateway";
import { promptLogSlide } from "./slides/13-prompt-log";
import { mcpPortalSlide } from "./slides/15-mcp-portal";
import { whyToolsMatterSlide } from "./slides/16-why-tools-matter";
import { recapSlide } from "./slides/recap";
import { thanksSlide } from "./slides/thanks";

const deck: Deck = {
  meta,
  slides: [
    titleSlide,
    aiMomentSlide,
    sectionDiscover,
    shadowAiRadarSlide,
    sectionGovern,
    appLibrarySlide,
    accessPoliciesSlide,
    sectionProtect,
    promptGuardSlide,
    browserIsolationSlide,
    aiGatewaySlide,
    sectionObserve,
    promptLogSlide,
    sectionEmpower,
    mcpPortalSlide,
    whyToolsMatterSlide,
    recapSlide,
    thanksSlide,
  ],
};

export default deck;
