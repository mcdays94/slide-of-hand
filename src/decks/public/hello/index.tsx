/**
 * Hello — the canonical demo deck.
 *
 * Five slides exercising every Wave 2 primitive: cover layout, default layout
 * with a chrome kicker, three-phase reveal mixing `<Reveal>` and `usePhase()`,
 * section divider, closing cover. Always present in the public registry.
 */

import type { Deck } from "@/framework/viewer/types";
import { coverSlide } from "./01-cover";
import { whatIsThisSlide } from "./02-what-is-this";
import { phaseDemoSlide } from "./03-phase-demo";
import { sectionSlide } from "./04-section";
import { thanksSlide } from "./05-thanks";

const deck: Deck = {
  meta: {
    slug: "hello",
    title: "Hello, ReAction",
    description:
      "A short demo of the ReAction framework — phase reveals, layouts, presenter affordances.",
    date: "2026-05-01",
    author: "Miguel Caetano Dias",
    runtimeMinutes: 2,
    tags: ["demo", "framework"],
  },
  slides: [
    coverSlide,
    whatIsThisSlide,
    phaseDemoSlide,
    sectionSlide,
    thanksSlide,
  ],
};

export default deck;
