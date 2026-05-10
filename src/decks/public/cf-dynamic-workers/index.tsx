/**
 * Cloudflare Dynamic Workers — imported from the upstream
 * `cf-dynamic-workers-slides` repo. The deck is a self-contained port:
 * every slide / component / primitive / motion preset lives under this
 * folder, and only the framework primitives (`SlideDef`, `usePhase`,
 * `PhaseContext`) are imported from Slide of Hand.
 *
 * The original deck is backed by a Cloudflare Worker with a Worker
 * Loader binding that genuinely spawns isolates on stage. Slide of
 * Hand doesn't ship that binding (yet), so the live demo slide
 * (`08-live-demo.tsx`) simulates the spawn responses with a small
 * delay. The lifecycle visualisation, counter, recent-ids ribbon, and
 * result panel still animate exactly like the original — only the
 * iframe in the globe-app result is replaced with a placeholder.
 *
 * TODO(#101 follow-up): when a Worker Loader binding is added to
 * `wrangler.jsonc`, flip the simulator helpers in `08-live-demo.tsx`
 * back to real `fetch("/api/spawn", …)` calls and remove the
 * `simulate` prop from `<HealthPill>`.
 *
 * Source repo: gitlab.cfdata.org/mdias/cf-dynamic-workers-slides
 */
import type { Deck } from "@/framework/viewer/types";
import { meta } from "./meta";

import { titleSlide } from "./slides/01-title";
import { hookSlide } from "./slides/02-hook";
import {
  sectionShapeOfCompute,
  sectionWhatsADynamicWorker,
  sectionLiveDemo,
  sectionWhyThisMatters,
} from "./slides/sections";
import { coldStartRaceSlide } from "./slides/04-cold-start-race";
import { definitionSlide } from "./slides/06-definition";
import { liveDemoSlide } from "./slides/08-live-demo";
import { useCasesSlide } from "./slides/10-use-cases";
import { codeModeSlide } from "./slides/11-code-mode";
import { recapSlide } from "./slides/11-recap";
import { thanksSlide } from "./slides/12-thanks";

const deck: Deck = {
  meta,
  slides: [
    titleSlide,
    hookSlide,
    sectionShapeOfCompute,
    coldStartRaceSlide,
    sectionWhatsADynamicWorker,
    definitionSlide,
    sectionLiveDemo,
    liveDemoSlide,
    sectionWhyThisMatters,
    useCasesSlide,
    codeModeSlide,
    recapSlide,
    thanksSlide,
  ],
};

export default deck;
