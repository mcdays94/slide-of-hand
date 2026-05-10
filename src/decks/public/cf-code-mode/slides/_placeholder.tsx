import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { motion } from "framer-motion";
import { easeEntrance } from "../lib/motion";

/**
 * makeStub — produces a SlideDef placeholder so the deck builds while
 * individual slides are still being authored. Each placeholder shows a
 * clear "WIP" badge so anyone running the deck knows it's not the final
 * content. Pocock-workers will replace each one with a fully-built slide.
 */
export function makeStub(opts: {
  id: string;
  title: string;
  sectionLabel?: string;
  sectionNumber?: string;
  /**
   * Number of phase reveals the future "real" version is expected to
   * have. Stubs ignore the phase value and just render their static
   * placeholder body, but exposing the count here lets the deck's
   * progress indicator show the right number of dots so a presenter
   * dry-running the deck can see "this slide is supposed to have N
   * phase reveals when it ships".
   */
  phases?: number;
  notes?: string;
  body?: string;
}): SlideDef {
  return {
    id: opts.id,
    title: opts.title,
    sectionLabel: opts.sectionLabel,
    sectionNumber: opts.sectionNumber,
    phases: opts.phases,
    layout: "default",
    render: () => (
      <motion.div
        className="mx-auto flex max-w-[1100px] flex-col gap-6 pt-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance }}
      >
        <Tag tone="warning">Placeholder · being authored</Tag>
        <h2 className="text-[clamp(36px,4.4vw,64px)] font-medium leading-[1.05] tracking-[-0.035em] text-cf-text">
          {opts.title}
        </h2>
        {opts.body && (
          <p className="max-w-[64ch] text-[clamp(16px,1.4vw,22px)] leading-[1.55] text-cf-text-muted">
            {opts.body}
          </p>
        )}
        {opts.notes && (
          <pre className="mt-4 max-w-[80ch] overflow-x-auto rounded-xl border border-cf-border bg-cf-bg-200 p-5 font-mono text-[12px] leading-[1.65] text-cf-text-muted">
            {opts.notes}
          </pre>
        )}
      </motion.div>
    ),
  };
}
