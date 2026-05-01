/**
 * Slide 04 — section divider.
 *
 * Section layout (no chrome). Big section number + title. Demonstrates the
 * `section` layout mode, used between chapters of a longer deck.
 */

import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { sectionSlideUp } from "@/lib/motion";

export const sectionSlide: SlideDef = {
  id: "section",
  title: "Section divider",
  layout: "section",
  sectionLabel: "Chapter",
  sectionNumber: "03",
  runtimeSeconds: 15,
  notes: (
    <>
      <p>
        Pause for a beat. A section divider gives the audience a clean
        breathing point between chapters — no chrome, no progress bar, just
        the big numeral and the chapter title.
      </p>
      <p>The four built-in layouts and when to reach for each:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>
          <code>cover</code> — title slides, opening hero, closing thanks
        </li>
        <li>
          <code>section</code> — chapter dividers like this one
        </li>
        <li>
          <code>default</code> — body slides; gets the kicker + progress bar
        </li>
        <li>
          <code>full</code> — slide owns the whole viewport (live demos,
          embeds, custom edge-to-edge visuals)
        </li>
      </ul>
    </>
  ),
  render: () => (
    <div className="flex h-full w-full items-center px-24">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={sectionSlideUp}
        className="flex flex-col gap-6"
      >
        <p className="cf-tag">Chapter 03</p>
        <p className="font-mono text-[12rem] font-medium leading-none tracking-[-0.05em] text-cf-orange">
          03
        </p>
        <h2 className="max-w-2xl text-6xl font-medium tracking-[-0.04em] text-cf-text">
          Layouts
        </h2>
        <p className="max-w-xl text-lg text-cf-text-muted">
          Cover, section, default, full — the four built-in modes. Pick the one
          that fits the slide; the chrome adapts.
        </p>
      </motion.div>
    </div>
  ),
};
