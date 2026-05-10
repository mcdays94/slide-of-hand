import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePhase } from "@/framework/viewer/PhaseContext";
import { easeButton } from "./motion";

/**
 * Reveals its children when the current phase is >= `at`.
 * Default animation: fade + 12px slide-up over 350ms.
 *
 * Pair with a parent slide that declares `phases: N`. Reveals then unfold
 * as the user presses Right.
 *
 * Examples:
 *   <Reveal at={1}><Card>Second card</Card></Reveal>
 *   <Reveal at={2} y={24}><Banner>Insight</Banner></Reveal>
 */
export function Reveal({
  at,
  children,
  y = 12,
  delay = 0,
  duration = 0.35,
  className,
}: {
  at: number;
  children: ReactNode;
  /** Vertical offset before reveal (px). Default 12. */
  y?: number;
  /** Extra delay after the phase fires. */
  delay?: number;
  /** Animation duration. */
  duration?: number;
  className?: string;
}) {
  const phase = usePhase();
  const visible = phase >= at;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {visible && (
        <motion.div
          key={`reveal-${at}`}
          initial={{ opacity: 0, y }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -y / 2 }}
          transition={{ duration, ease: easeButton, delay }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Reveal but as inline content (span). Uses opacity-only fade so layout
 * doesn't shift.
 */
export function RevealInline({
  at,
  children,
  className,
}: {
  at: number;
  children: ReactNode;
  className?: string;
}) {
  const phase = usePhase();
  const visible = phase >= at;
  return (
    <motion.span
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.3, ease: easeButton }}
      className={className}
      style={{ display: "inline-block" }}
    >
      {children}
    </motion.span>
  );
}
