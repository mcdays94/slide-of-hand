/**
 * Shifting Gears with Car Finance 247 — DTX Manchester 2026 fireside-chat
 * opener, imported from the upstream `cf247-dtx-manchester` repo.
 *
 * Five animated content slides (title, what-is-cloudflare with a 3D
 * globe, the 2018 attack story, the request flow, the three-way tug
 * of war) plus a hand-off slide and a static event backdrop that stays
 * on screen during the ~22 minute fireside chat.
 *
 * The deck is a self-contained port: every slide / component / globe /
 * stylesheet lives under this folder, and only the framework primitives
 * (`SlideDef`, etc.) are imported from Slide of Hand.
 *
 * Source repo: gitlab.cfdata.org/mdias/cf247-dtx-manchester
 */
import type { Deck } from "@/framework/viewer/types";
import { meta } from "./meta";
import "./styles.css";

import { titleSlide } from "./slides/01-title";
import { cloudflareSlide } from "./slides/02-cloudflare";
import { storySlide } from "./slides/03-story";
import { forgottenProblemsSlide } from "./slides/04-forgotten-problems";
import { tugOfWarSlide } from "./slides/05-tug-of-war";
import { handoffSlide } from "./slides/06-handoff";
import { backdropSlide } from "./slides/07-backdrop";

const deck: Deck = {
  meta,
  slides: [
    titleSlide,
    cloudflareSlide,
    storySlide,
    forgottenProblemsSlide,
    tugOfWarSlide,
    handoffSlide,
    backdropSlide,
  ],
};

export default deck;
