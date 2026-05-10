import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { easeEntrance, easeButton } from "../lib/motion";
import {
  TYPESCRIPT_LOGOS,
  buildMarqueeSequence,
  computeBarTransform,
  sliverWidthPercent,
} from "./_typescript-logos";

/**
 * 08 — "LLMs have seen a LOT of TypeScript."
 *
 * The data-disparity slide that justifies the Code Mode insight. Two
 * stacked horizontal bars do the talking before the speaker says a
 * word:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  TypeScript on GitHub — millions of repos, billions of lines     │
 *   │  ┌────────────────────────────────────────────────────────────┐  │
 *   │  │ ▣ ◯ ▦ ▤ ▥ ▦ ▣ ▤ ◯ ▦ ▣ ◯ ▤ ▥ ◯ ▦ ▣ ◯ ▤ ▥ ◯ ▦ ▣ ◯ ▤ ▥ ◯  │  │ ← scrolling marquee
 *   │  │ ▥ ▦ ◯ ▣ ▤ ▥ ▦ ◯ ▣ ▤ ▥ ▦ ◯ ▣ ▤ ▥ ▦ ◯ ▣ ▤ ▥ ▦ ◯ ▣ ▤ ▥ ▦  │  │
 *   │  └────────────────────────────────────────────────────────────┘  │
 *   │                                                                  │
 *   │  Synthetic tool-call training data — contrived examples          │
 *   │  ┃ ← 1.4% sliver                                                  │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Phase 0 — both bars in their natural, full-deck layout. Marquee
 *           scrolling continuously (~30 s loop).
 * Phase 1 — top bar zooms in (1.5× scale + slight translate) so the
 *           logos feel like they're flooding the camera. Marquee keeps
 *           moving but the eye stays glued to the disparity.
 * Phase 2 — marquee freezes; the headline overlay
 *           "Code is the LLM's mother tongue." fades in on top.
 *
 * `prefers-reduced-motion: reduce`: the marquee never animates and
 * everything is rendered at its phase-2 end-state. No zoom, no scroll,
 * no shimmer.
 */

/** Width of one full marquee cycle as a percentage of its container. */
const MARQUEE_CYCLE_WIDTH = 50; // we render 2× the logos and translate -50%

/** Number of times we repeat the logo list to build the marquee belt. */
const MARQUEE_REPEATS = 3;

/** A single brand chip. Uses an SVG asset when one is available under
 *  /logos, otherwise renders a brand-coloured monogram in a rounded
 *  square. The chips are deliberately small (~64px) so the bar reads
 *  as a *sea* of logos, not a row of icons. */
function LogoChip({
  name,
  monogram,
  color,
  src,
}: {
  name: string;
  monogram: string;
  color: string;
  src?: string;
}) {
  return (
    <div
      className="flex h-[64px] w-[64px] flex-shrink-0 items-center justify-center rounded-[14px] border border-cf-border bg-cf-bg-100 shadow-[0_1px_0_rgba(82,16,0,0.04)]"
      title={name}
      aria-label={name}
    >
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="h-[36px] w-[36px] select-none object-contain"
          draggable={false}
        />
      ) : (
        <span
          aria-hidden="true"
          className="font-mono text-[18px] font-medium leading-none tracking-[-0.01em]"
          style={{ color }}
        >
          {monogram}
        </span>
      )}
    </div>
  );
}

function Body({ phase }: { phase: number }) {
  const reduce = useReducedMotion() ?? false;
  // When reduced-motion is on, force the end-state (phase 2).
  const effectivePhase = reduce ? 2 : phase;
  const camera = computeBarTransform(effectivePhase);

  // Build the marquee belt once. Two of these are rendered side-by-side
  // inside the marquee track so the translate-50% loop is seamless.
  const belt = useMemo(
    () => buildMarqueeSequence(TYPESCRIPT_LOGOS, MARQUEE_REPEATS),
    [],
  );

  const marqueeStyle: React.CSSProperties = {
    // CSS keyframe defined inline below; play state tied to phase.
    animation: reduce
      ? "none"
      : `cf-ts-marquee 36s linear infinite ${
          camera.marqueeRunning ? "running" : "paused"
        }`,
    animationDuration: phase === 1 && !reduce ? "60s" : "36s",
  };

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[1500px] flex-col gap-7 pt-2">
      {/* Inline keyframes for the marquee. Scoped to this slide. */}
      <style>{`
        @keyframes cf-ts-marquee {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-${MARQUEE_CYCLE_WIDTH}%, 0, 0); }
        }
        @keyframes cf-ts-shimmer {
          0%, 100% { opacity: 0.0; }
          50%      { opacity: 0.55; }
        }
      `}</style>

      {/* Eyebrow */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: easeEntrance }}
        className="flex items-center gap-3"
      >
        <Tag tone="info">The insight</Tag>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
          Where the model actually lives
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h2
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.05 }}
        className="text-[clamp(32px,4.2vw,60px)] font-medium leading-[1.02] tracking-[-0.035em] text-cf-text"
      >
        LLMs have seen a <span className="text-cf-orange">LOT</span> of
        TypeScript.
      </motion.h2>

      {/* Subtitle — the non-developer gloss. The audience may not know
          that TypeScript is a programming language, or what "training
          corpus" means. Spell it out plainly so the rest of the slide
          (and the punchline that follows) lands for everyone. */}
      <motion.p
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: easeEntrance, delay: 0.1 }}
        className="text-[clamp(15px,1.25vw,19px)] leading-[1.45] tracking-[-0.005em] text-cf-text-muted"
      >
        LLMs — the brains behind AI agents — learn by reading the open
        internet, and a huge slice of that is{" "}
        <span className="text-cf-text">code on GitHub</span>. They&rsquo;ve
        seen <span className="text-cf-text">trillions of lines</span> of
        TypeScript and JavaScript. What they&rsquo;ve barely seen is{" "}
        <span className="text-cf-text">tool calls</span> — those are
        contrived training examples that model labs cook up by hand.
      </motion.p>

      {/* The two bars + headline overlay live in a single relative box
          so the headline can sit on top of the top bar without shifting
          layout. Centered with mx-auto + a generous max-width so the
          marquee feels intentional rather than left-justified against
          the slide padding. */}
      <div className="relative mx-auto mt-1 flex w-full max-w-[1400px] flex-1 flex-col gap-5">
        {/* ─── TOP BAR — TypeScript on GitHub ───────────────────────── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                className="inline-block h-[8px] w-[8px] rounded-full"
                style={{ background: "var(--color-cf-orange)" }}
                aria-hidden="true"
              />
              <span className="text-[clamp(14px,1.2vw,18px)] font-medium tracking-[-0.015em] text-cf-text">
                TypeScript on GitHub
              </span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-muted">
              Millions of repos · billions of lines
            </span>
          </div>
        </div>

        {/* Top-bar marquee — centered within the slide body. */}
        <div
          className="relative w-full overflow-hidden rounded-[10px] border border-cf-border bg-cf-bg-200"
          style={{
            // The bar is the dominant visual element — give it real
            // height so the disparity vs the sliver below registers.
            height: "clamp(140px, 22vh, 220px)",
          }}
        >
          {/* Camera (zoom) layer — wraps the entire marquee belt. */}
          <motion.div
            className="absolute inset-0 origin-center"
            initial={false}
            animate={{
              transform: camera.transform,
            }}
            transition={{
              duration: reduce ? 0 : 0.8,
              ease: easeEntrance,
            }}
          >
            {/* Two marquee tracks side-by-side so the -50% loop is
                seamless. The tracks themselves don't move; the inner
                belt does. */}
            <div
              className="flex h-full items-center will-change-transform"
              style={marqueeStyle}
            >
              {/* First copy of the belt */}
              <MarqueeBelt belt={belt} />
              {/* Second copy — identical, sits right after the first */}
              <MarqueeBelt belt={belt} ariaHidden />
            </div>

            {/* Subtle shimmer overlay — kicks in on phase 1 only.
                A diagonal sweeping highlight that says "this is rich". */}
            {!reduce && phase === 1 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(115deg, transparent 30%, var(--color-cf-orange-light) 50%, transparent 70%)",
                  mixBlendMode: "multiply",
                  animation:
                    "cf-ts-shimmer 1.6s ease-in-out infinite",
                }}
              />
            )}
          </motion.div>

          {/* Edge fades — left + right gradients to soften the marquee
              ends so logos don't pop in/out abruptly. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-16"
            style={{
              background:
                "linear-gradient(90deg, var(--color-cf-bg-200), transparent)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-16"
            style={{
              background:
                "linear-gradient(270deg, var(--color-cf-bg-200), transparent)",
            }}
          />
        </div>

        {/* ─── BOTTOM BAR — Synthetic tool-call training data ──────── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                className="inline-block h-[8px] w-[8px] rounded-full"
                style={{ background: "var(--color-cf-text-subtle)" }}
                aria-hidden="true"
              />
              <span className="text-[clamp(14px,1.2vw,18px)] font-medium tracking-[-0.015em] text-cf-text">
                Synthetic tool-call training data
              </span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-muted">
              Contrived examples cooked up by model labs
            </span>
          </div>
        </div>

        <div className="relative w-full">
          {/* The container that defines "100% = the top bar's width" */}
          <div className="relative w-full">
            {/* The actual sliver — only ~1.4% wide. Deliberately empty
                inside: at this width any text content renders as
                clipped fragments that look like noise (e.g. "WI"
                instead of "What is..."). The bar's *width* is the
                whole point — the label sits outside it. */}
            <motion.div
              initial={reduce ? false : { width: 0 }}
              animate={{ width: sliverWidthPercent() }}
              transition={{
                duration: reduce ? 0 : 0.8,
                delay: reduce ? 0 : 0.4,
                ease: easeEntrance,
              }}
              className="relative h-[28px] rounded-[6px]"
              style={{
                background: "var(--color-cf-bg-300)",
                border: "1px solid var(--color-cf-border)",
              }}
              aria-label="A tiny sliver representing synthetic tool-call training data"
            />

            {/* Annotation pointing at the sliver — "← ~1.4% of the corpus".
                Anchored just to the right of the sliver, on the same
                row as the bar, so it reads as a single line: [bar] ←
                ~1.4% of the corpus · a few thousand examples.
                This is a key data point — it must read at lecture
                distance, not as a footnote. */}
            <div
              className="pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap text-[clamp(14px,1.05vw,17px)] leading-none tracking-[-0.01em] text-cf-text-muted"
              style={{ left: `calc(${sliverWidthPercent()} + 14px)` }}
            >
              <span aria-hidden="true" className="text-cf-text-subtle">
                ←
              </span>
              <span>
                <span className="font-medium text-cf-text">
                  ~{sliverWidthPercent()}
                </span>{" "}
                of the corpus
              </span>
              <span aria-hidden="true" className="text-cf-text-subtle">
                ·
              </span>
              <span className="text-cf-text-subtle">
                a few thousand contrived examples
              </span>
            </div>
          </div>
        </div>

        {/* ─── HEADLINE OVERLAY — phase 2 ─────────────────────────────
            The big "LLMs grew up reading code, not tool calls." card.
            Floats on top of the bars; revealed on phase 2. */}
        <motion.div
          aria-hidden={effectivePhase < 2}
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          initial={false}
          animate={{
            opacity: camera.headlineOpacity,
          }}
          transition={{
            duration: reduce ? 0 : 0.55,
            ease: easeEntrance,
          }}
        >
          <div className="relative">
            <CornerBrackets inset={-10}>
              <motion.div
                initial={false}
                animate={{
                  scale: camera.headlineOpacity > 0 ? 1 : 0.96,
                  y: camera.headlineOpacity > 0 ? 0 : 8,
                }}
                transition={{
                  duration: reduce ? 0 : 0.5,
                  ease: easeButton,
                }}
                className="rounded-2xl border border-cf-border bg-cf-bg-100 px-10 py-8"
                style={{
                  boxShadow:
                    "0 24px 60px -20px rgba(82, 16, 0, 0.25), 0 4px 14px -4px rgba(82, 16, 0, 0.10)",
                }}
              >
                <p
                  className="text-center font-medium leading-[1.02] tracking-[-0.04em] text-cf-text"
                  style={{ fontSize: "clamp(34px, 4.6vw, 66px)" }}
                >
                  LLMs grew up reading{" "}
                  <span className="text-cf-orange">code</span>,
                  <br />
                  not <span className="text-cf-orange">tool calls</span>.
                </p>
                <p
                  className="mt-4 text-center font-mono text-[11px] uppercase leading-[1.4] tracking-[0.14em] text-cf-text-muted"
                >
                  Code is their mother tongue —
                  <span className="text-cf-text-subtle">
                    {" "}
                    the language they&rsquo;re naturally fluent in.
                  </span>
                </p>
              </motion.div>
            </CornerBrackets>
          </div>
        </motion.div>
      </div>

      {/* ─── CLOSING PUNCHLINE — phase 2 ──────────────────────────────
          A single line that closes the argument and fills the empty
          space below the bars. Animates in alongside the headline
          overlay so the slide ends with a clear "so what". */}
      <motion.p
        aria-hidden={effectivePhase < 2}
        initial={false}
        animate={{
          opacity: effectivePhase >= 2 ? 1 : 0,
          y: effectivePhase >= 2 ? 0 : 10,
        }}
        transition={{
          duration: reduce ? 0 : 0.55,
          ease: easeEntrance,
          delay: reduce ? 0 : 0.15,
        }}
        className="mt-2 text-[clamp(18px,1.6vw,26px)] font-medium leading-[1.25] tracking-[-0.02em] text-cf-text"
      >
        So when we ask them to write{" "}
        <span className="text-cf-orange">code</span>, we&rsquo;re meeting
        them where they live.
      </motion.p>
    </div>
  );
}

/**
 * One copy of the marquee belt. We render TWO copies side-by-side and
 * translate the parent by -50% so the loop is seamless.
 */
function MarqueeBelt({
  belt,
  ariaHidden = false,
}: {
  belt: { key: string; logo: (typeof TYPESCRIPT_LOGOS)[number] }[];
  ariaHidden?: boolean;
}) {
  return (
    <div
      className="flex h-full flex-shrink-0 items-center gap-4 px-2"
      aria-hidden={ariaHidden}
    >
      {belt.map(({ key, logo }) => (
        <LogoChip
          key={key}
          name={logo.name}
          monogram={logo.monogram}
          color={logo.color}
          src={logo.src}
        />
      ))}
    </div>
  );
}

export const llmsLoveTypescriptSlide: SlideDef = {
  id: "llms-love-typescript",
  title: "LLMs have seen a LOT of TypeScript.",
  sectionLabel: "The insight",
  sectionNumber: "03",
  phases: 2,
  layout: "default",
  render: ({ phase }) => <Body phase={phase} />,
};
