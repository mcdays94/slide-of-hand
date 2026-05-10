import { motion } from "framer-motion";
import { easeEntrance } from "../../lib/motion";
import { DotPattern } from "./DotPattern";

/**
 * Full-bleed section divider slide. Big number + label + subtitle,
 * centered on a dotted-pattern background.
 */
export function SectionIntro({
  number,
  label,
  title,
  blurb,
  accent = "var(--color-cf-orange)",
}: {
  number: string;
  label: string;
  title: string;
  blurb?: string;
  accent?: string;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <DotPattern fade="edges" />
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: easeEntrance }}
          className="font-mono text-sm uppercase tracking-[0.18em] text-cf-text-muted"
        >
          <span style={{ color: accent }}>{number}</span> · {label}
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: easeEntrance }}
          className="mt-6 text-5xl tracking-[-0.04em] sm:text-7xl md:text-8xl"
        >
          {title}
        </motion.h2>
        {blurb && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4, ease: easeEntrance }}
            className="mt-6 max-w-xl text-lg text-cf-text-muted"
          >
            {blurb}
          </motion.p>
        )}
        <motion.div
          className="mt-10 h-1 rounded-full"
          style={{ background: accent }}
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 96, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.55, ease: easeEntrance }}
        />
      </div>
    </div>
  );
}
