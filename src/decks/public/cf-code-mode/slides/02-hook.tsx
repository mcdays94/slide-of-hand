import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { GiantNumber } from "../components/primitives/GiantNumber";
import { Tag } from "../components/primitives/Tag";
import { easeEntrance, easeButton } from "../lib/motion";

/**
 * 02 — The Hook.
 *
 * Big quote-style cover that lands the September 2025 Cloudflare blog
 * headline ("We've all been using MCP wrong.") and slams down the three
 * numbers from the Code Mode launch post:
 *
 *   2,594 API endpoints  ·  15 MCP servers  ·  1,069 tokens (Code Mode)
 *
 * Phase 1 reveals an orange callout banner under the stats — the
 * cliff-hanger that powers the rest of the deck:
 *
 *   "What if I told you the bottom number could replace the other two?"
 *
 * Composition:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  ┌─ Tag ─┐  September 2025 · blog.cloudflare.com/code-mode/      │
 *   │                                                                  │
 *   │      "We've all been using MCP wrong."                           │
 *   │                                                                  │
 *   │      — Kenton Varda & Sunil Pai · Cloudflare                     │
 *   │                                                                  │
 *   │   ┌── 2,594 ──┐  ┌── 15 ──┐  ┌── 1,069 ──┐                        │
 *   │   │ endpoints │  │ servers│  │ tokens    │                        │
 *   │   └───────────┘  └────────┘  └───────────┘                        │
 *   │                                                                  │
 *   │   ┃ orange callout banner (phase ≥ 1) ┃                           │
 *   │                                                                  │
 *   └──────────────────────────────────────────────────────────────────┘
 */

interface StatCardProps {
  value: number;
  label: string;
  sub: string;
  /** Stagger delay (s) — left-to-right cascade. */
  delay: number;
  /** True for the Code Mode stat — slight orange highlight. */
  highlight?: boolean;
}

function StatCard({ value, label, sub, delay, highlight = false }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: easeEntrance }}
      className="flex-1"
    >
      <div className="relative">
        <CornerBrackets>
          <div
            className={[
              "flex flex-col gap-3 rounded-2xl border bg-cf-bg-200 px-8 py-7",
              highlight
                ? "border-cf-orange-light"
                : "border-cf-border",
            ].join(" ")}
            style={
              highlight
                ? {
                    background:
                      "linear-gradient(180deg, var(--color-cf-orange-light) 0%, var(--color-cf-bg-200) 70%)",
                  }
                : undefined
            }
          >
            <GiantNumber
              value={value}
              duration={1.4}
              className="text-[clamp(56px,8vw,128px)]"
              color={
                highlight
                  ? "var(--color-cf-orange)"
                  : "var(--color-cf-text)"
              }
            />
            <div className="flex flex-col gap-1.5">
              <div className="text-[clamp(16px,1.4vw,22px)] font-medium leading-tight tracking-[-0.015em] text-cf-text">
                {label}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-muted">
                {sub}
              </div>
            </div>
          </div>
        </CornerBrackets>
      </div>
    </motion.div>
  );
}

export const hookSlide: SlideDef = {
  id: "hook",
  layout: "default",
  phases: 1,
  render: ({ phase }) => (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 pt-2">
      {/* Eyebrow tag */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: easeEntrance }}
        className="flex items-center gap-3"
      >
        <Tag tone="orange">The Hook</Tag>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
          September 2025 · blog.cloudflare.com/code-mode/
        </span>
      </motion.div>

      {/* Headline — the literal blog title */}
      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.1 }}
        className="text-[clamp(48px,7.4vw,116px)] font-medium leading-[0.98] tracking-[-0.04em] text-cf-text"
      >
        <span aria-hidden className="text-cf-orange">&ldquo;</span>
        We&rsquo;ve all been using <span className="text-cf-orange">MCP</span> wrong.
        <span aria-hidden className="text-cf-orange">&rdquo;</span>
      </motion.h1>

      {/* Credit line */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.35 }}
        className="-mt-4 flex items-center gap-3 font-mono text-[clamp(11px,1vw,14px)] uppercase tracking-[0.12em] text-cf-text-muted"
      >
        <span className="text-cf-text-subtle">—</span>
        <span>Kenton Varda &amp; Sunil Pai</span>
        <span className="text-cf-text-subtle">·</span>
        <span>Cloudflare</span>
      </motion.div>

      {/* Three giant stat cards — left-to-right stagger 0.12s */}
      <div className="mt-2 flex flex-col gap-5 lg:flex-row">
        <StatCard
          value={2594}
          label="API endpoints"
          sub="exposed via 15 MCP servers"
          delay={0.55}
        />
        <StatCard
          value={15}
          label="MCP servers"
          sub="connected to one agent"
          delay={0.67}
        />
        <StatCard
          value={1069}
          label="tokens"
          sub="one Code Mode round-trip"
          delay={0.79}
          highlight
        />
      </div>

      {/* Phase 1 — orange cliff-hanger callout. Reserve space so layout
          doesn't shift when it reveals. */}
      <motion.div
        animate={{
          opacity: phase >= 1 ? 1 : 0,
          y: phase >= 1 ? 0 : 8,
        }}
        initial={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.45, ease: easeButton }}
        className="mt-1"
        aria-hidden={phase < 1}
      >
        <div
          className="relative flex items-center gap-4 rounded-xl border-l-[3px] px-5 py-4"
          style={{
            borderLeftColor: "var(--color-cf-orange)",
            background: "var(--color-cf-orange-light)",
          }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange">
            Cliff-hanger
          </span>
          <span className="text-cf-text-subtle">·</span>
          <span className="text-[clamp(15px,1.45vw,22px)] font-medium leading-snug tracking-[-0.015em] text-cf-text">
            What if I told you the bottom number could replace the other two?
          </span>
        </div>
      </motion.div>
    </div>
  ),
};
