import { motion, useReducedMotion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance } from "../lib/motion";

/**
 * 09 — "Putting Shakespeare in a Mandarin class" pull-quote.
 *
 * The punchline of section 03 (The Insight). We've spent the previous
 * two slides explaining that LLMs have read mountains of TypeScript
 * and almost zero synthetic tool-calls; this slide drives the point
 * home with a single, well-shaped quote from the Cloudflare engineers
 * who built Code Mode.
 *
 * Composition:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │                                              [quill, faint]  │
 *   │                                                              │
 *   │   "  (big orange glyph)                                      │
 *   │                                                              │
 *   │   Asking an LLM to call tools is like putting                │
 *   │   Shakespeare through a month-long class in                  │
 *   │   Mandarin and then asking him to write a play in            │
 *   │   it. It's just not going to be his best work."              │
 *   │                                                              │
 *   │   ─── KENTON VARDA & SUNIL PAI                               │
 *   │                                                              │
 *   │   BLOG.CLOUDFLARE.COM/CODE-MODE · 26 SEP 2025                │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Quote slides are static by design — the talk is about the words,
 * not the animation. Everything is visible at phase=0 with a single
 * staggered entrance on mount. The quote body renders in one uniform
 * colour — no in-line word highlight.
 *
 * `prefers-reduced-motion: reduce` snaps everything to its end-state.
 */

const QUOTE_BEFORE = "Asking an LLM to call tools is like putting Shakespeare through a month-long class in ";
const EMPHASIS = "Mandarin";
const QUOTE_AFTER =
  " and then asking him to write a play in it. It\u2019s just not going to be his best work.";

function Body(_props: { phase: number }) {
  const reduce = useReducedMotion();

  // Mount entrance — single clean stagger. Each child fades + slides
  // up by a few px. Phase reveals do not gate visibility.
  const entrance = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.5,
      ease: easeEntrance,
      delay: reduce ? 0 : delay,
    },
  });

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[1500px] flex-col justify-center px-10 py-10 sm:px-16">
      {/* Decorative quill / ink-blot, top-right corner — purely decorative */}
      <motion.svg
        aria-hidden="true"
        viewBox="0 0 120 120"
        className="pointer-events-none absolute right-10 top-8 h-24 w-24 select-none sm:right-16 sm:top-10 sm:h-28 sm:w-28"
        initial={reduce ? false : { opacity: 0, rotate: -8 }}
        animate={{ opacity: 0.18, rotate: 0 }}
        transition={{ duration: 1.1, ease: easeEntrance, delay: 0.1 }}
      >
        {/* Quill shaft */}
        <path
          d="M18 102 C 38 86, 68 50, 96 22"
          stroke="var(--color-cf-orange)"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
        {/* Feather */}
        <path
          d="M96 22 C 80 28, 64 42, 52 60 C 64 56, 78 50, 92 38 C 86 50, 76 60, 64 70 C 76 68, 88 60, 96 50 C 92 60, 84 68, 74 76 L 60 86"
          stroke="var(--color-cf-orange)"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Ink dot */}
        <circle cx="16" cy="104" r="3.2" fill="var(--color-cf-orange)" />
      </motion.svg>

      {/* Quote block — fills the slide. The opening glyph is tucked into
          the top-left as a side decoration; the quote itself spans the
          full width so it dominates the visible area. */}
      <div className="flex w-full flex-col gap-8">
        {/* Big orange opening quote glyph, on its own line above the
            text. Slightly larger than before to balance the bigger body. */}
        <motion.span
          aria-hidden="true"
          className="block select-none font-medium leading-[0.7] tracking-[-0.04em] text-cf-orange"
          style={{
            // Side decoration — slightly larger to balance the now-huge body.
            fontSize: "clamp(110px, 9vw, 180px)",
          }}
          {...entrance(0)}
        >
          {"\u201C"}
        </motion.span>

        {/* The quote itself — sized to dominate the room. Someone walking
            past the projector should be stopped by it. The body renders
            in a single uniform colour — no in-line emphasis. */}
        <motion.p
          className="font-medium leading-[1.1] tracking-[-0.03em] text-cf-text"
          style={{
            // 1080p: ~84px. Big enough to read from the back of a busy booth.
            // 4K (downscaled): ~80px (clamped). Floor of 40px for narrow viewports.
            fontSize: "clamp(40px, 4.4vw, 80px)",
          }}
          {...entrance(0.12)}
        >
          {QUOTE_BEFORE}
          {EMPHASIS}
          {QUOTE_AFTER}
        </motion.p>

        {/* Attribution */}
        <motion.div
          className="mt-2 flex items-center gap-4 font-mono uppercase text-cf-text-subtle"
          style={{
            fontSize: "clamp(13px, 1.1vw, 17px)",
            letterSpacing: "0.14em",
          }}
          {...entrance(0.24)}
        >
          <span
            aria-hidden="true"
            className="inline-block h-px w-12 bg-cf-border"
          />
          <span>Kenton Varda &amp; Sunil Pai</span>
        </motion.div>

        {/* Bottom citation — stays small and subtle */}
        <motion.div
          className="font-mono uppercase text-cf-text-subtle"
          style={{
            fontSize: "11px",
            letterSpacing: "0.14em",
          }}
          {...entrance(0.32)}
        >
          <span>blog.cloudflare.com/code-mode &middot; 26 Sep 2025</span>
        </motion.div>
      </div>
    </div>
  );
}

export const shakespeareQuoteSlide: SlideDef = {
  id: "shakespeare-quote",
  title: "Asking an LLM to call tools is like\u2026",
  sectionLabel: "The insight",
  sectionNumber: "03",
  // Single static phase — full quote visible on mount, no in-line emphasis.
  phases: 1,
  layout: "default",
  render: ({ phase }) => <Body phase={phase} />,
};
