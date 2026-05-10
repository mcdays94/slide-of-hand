import { motion, useReducedMotion } from "framer-motion";
import { Cable, Code2, Zap, Box } from "lucide-react";
import type { ReactNode } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { easeEntrance } from "../lib/motion";
import {
  PILLAR_COUNT,
  tokensSavedAfterPhase,
  type Phase,
} from "./15-recap-logic";

/**
 * 15 — Recap: four things to remember.
 *
 * The talk's emotional landing pad. Four pillars — one per phase reveal —
 * collapse the 15-minute story into four sentences a non-developer can
 * carry out of the room.
 *
 * Composition:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Four things to remember.                                        │
 *   │                                                                  │
 *   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                     │
 *   │  │ icon   │ │ icon   │ │ icon   │ │ icon   │                     │
 *   │  │ ────── │ │ ────── │ │ ────── │ │ ────── │                     │
 *   │  │ head   │ │ head   │ │ head   │ │ head   │                     │
 *   │  │ sub    │ │ sub    │ │ sub    │ │ sub    │                     │
 *   │  └────────┘ └────────┘ └────────┘ └────────┘                     │
 *   │                                                                  │
 *   │            17,000 tokens                                         │
 *   │            saved per typical agent run                           │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Phase reveals:
 *   1 → pillar 1 fades in + counter ticks to ~4,000
 *   2 → pillar 2 fades in + counter ticks to ~8,000
 *   3 → pillar 3 (the punchline pillar) fades in + counter to ~13,000
 *   4 → pillar 4 fades in + counter lands on 17,000
 *
 * Each pillar uses a layout-stable opacity reveal — the grid is fully
 * laid out from frame 0 so nothing shifts beneath the counter. Reduced
 * motion snaps everything to its end-state.
 */

interface Pillar {
  icon: typeof Cable;
  headline: string;
  sub: string;
  /** True for the keystone pillar — gets a soft orange treatment. */
  highlight?: boolean;
}

const PILLARS: readonly Pillar[] = [
  {
    icon: Cable,
    headline: "MCP is a connectivity layer.",
    sub: "Not the best front-end for the LLM.",
  },
  {
    icon: Code2,
    headline: "LLMs are coders, not callers.",
    sub: "They've seen GitHub. They have not seen synthetic tool calls.",
  },
  {
    icon: Zap,
    headline: "Code Mode = one tool, one round-trip.",
    sub: "Fewer tokens. Lower cost. Faster turn-around.",
    highlight: true,
  },
  {
    icon: Box,
    headline: "V8 isolates make sandboxed exec practical.",
    sub: "Milliseconds, not seconds. Every snippet gets a fresh isolate.",
  },
] as const;

interface PillarCardProps {
  index: number;
  pillar: Pillar;
  phase: number;
  reduce: boolean;
}

function PillarCard({ index, pillar, phase, reduce }: PillarCardProps) {
  const at = index + 1; // pillar 1 highlights on phase 1, etc.
  // All pillars are visible from phase 0 — the recap is a scan-read for
  // the audience, not a click-through reveal. Phase advances trigger a
  // subtle accent pulse on the matching pillar instead, with the bottom
  // tokens-saved counter ticking up.
  const Icon = pillar.icon;
  const highlighted = !reduce && phase === at;

  return (
    <motion.div
      className="h-full"
      // Mount-time stagger so the row reads as a single graceful sweep.
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        ease: easeEntrance,
        delay: reduce ? 0 : 0.12 + index * 0.08,
      }}
      style={
        highlighted
          ? {
              boxShadow:
                "0 0 0 2px var(--color-cf-orange-light), 0 8px 24px rgba(255, 72, 1, 0.08)",
            }
          : undefined
      }
    >
      <CornerBrackets className="h-full">
        <div
          className={[
            "group relative flex h-full flex-col gap-4 rounded-2xl border bg-cf-bg-200 px-7 py-8 transition-colors",
            "hover:[border-style:dashed]",
            pillar.highlight ? "border-cf-orange-light" : "border-cf-border",
          ].join(" ")}
          style={
            pillar.highlight
              ? {
                  background:
                    "linear-gradient(180deg, var(--color-cf-orange-light) 0%, var(--color-cf-bg-200) 75%)",
                }
              : undefined
          }
        >
          {/* Pillar number + icon */}
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
              0{at}
            </span>
            <Icon
              size={28}
              strokeWidth={1.5}
              className={
                pillar.highlight ? "text-cf-orange" : "text-cf-text-muted"
              }
              aria-hidden="true"
            />
          </div>

          {/* Hairline divider */}
          <div className="h-px bg-cf-border" aria-hidden="true" />

          {/* Headline */}
          <h3 className="text-[clamp(16px,1.5vw,22px)] font-medium leading-[1.25] tracking-[-0.02em] text-cf-text">
            {pillar.headline}
          </h3>

          {/* Sub-line */}
          <p className="text-[clamp(13px,1.1vw,16px)] leading-[1.5] tracking-[-0.005em] text-cf-text-muted">
            {pillar.sub}
          </p>
        </div>
      </CornerBrackets>
    </motion.div>
  );
}

interface TokenCounterProps {
  phase: number;
  reduce: boolean;
}

/**
 * The counter renders a value derived deterministically from the current
 * phase via `tokensSavedAfterPhase`. We don't run a tween here — phase
 * advances are visual events of their own, and the value will jump
 * crisply rather than tween (which would feel out-of-sync with the
 * pillar reveals).
 *
 * For reduced-motion the counter snaps to its final value.
 */
function TokenCounter({ phase, reduce }: TokenCounterProps) {
  const clamped = Math.max(0, Math.min(PILLAR_COUNT, phase)) as Phase;
  const value = reduce
    ? tokensSavedAfterPhase(PILLAR_COUNT as Phase)
    : tokensSavedAfterPhase(clamped);

  return (
    <motion.div
      className="mt-2 flex flex-col items-center gap-2 text-center"
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: easeEntrance, delay: reduce ? 0 : 0.4 }}
    >
      <div className="flex items-baseline gap-3">
        {/*
          tabular-nums + min-width-by-character keeps the digits from
          dancing horizontally as the counter ticks across phases.
        */}
        <motion.span
          key={value}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: easeEntrance }}
          className="font-medium leading-none tracking-[-0.04em] text-cf-orange [font-variant-numeric:tabular-nums]"
          style={{ fontSize: "clamp(56px, 7vw, 96px)" }}
          aria-live="polite"
        >
          {value.toLocaleString("en-US")}
        </motion.span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-cf-text-muted">
          tokens
        </span>
      </div>
      <p className="max-w-[60ch] text-[clamp(12px,1.05vw,15px)] leading-[1.5] text-cf-text-muted">
        Tokens you&rsquo;d save in a typical agent run by switching to Code Mode.
      </p>
    </motion.div>
  );
}

interface BodyProps {
  phase: number;
}

function Body({ phase }: BodyProps): ReactNode {
  const reduceRaw = useReducedMotion();
  const reduce = reduceRaw ?? false;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 pt-2">
      {/* Heading */}
      <motion.h2
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: easeEntrance }}
        className="text-[clamp(36px,4.4vw,64px)] font-medium leading-[1.05] tracking-[-0.035em] text-cf-text"
      >
        Four things to remember.
      </motion.h2>

      {/* Pillar grid — 4 cols on lg+, stacked on mobile/tablet.
          `auto-rows-fr` makes every row identical height so all four
          pillar cards match regardless of headline/sub-line length. */}
      <div className="grid auto-rows-fr grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {PILLARS.map((pillar, i) => (
          <PillarCard
            key={pillar.headline}
            index={i}
            pillar={pillar}
            phase={phase}
            reduce={reduce}
          />
        ))}
      </div>

      {/* Tokens-saved counter */}
      <TokenCounter phase={phase} reduce={reduce} />
    </div>
  );
}

export const recapSlide: SlideDef = {
  id: "recap",
  title: "Four things to remember.",
  sectionLabel: "Takeaways",
  sectionNumber: "07",
  phases: 4,
  layout: "default",
  render: ({ phase }) => <Body phase={phase} />,
};
