import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance } from "../lib/motion";
import { DotPattern } from "../components/primitives/DotPattern";

/**
 * Slide 11 — Recap.
 *
 * The single-sentence thesis of the deck, large and centered, that the
 * audience walks out repeating. Brand orange highlights the three pivot
 * words: "mini-server", "milliseconds", "your code".
 *
 * Cover layout: no header/footer chrome, the sentence owns the canvas.
 */
export const recapSlide: SlideDef = {
  id: "recap",
  title: "Recap",
  layout: "cover",
  render: () => <RecapBody />,
};

function RecapBody() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-cf-bg-100">
      <DotPattern fade="edges" />

      <motion.div
        className="relative z-10 mx-auto flex w-full max-w-[1100px] flex-col items-center text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: easeEntrance }}
      >
        {/* Kicker — quiet mono label that frames the sentence as a takeaway.
            Sits well above the headline with generous breathing room. */}
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-cf-text-muted">
          Take this home
        </span>

        {/* The thesis. Large, tight, medium weight. Brand orange only on the
            three pivot words — everything else stays in cf-text. */}
        <h2
          className="mt-10 text-6xl leading-[1.05] tracking-[-0.04em] text-cf-text sm:text-7xl"
        >
          Cloudflare can spawn a brand-new, isolated{" "}
          <span className="text-cf-orange">mini-server</span> in a few{" "}
          <span className="text-cf-orange">milliseconds</span> — and{" "}
          <span className="text-cf-orange">your code</span> can do that on
          demand.
        </h2>

        {/* Whisper-quiet section recap. The four chapters of the deck, as
            tiny pills, separated by mid-dots. Low contrast so the eye stays
            on the sentence above. */}
        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
          <span>The shape of compute</span>
          <span aria-hidden="true">·</span>
          <span>What's a Dynamic Worker?</span>
          <span aria-hidden="true">·</span>
          <span>Live demo</span>
          <span aria-hidden="true">·</span>
          <span>Why this matters</span>
        </div>
      </motion.div>
    </div>
  );
}
