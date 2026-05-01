/**
 * Slide 05 — thanks.
 *
 * Cover layout. Closing slide; placeholder QR / link to repo.
 */

import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { pageEntrance, sectionSlideUp } from "@/lib/motion";

export const thanksSlide: SlideDef = {
  id: "thanks",
  title: "Thanks",
  layout: "cover",
  runtimeSeconds: 20,
  notes: (
    <>
      <p>Final slide — invite questions.</p>
      <p>
        Mention the repo URL (or scan-the-QR if a real QR lands here in a
        future iteration). Thank the audience.
      </p>
    </>
  ),
  render: () => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-10 text-center">
      <motion.p
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={pageEntrance}
        className="cf-tag"
      >
        Fin
      </motion.p>

      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={sectionSlideUp}
        className="text-8xl font-medium tracking-[-0.04em] text-cf-text"
      >
        Thanks.
      </motion.h1>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...pageEntrance, delay: 0.2 }}
        className="flex flex-col items-center gap-3"
      >
        <div
          aria-hidden
          className="flex h-32 w-32 items-center justify-center rounded-md border border-dashed border-cf-border bg-cf-bg-200/60 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle"
        >
          QR
        </div>
        <p className="font-mono text-sm text-cf-text-muted">
          github.com/mcdays94/ReAction
        </p>
      </motion.div>
    </div>
  ),
};
