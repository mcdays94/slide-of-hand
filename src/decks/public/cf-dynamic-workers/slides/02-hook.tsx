import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance } from "../lib/motion";
import { GiantNumber } from "../components/primitives/GiantNumber";
import { Cite } from "../components/primitives/Cite";
import { SourceFooter } from "../components/primitives/SourceFooter";
import { Tag } from "../components/primitives/Tag";

/**
 * Slide 02 — The Hook.
 *
 * Opens the talk with a Socratic question that pays off, in three beats,
 * into the deck's thesis: a brand-new isolated mini-server can spawn in
 * a few milliseconds. Three phases:
 *
 *   Phase 0 — A single question hangs in the air.
 *   Phase 1 — Continuation lands: "…faster than it took you to blink?"
 *             plus the 5 ms beat as a giant number.
 *   Phase 2 — Reveals the scale of Workers ("millions of requests/sec")
 *             and the lifetime caption that justifies why a millisecond
 *             cold start matters.
 *
 * The bottom-left orange tag — "That's a Dynamic Worker." — appears with
 * the slide and stays. It's the punchline this whole talk pays off in
 * slide 06's plain-English definition.
 *
 * All reveals are layout-stable: opacity + y on motion.divs, never mount/
 * unmount via <Reveal>. That keeps surrounding elements pinned exactly
 * where they were so each beat lands without the page jumping.
 *
 * Citations:
 *   [1] Cold start of 5 ms — directly cited in the 2018 Cloudflare blog
 *       "Cloud Computing without Containers" by Zack Bloom (the post
 *       commonly attributed to Kenton Varda's isolate work). The exact
 *       sentence: "Isolates start in 5 milliseconds, a duration which
 *       is imperceptible."
 *   [2] Workers scale — directly cited in the March 2026 Cloudflare blog
 *       "Sandboxing AI agents, 100x faster" (the Dynamic Workers open
 *       beta announcement). The post explicitly states Workers "scale
 *       to millions of requests per second" and that "a million requests
 *       per second, where every single request loads a separate Dynamic
 *       Worker sandbox" is supported.
 *
 * Phrasing note: the brief originally suggested "X Workers requests per
 * quarter" sourced from a shareholder letter. I couldn't verify a
 * trillion-per-quarter Workers figure cleanly attributed in a public
 * Cloudflare source, so I switched to the directly-citable per-second
 * framing from the Dynamic Workers announcement. Same impact, honestly
 * sourced.
 */

const HOOK_QUESTION_LEAD = "What if your server could spawn another server\u2026";
const HOOK_QUESTION_TAIL = "\u2026faster than it took you to blink?";

const SOURCE_5MS = {
  n: 1,
  label: "Cloudflare Blog \u00B7 \u201CCloud Computing without Containers\u201D \u00B7 2018",
  href: "https://blog.cloudflare.com/cloud-computing-without-containers/",
} as const;

const SOURCE_SCALE = {
  n: 2,
  label: "Cloudflare Blog \u00B7 \u201CSandboxing AI agents, 100x faster\u201D \u00B7 Mar 2026",
  href: "https://blog.cloudflare.com/dynamic-workers/",
} as const;

export const hookSlide: SlideDef = {
  id: "hook",
  title: "Hook",
  layout: "default",
  // No section label — this slide opens the talk before section 01.
  phases: 2,
  render: ({ phase }) => <HookBody phase={phase} />,
};

function HookBody({ phase }: { phase: number }) {
  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col">
        {/* The question — phase 0 lead, phase 1 tail. Each line is its own
            motion.div so the tail can fade in without touching the lead.
            Sized to read as a serious opening question without dominating
            the slide — the 5 ms beat below is the visual climax. */}
        <motion.div
          className="flex flex-col gap-2"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: easeEntrance }}
        >
          <h2 className="text-left text-4xl leading-[1.06] tracking-[-0.03em] text-cf-text sm:text-5xl md:text-6xl">
            {HOOK_QUESTION_LEAD}
          </h2>

          <motion.h2
            className="text-left text-4xl leading-[1.06] tracking-[-0.03em] text-cf-text sm:text-5xl md:text-6xl"
            initial={false}
            animate={{
              opacity: phase >= 1 ? 1 : 0,
              y: phase >= 1 ? 0 : 16,
            }}
            transition={{
              duration: 0.55,
              ease: easeEntrance,
              delay: phase >= 1 ? 0.08 : 0,
            }}
          >
            {HOOK_QUESTION_TAIL}
          </motion.h2>
        </motion.div>

        {/* Phase 1 — the 5 ms beat. GiantNumber sized so it reads as the
            climax of the question. The "cold start" label is sized as a
            real, readable caption (lg, mono uppercase, dashed-top divider)
            instead of a tiny pixelated tag. */}
        <motion.div
          className="mt-10 flex flex-wrap items-end gap-x-10 gap-y-4"
          initial={false}
          animate={{
            opacity: phase >= 1 ? 1 : 0,
            y: phase >= 1 ? 0 : 16,
          }}
          transition={{
            duration: 0.55,
            ease: easeEntrance,
            delay: phase >= 1 ? 0.16 : 0,
          }}
        >
          <div className="flex items-end gap-3">
            <GiantNumber
              value={5}
              suffix=" ms"
              className="text-7xl leading-[0.9] sm:text-8xl md:text-[120px]"
            />
            <span className="mb-3">
              <Cite n={1} />
            </span>
          </div>
          <div className="mb-2 flex flex-col gap-1 border-l border-dashed border-cf-border pl-6">
            <span className="font-mono text-sm uppercase tracking-[0.16em] text-cf-orange">
              Cold start
            </span>
            <span className="max-w-[300px] text-sm text-cf-text-muted">
              The time it takes for a brand-new V8 isolate to be ready to run
              your code.
            </span>
          </div>
        </motion.div>

        {/* Phase 2 — the scale beat. Slightly smaller than the question
            so the eye moves down the slide naturally. */}
        <motion.div
          className="mt-12 max-w-[900px]"
          initial={false}
          animate={{
            opacity: phase >= 2 ? 1 : 0,
            y: phase >= 2 ? 0 : 16,
          }}
          transition={{
            duration: 0.55,
            ease: easeEntrance,
            delay: phase >= 2 ? 0.08 : 0,
          }}
        >
          <p className="text-2xl leading-[1.25] tracking-[-0.02em] text-cf-text sm:text-3xl md:text-4xl">
            Cloudflare Workers handles{" "}
            <span className="text-cf-orange">
              millions of requests every second
            </span>
            .
            <Cite n={2} />
          </p>
          <p className="mt-3 max-w-[760px] text-base text-cf-text-muted">
            And most of them — Dynamic Workers included — live less than a
            second.
          </p>
        </motion.div>

        {/* Spacer so the source footer pins to the bottom of the body
            column when there's room. */}
        <div className="flex-1" />

        <SourceFooter
          sources={[SOURCE_5MS, SOURCE_SCALE]}
          className="mt-10"
        />
      </div>

      {/* The punchline tag — bottom-left, visible from phase 0 onward.
          Pays off in slide 06 where the term is defined. Positioned
          absolutely so it doesn't push the body column up. */}
      <motion.div
        className="pointer-events-none absolute bottom-12 left-8 z-10 sm:bottom-16 sm:left-12"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.4 }}
      >
        <Tag tone="orange" className="!text-[11px] tracking-[0.1em]">
          That’s a Dynamic Worker.
        </Tag>
      </motion.div>
    </div>
  );
}
