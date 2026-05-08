/**
 * Section template — chapter divider with big numeric marker, kicker
 * label, and large title. Mirrors `src/decks/public/hello/04-section.tsx`.
 *
 * All slot nodes arrive pre-wrapped in `<Reveal>` from the renderer,
 * so this template just lays them out — no phase-awareness here.
 */

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { SlideTemplate } from "@/framework/templates/types";
import { sectionSlideUp } from "@/lib/motion";

const section: SlideTemplate<{
  title: "text";
  label: "text";
  number: "text";
}> = {
  id: "section",
  label: "Section",
  description:
    "Chapter divider with a big numeric marker. No chrome — gives the audience a beat between sections.",
  defaultLayout: "section",
  slots: {
    title: {
      kind: "text",
      label: "Title",
      description: "The chapter title.",
      required: true,
      maxLength: 120,
      placeholder: "Layouts",
    },
    label: {
      kind: "text",
      label: "Kicker",
      description: "Uppercase mono label above the number (e.g. 'Chapter').",
      required: false,
      maxLength: 60,
      placeholder: "Chapter 03",
    },
    number: {
      kind: "text",
      label: "Number",
      description: "Big numeric marker (e.g. '03').",
      required: false,
      maxLength: 8,
      placeholder: "03",
    },
  },
  render: ({ slots }) => {
    const s = slots as unknown as {
      title: ReactNode;
      label?: ReactNode;
      number?: ReactNode;
    };
    return (
      <div className="flex h-full w-full items-center px-24">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={sectionSlideUp}
          className="flex flex-col gap-6"
        >
          {s.label && <div className="cf-tag">{s.label}</div>}
          {s.number && (
            <div className="font-mono text-[12rem] font-medium leading-none tracking-[-0.05em] text-cf-orange">
              {s.number}
            </div>
          )}
          <h2 className="max-w-2xl text-6xl font-medium tracking-[-0.04em] text-cf-text">
            {s.title}
          </h2>
        </motion.div>
      </div>
    );
  },
};

export default section;
