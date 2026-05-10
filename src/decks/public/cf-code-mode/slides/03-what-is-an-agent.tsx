import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Brain, Wrench, RefreshCw } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";
import { easeEntrance, easeButton } from "../lib/motion";
import {
  LOOP_NODES,
  nodePosition,
  dotPosition,
} from "./_agent-loop-logic";

/**
 * 03 — What is an AI agent?
 *
 * Two-phase reveal:
 *
 *   Phase 1 — All three role cards appear (Brain, Hands, Will) staggered.
 *   Phase 2 — The agentic-loop centerpiece fades in BENEATH the cards
 *             with its orbiting dots already running, plus the
 *             "bridge to MCP" callout.
 *
 * Layout (no overlap between Will card and loop):
 *
 *   [ Brain ]    [ Hands ]    [ Will ]      ← row 1 (cards, phase 1)
 *
 *           [   THE AGENTIC LOOP  ]         ← row 2 (loop, phase 2)
 *
 *           [   bridge to MCP     ]         ← row 3 (callout)
 *
 * The loop sits on its own row so the Will card never sits on top of it.
 * Loop diameter and node-label sizes are bumped so the audience can read
 * the cycle from the back of the room.
 */

const ACCENTS: Record<"brain" | "hands" | "will", string> = {
  brain: "var(--color-cf-info)",
  hands: "var(--color-cf-orange)",
  will: "var(--color-cf-ai)",
};

const ROLE_TAGS: Record<"brain" | "hands" | "will", string> = {
  brain: "01 · The brain",
  hands: "02 · The hands",
  will: "03 · The will",
};

interface RoleCardProps {
  role: "brain" | "hands" | "will";
  title: string;
  oneLiner: string;
  examples: string;
  icon: ReactNode;
  accent: string;
  /** Stagger delay (s) on initial mount. */
  delay?: number;
}

function RoleCard({
  role,
  title,
  oneLiner,
  examples,
  icon,
  accent,
  delay = 0,
}: RoleCardProps) {
  // No breathing / sub-pixel idle animation — user reported it read as a
  // "reset" of the entrance. Cards now mount once and stay still.
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: easeEntrance, delay }}
      className="relative h-full"
    >
      <CornerBrackets>
        <div
          className="flex h-full flex-col gap-4 rounded-2xl border bg-cf-bg-200 px-6 py-6 transition-[border-style] duration-200 hover:border-dashed"
          style={{
            borderColor: `color-mix(in srgb, ${accent} 35%, var(--color-cf-border))`,
            boxShadow: `0 0 0 1px color-mix(in srgb, ${accent} 18%, transparent), 0 14px 38px -28px ${accent}`,
          }}
        >
          {/* Icon plate + role tag */}
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border"
              style={{
                background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`,
                color: accent,
              }}
              aria-hidden
            >
              {icon}
            </span>
            <span
              className="font-mono text-[11px] uppercase tracking-[0.14em]"
              style={{ color: accent }}
            >
              {ROLE_TAGS[role]}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-[clamp(22px,1.95vw,30px)] font-medium leading-[1.1] tracking-[-0.025em] text-cf-text">
            {title}
          </h3>

          {/* One-liner */}
          <p className="text-[clamp(14px,1.15vw,18px)] leading-[1.5] text-cf-text-muted">
            {oneLiner}
          </p>

          {/* Examples footer */}
          <div className="mt-auto border-t border-cf-border pt-3">
            <p className="font-mono text-[11px] uppercase leading-[1.5] tracking-[0.06em] text-cf-text-subtle">
              {examples}
            </p>
          </div>
        </div>
      </CornerBrackets>
    </motion.div>
  );
}

/**
 * The agent loop — visual centerpiece. Larger than the QA-round-3
 * version (was 400×400 with R=116 / 11px labels) so the cycle reads
 * cleanly from a conference back row.
 */
function AgentLoop() {
  // Slightly wider than tall so the right-side "DECIDE" label has room
  // without clipping. Ring is centred vertically.
  const W = 460;
  const H = 380;
  const R = 130;
  const CX = W / 2;
  const CY = H / 2;
  const PERIOD = 9; // seconds per full cycle
  const TRAIL_COUNT = 6;
  const TRAIL_SPACING = 0.18;

  const reduce = useReducedMotion();
  const [t, setT] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduce) return;
    if (typeof window === "undefined") return;
    const start = performance.now();
    const tick = (now: number) => {
      setT((now - start) / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [reduce]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: easeEntrance }}
      className="relative flex flex-col items-center"
      aria-label="Talk, Decide, Act, Read agent loop"
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        aria-hidden
      >
        <defs>
          <radialGradient id="agent-loop-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-cf-orange)" stopOpacity="0.08" />
            <stop offset="60%" stopColor="var(--color-cf-orange)" stopOpacity="0.018" />
            <stop offset="100%" stopColor="var(--color-cf-orange)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Halo */}
        <circle cx={CX} cy={CY} r={R + 28} fill="url(#agent-loop-halo)" />

        {/* Inner faint ring */}
        <circle
          cx={CX}
          cy={CY}
          r={R - 18}
          fill="none"
          stroke="var(--color-cf-border)"
          strokeWidth={0.8}
          strokeOpacity={0.5}
        />

        {/* The dashed orbital ring — ambient pulse */}
        <motion.circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="var(--color-cf-text-muted)"
          strokeWidth={1.4}
          strokeDasharray="5 6"
          initial={{ strokeOpacity: reduce ? 0.45 : 0.3 }}
          animate={
            reduce
              ? { strokeOpacity: 0.45 }
              : { strokeOpacity: [0.3, 0.6, 0.3] }
          }
          transition={
            reduce
              ? { duration: 0 }
              : {
                  duration: 4,
                  ease: easeButton,
                  repeat: Infinity,
                  repeatType: "loop",
                }
          }
        />

        {/* Slow ring drift via dashoffset (not visible rotation) */}
        {!reduce && (
          <motion.circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke="var(--color-cf-text-muted)"
            strokeWidth={1.4}
            strokeDasharray="5 6"
            strokeOpacity={0.18}
            initial={{ strokeDashoffset: 0 }}
            animate={{ strokeDashoffset: -44 }}
            transition={{
              duration: 18,
              ease: "linear",
              repeat: Infinity,
              repeatType: "loop",
            }}
          />
        )}

        {/* Node labels */}
        {LOOP_NODES.map((label, i) => {
          const { x, y } = nodePosition(i, LOOP_NODES.length, R);
          const isTop = i === 0;
          const isRight = i === 1;
          const isBottom = i === 2;
          const labelDx = isRight ? 18 : i === 3 ? -18 : 0;
          const labelDy = isTop ? -20 : isBottom ? 28 : 0;
          return (
            <g key={label} transform={`translate(${CX + x}, ${CY + y})`}>
              <circle
                r={5}
                fill="var(--color-cf-bg-100)"
                stroke="var(--color-cf-text-muted)"
                strokeWidth={1.4}
              />
              <line
                x1={0}
                y1={0}
                x2={(-x / R) * 10}
                y2={(-y / R) * 10}
                stroke="var(--color-cf-border)"
                strokeWidth={0.8}
              />
              <text
                x={labelDx}
                y={labelDy}
                textAnchor={isRight ? "start" : i === 3 ? "end" : "middle"}
                dominantBaseline={isTop ? "auto" : isBottom ? "hanging" : "middle"}
                className="font-mono"
                fontSize={14}
                letterSpacing={1.6}
                fill="var(--color-cf-text)"
                style={{ textTransform: "uppercase", fontWeight: 500 }}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Centre dot + tagline */}
        <circle
          cx={CX}
          cy={CY}
          r={3}
          fill="var(--color-cf-text-muted)"
          opacity={0.55}
        />
        <text
          x={CX}
          y={CY + 26}
          textAnchor="middle"
          fontSize={12}
          letterSpacing={2.4}
          className="font-mono"
          fill="var(--color-cf-text-subtle)"
          style={{ textTransform: "uppercase", fontWeight: 500 }}
        >
          the agentic cycle
        </text>

        {/* Two orbiting comet dots — always on (loop appears at phase 2,
            the parent gates that with conditional render). */}
        <CometDot
          t={t}
          period={PERIOD}
          r={R}
          cx={CX}
          cy={CY}
          color="var(--color-cf-orange)"
          offset={0}
          trailCount={TRAIL_COUNT}
          trailSpacing={TRAIL_SPACING}
          reduce={reduce ?? false}
        />
        <CometDot
          t={t}
          period={PERIOD}
          r={R}
          cx={CX}
          cy={CY}
          color="var(--color-cf-info)"
          offset={PERIOD / 2}
          trailCount={TRAIL_COUNT}
          trailSpacing={TRAIL_SPACING}
          reduce={reduce ?? false}
        />
      </svg>
    </motion.div>
  );
}

function CometDot({
  t,
  period,
  r,
  cx,
  cy,
  color,
  offset,
  trailCount,
  trailSpacing,
  reduce,
}: {
  t: number;
  period: number;
  r: number;
  cx: number;
  cy: number;
  color: string;
  offset: number;
  trailCount: number;
  trailSpacing: number;
  reduce: boolean;
}) {
  const effectiveT = reduce ? offset : t + offset;
  const head = dotPosition(effectiveT, period, r);

  return (
    <g>
      {!reduce &&
        Array.from({ length: trailCount })
          .map((_, idx) => trailCount - idx)
          .map((step) => {
            const trailT = effectiveT - step * trailSpacing;
            const p = dotPosition(trailT, period, r);
            const fade = 1 - step / (trailCount + 1);
            const radius = 2 + (6 - 2) * fade;
            const opacity = 0.08 + 0.55 * fade;
            return (
              <circle
                key={step}
                cx={cx + p.x}
                cy={cy + p.y}
                r={radius}
                fill={color}
                opacity={opacity}
              />
            );
          })}

      <circle cx={cx + head.x} cy={cy + head.y} r={7} fill={color} />
      <circle
        cx={cx + head.x}
        cy={cy + head.y}
        r={13}
        fill="none"
        stroke={color}
        strokeOpacity={0.28}
        strokeWidth={1.2}
      />
    </g>
  );
}

export const whatIsAnAgentSlide: SlideDef = {
  id: "what-is-an-agent",
  title: "What is an AI agent?",
  sectionLabel: "Agents & MCP",
  sectionNumber: "01",
  layout: "default",
  // phase 0: title + eyebrow only
  // phase 1: three role cards reveal (staggered)
  // phase 2: loop fades in below + bridge-to-MCP callout
  phases: 2,
  render: ({ phase }) => (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 pt-1">
      {/* Eyebrow — uses full slide width */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: easeEntrance }}
        className="flex flex-wrap items-center gap-3"
      >
        <Tag tone="orange">Definition</Tag>
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-cf-text-subtle">
          A chatbot that can do things — not just say things.
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.1 }}
        className="text-[clamp(36px,4.6vw,68px)] font-medium leading-[1.0] tracking-[-0.035em] text-cf-text"
      >
        An <span className="text-cf-orange">agent</span> has three parts.
      </motion.h1>

      {/* PHASE 1 — three role cards in a single row.
          The motion gate `phase >= 1` means the cards start hidden;
          on the first ArrowRight they reveal staggered. */}
      <motion.div
        initial={false}
        animate={{ opacity: phase >= 1 ? 1 : 0 }}
        transition={{ duration: 0.5, ease: easeEntrance }}
        className="grid grid-cols-3 gap-6"
        aria-hidden={phase < 1}
      >
        <RoleCard
          role="brain"
          title="The brain"
          oneLiner="The model that decides what to do next."
          examples="GPT-5 · Claude · Llama · Gemini"
          icon={<Brain size={24} strokeWidth={1.6} />}
          accent={ACCENTS.brain}
          delay={phase >= 1 ? 0.05 : 0}
        />
        <RoleCard
          role="hands"
          title="The hands"
          oneLiner="Tools — the only way the model can touch the real world."
          examples="Read a file · Send a Slack · Hit an API · Sum two numbers"
          icon={<Wrench size={24} strokeWidth={1.6} />}
          accent={ACCENTS.hands}
          delay={phase >= 1 ? 0.18 : 0}
        />
        <RoleCard
          role="will"
          title="The will"
          oneLiner="A loop. Keep going until the goal is met — or it gives up."
          examples="Plan → Act → Observe → Plan → … → Done"
          icon={<RefreshCw size={24} strokeWidth={1.6} />}
          accent={ACCENTS.will}
          delay={phase >= 1 ? 0.31 : 0}
        />
      </motion.div>

      {/* PHASE 2 — loop appears on the row below, with orbiting dots
          already running. We reserve the slot in phase 1 so the cards
          don't shift down when the loop mounts. */}
      <div className="mt-2 flex justify-center">
        {phase >= 2 ? <AgentLoop /> : <div style={{ height: 380 }} aria-hidden />}
      </div>

      {/* Bridge callout — fades in alongside the loop. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{
          opacity: phase >= 2 ? 1 : 0,
          y: phase >= 2 ? 0 : 8,
        }}
        transition={{ duration: 0.45, ease: easeButton, delay: phase >= 2 ? 0.4 : 0 }}
        className="mx-auto -mt-2 max-w-[760px]"
        aria-hidden={phase < 2}
      >
        <div
          className="rounded-xl border-l-[3px] px-6 py-4"
          style={{
            borderLeftColor: "var(--color-cf-orange)",
            background: "var(--color-cf-orange-light)",
          }}
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-cf-orange">
            Bridge to next slide
          </span>
          <p className="mt-1 text-[clamp(15px,1.3vw,21px)] font-medium leading-snug tracking-[-0.015em] text-cf-text">
            Tools are how an agent acts in the world. The protocol for
            tools is <span className="text-cf-orange">MCP</span>.
          </p>
        </div>
      </motion.div>
    </div>
  ),
};
