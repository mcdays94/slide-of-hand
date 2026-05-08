/**
 * Cover template — large title, optional kicker above + subtitle below.
 *
 * Visual treatment mirrors `src/decks/public/hello/01-cover.tsx`. Each slot
 * is pre-wrapped in `<Reveal>` by the renderer (see
 * `src/framework/templates/render.tsx`), so the template just drops the
 * resolved nodes into its layout — no phase-awareness here.
 */

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { SlideTemplate } from "@/framework/templates/types";
import { pageEntrance, sectionSlideUp } from "@/lib/motion";

const cover: SlideTemplate<{
  title: "text";
  subtitle: "text";
  kicker: "text";
}> = {
  id: "cover",
  label: "Cover",
  description: "Hero title + optional kicker and subtitle. Default for talk openers.",
  defaultLayout: "cover",
  slots: {
    title: {
      kind: "text",
      label: "Title",
      description: "Large display title.",
      required: true,
      maxLength: 120,
      placeholder: "Hello, Slide of Hand",
    },
    kicker: {
      kind: "text",
      label: "Kicker",
      description: "Uppercase mono label above the title.",
      required: false,
      maxLength: 60,
      placeholder: "Slide of Hand · Demo",
    },
    subtitle: {
      kind: "text",
      label: "Subtitle",
      description: "Muted supporting line under the title.",
      required: false,
      maxLength: 200,
      placeholder: "A short demo of the framework.",
    },
  },
  // The renderer hands us pre-wrapped <Reveal> nodes per slot. We treat
  // each slot as an opaque ReactNode; the per-key SlotValue type asserted
  // in `SlideTemplate` is a static contract only (see the doc-block in
  // `render.tsx`).
  render: ({ slots }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = slots as unknown as {
      title: ReactNode;
      kicker?: ReactNode;
      subtitle?: ReactNode;
    };
    // NOTE: the renderer wraps each slot in a `<Reveal>` (a <motion.div>),
    // so the elements that *contain* a slot must be block-level (div), never
    // <p>/<span> — putting a <div> inside a <p> is an HTML invariant
    // violation and React will warn at runtime.
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 text-center">
        {s.kicker && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={pageEntrance}
            className="cf-tag"
          >
            {s.kicker}
          </motion.div>
        )}

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={sectionSlideUp}
          className="text-7xl font-medium tracking-[-0.04em] text-cf-text sm:text-8xl"
        >
          {s.title}
        </motion.h1>

        {s.subtitle && (
          <div className="max-w-2xl text-xl text-cf-text-muted">
            {s.subtitle}
          </div>
        )}
      </div>
    );
  },
};

export default cover;
