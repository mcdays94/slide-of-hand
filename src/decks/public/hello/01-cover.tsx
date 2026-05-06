/**
 * Slide 01 — cover.
 *
 * Big title + subtitle, no chrome. One phase reveal demonstrates the basic
 * `<Reveal at={1}>` pattern.
 */

import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { Reveal } from "@/framework/viewer/Reveal";
import { pageEntrance, sectionSlideUp } from "@/lib/motion";

export const coverSlide: SlideDef = {
  id: "cover",
  title: "Hello, Slide of Hand",
  layout: "cover",
  phases: 1,
  runtimeSeconds: 25,
  notes: (
    <>
      <p>
        Welcome the audience to the Slide of Hand demo deck. Set expectations: this
        is a fast tour, no live-coding here.
      </p>
      <p>What you'll cover, in order:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>What Slide of Hand is, in one sentence</li>
        <li>Phase reveals — the only animation primitive you'll author</li>
        <li>Layouts — four modes, no theme system</li>
        <li>Q&amp;A / repo link</li>
      </ul>
      <p>
        Press <kbd>→</kbd> to reveal the subtitle on this slide.
      </p>
    </>
  ),
  render: () => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 text-center">
      <motion.p
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={pageEntrance}
        className="cf-tag"
      >
        Slide of Hand · Demo
      </motion.p>

      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={sectionSlideUp}
        className="text-7xl font-medium tracking-[-0.04em] text-cf-text sm:text-8xl"
      >
        Hello, Slide of Hand
      </motion.h1>

      <Reveal at={1}>
        <p className="max-w-2xl text-xl text-cf-text-muted">
          A short demo of the framework — phase reveals, layouts, presenter
          affordances.
        </p>
      </Reveal>
    </div>
  ),
};
