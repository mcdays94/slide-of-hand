/**
 * Phase reveal primitives.
 *
 * `<Reveal at={N}>` is mount/unmount — the children only enter the React tree
 * once the active phase >= N. Use this for distinct blocks where layout shift
 * between phases is acceptable (or even desirable).
 *
 * `<RevealInline at={N}>` keeps children mounted but toggles opacity (and
 * disables pointer events when hidden). Use this when the surrounding layout
 * must not jump as content reveals.
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { usePhase } from "./PhaseContext";
import { easeEntrance } from "@/lib/motion";

export interface RevealProps {
  at: number;
  children: ReactNode;
}

/**
 * Mount/unmount reveal. Children only render once the active phase >= `at`.
 * Wrapped in a Framer-Motion fade-in so newly mounted content lands gently.
 */
export function Reveal({ at, children }: RevealProps) {
  const phase = usePhase();
  if (phase < at) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: easeEntrance }}
      data-reveal-at={at}
    >
      {children}
    </motion.div>
  );
}

/**
 * Layout-stable reveal. Children stay mounted; opacity (and interactivity)
 * gates by phase. Prevents content jumps when revealing inline.
 */
export function RevealInline({ at, children }: RevealProps) {
  const phase = usePhase();
  const visible = phase >= at;
  return (
    <motion.span
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.35, ease: easeEntrance }}
      style={{ pointerEvents: visible ? "auto" : "none" }}
      aria-hidden={!visible}
      data-reveal-at={at}
    >
      {children}
    </motion.span>
  );
}
