/**
 * Slide 03 — phase reveal demo.
 *
 * Three phases. Demonstrates BOTH consumption patterns:
 *   - `<Reveal at={N}>` for the row of cards (mount/unmount)
 *   - `usePhase()` for the live counter (no layout shift)
 */

import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { Reveal } from "@/framework/viewer/Reveal";
import { usePhase } from "@/framework/viewer/PhaseContext";
import { easeStandard, staggerContainer, staggerItem } from "@/lib/motion";

function PhaseCounter() {
  const phase = usePhase();
  return (
    <motion.div
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: easeStandard }}
      className="flex items-baseline gap-3"
    >
      <span className="cf-tag">Phase</span>
      <motion.span
        key={phase}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: easeStandard }}
        className="font-mono text-3xl font-medium tabular-nums tracking-tight text-cf-orange"
      >
        {phase}
      </motion.span>
      <span className="text-cf-text-subtle">/ 3</span>
    </motion.div>
  );
}

export const phaseDemoSlide: SlideDef = {
  id: "phase-demo",
  title: "Phase reveals",
  layout: "default",
  sectionLabel: "Live demo",
  sectionNumber: "02",
  phases: 3,
  runtimeSeconds: 40,
  notes: (
    <>
      <p>
        Press <kbd>→</kbd> three times to reveal the cards in turn. The phase
        counter at the top is driven by <code>usePhase()</code> — it stays
        mounted, just animates as the phase ticks.
      </p>
      <p>
        Use <code>&lt;Reveal at={"{N}"}&gt;</code> for distinct blocks where
        layout shift is fine; use the hook + opacity when content above /
        below would jump.
      </p>
    </>
  ),
  render: () => (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-5xl font-medium tracking-[-0.03em] text-cf-text">
          Phase reveals
        </h2>
        <PhaseCounter />
      </div>

      <p className="max-w-2xl text-lg leading-relaxed text-cf-text-muted">
        A slide can declare <code className="font-mono text-base text-cf-text">phases: N</code>{" "}
        — pressing <kbd className="font-mono">→</kbd> walks the phase from 0
        through N before stepping to the next slide.
      </p>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-3 gap-4"
      >
        <Reveal at={1}>
          <motion.div variants={staggerItem} className="cf-card p-6">
            <p className="cf-tag mb-2">Phase 1</p>
            <p className="text-base font-medium text-cf-text">
              Mount/unmount via <code className="font-mono text-sm">&lt;Reveal&gt;</code>.
            </p>
            <p className="mt-2 text-sm text-cf-text-muted">
              First card lands.
            </p>
          </motion.div>
        </Reveal>

        <Reveal at={2}>
          <motion.div variants={staggerItem} className="cf-card p-6">
            <p className="cf-tag mb-2">Phase 2</p>
            <p className="text-base font-medium text-cf-text">
              Animations come from <code className="font-mono text-sm">@/lib/motion</code>.
            </p>
            <p className="mt-2 text-sm text-cf-text-muted">
              Second card slides in.
            </p>
          </motion.div>
        </Reveal>

        <Reveal at={3}>
          <motion.div variants={staggerItem} className="cf-card p-6">
            <p className="cf-tag mb-2">Phase 3</p>
            <p className="text-base font-medium text-cf-text">
              Tokens drive every colour you see.
            </p>
            <p className="mt-2 text-sm text-cf-text-muted">
              Final card. Press <kbd>→</kbd> once more for the next slide.
            </p>
          </motion.div>
        </Reveal>
      </motion.div>
    </div>
  ),
};
