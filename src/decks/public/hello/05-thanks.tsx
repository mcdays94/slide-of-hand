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
      <p>
        Final slide. Invite questions; the QR is a placeholder for now (a
        real one lands in a future iteration).
      </p>
      <p>Closing checklist:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Thank the audience by name where possible</li>
        <li>
          Repo URL out loud:{" "}
          <code>github.com/mcdays94/ReAction</code>
        </li>
        <li>
          Mention what's <em>not</em> in v1 (Cloudflare D1, R2, Hyperdrive —
          intentionally) so the architecture story stays clean
        </li>
        <li>If time runs short, skip Q&amp;A back to chapter 03</li>
      </ul>
      <p>
        Want feedback? Direct them to{" "}
        <a
          href="https://github.com/mcdays94/ReAction/discussions"
          className="text-cf-orange underline"
        >
          Discussions
        </a>
        .
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
