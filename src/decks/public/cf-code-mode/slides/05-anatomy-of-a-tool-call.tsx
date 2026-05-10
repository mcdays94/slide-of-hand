import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";
import { easeEntrance, easeButton } from "../lib/motion";
import {
  TOKENS_BY_PHASE,
  tokenJumpAtPhase,
  tokensAfterPhase,
  type AnatomyPhase,
} from "./_anatomy-tokens";

/**
 * 05 — Anatomy of a tool call.
 *
 * The slide that demystifies what "the LLM calls a tool" really means
 * under the hood. We reproduce the example from the Cloudflare blog post
 * (https://blog.cloudflare.com/code-mode/) inside an animated terminal.
 *
 * Phase reveals:
 *
 *   0  user prompt:                      > What's the weather in Austin, TX?
 *   1  LLM emits special tokens:         <|tool_call|> { name, arguments } <|end_tool_call|>
 *   2  harness fetches → result:         <|tool_result|> { temperature: 93 … } <|end_tool_result|>
 *   3  LLM speaks the answer:            "The weather in Austin, TX is currently sunny and 93°F."
 *
 * Right of the terminal, a token counter ticks up across phases. The
 * jump on phase 2 (the JSON result re-flowing back through the model)
 * is highlighted with a brief red flash — the moment the audience sees
 * the cost of a round-trip.
 *
 * `prefers-reduced-motion: reduce` is respected: every line snaps to
 * its end-state and the counter does not animate.
 */

// ───────────────────────────── content ────────────────────────────

interface Line {
  /** When this line should appear (matches the slide phase). */
  phase: AnatomyPhase;
  text: string;
  /**
   * Visual style. Drives colour and lets us put the audience's eye on
   * the special tokens.
   */
  kind:
    | "prompt" // user prompt (orange caret)
    | "special-token" // <|tool_call|> etc — orange brackets, bold
    | "json-key"
    | "json-value"
    | "json-bracket" // {, }, comma, etc.
    | "spinner" // "fetching real weather…"
    | "answer"; // final natural-language answer (white)
}

/**
 * Hand-classify every visible terminal line. Authoring this as data
 * (instead of a giant JSX block) lets us drive the per-line reveal
 * timing from a single useEffect with cleanup-able timeouts.
 */
const LINES: Line[] = [
  // ── Phase 0 ──
  { phase: 0, kind: "prompt", text: "> What's the weather in Austin, TX?" },

  // ── Phase 1 ── LLM emits a tool call
  { phase: 1, kind: "special-token", text: "<|tool_call|>" },
  { phase: 1, kind: "json-bracket", text: "{" },
  { phase: 1, kind: "json-key", text: '  "name": "get_current_weather",' },
  { phase: 1, kind: "json-key", text: '  "arguments": {' },
  { phase: 1, kind: "json-value", text: '    "location": "Austin, TX, USA"' },
  { phase: 1, kind: "json-bracket", text: "  }" },
  { phase: 1, kind: "json-bracket", text: "}" },
  { phase: 1, kind: "special-token", text: "<|end_tool_call|>" },

  // ── Phase 2 ── harness fetches, then result is fed BACK INTO the model
  { phase: 2, kind: "spinner", text: "fetching weather.cloudflare.com…" },
  { phase: 2, kind: "special-token", text: "<|tool_result|>" },
  { phase: 2, kind: "json-bracket", text: "{" },
  { phase: 2, kind: "json-key", text: '  "location": "Austin, TX, USA",' },
  { phase: 2, kind: "json-value", text: '  "temperature": 93,' },
  { phase: 2, kind: "json-value", text: '  "unit": "fahrenheit",' },
  { phase: 2, kind: "json-value", text: '  "conditions": "sunny"' },
  { phase: 2, kind: "json-bracket", text: "}" },
  { phase: 2, kind: "special-token", text: "<|end_tool_result|>" },

  // ── Phase 3 ── the answer
  {
    phase: 3,
    kind: "answer",
    text:
      "The weather in Austin, TX is currently sunny and 93°F. Bring sunglasses!",
  },
];

const KIND_COLOR: Record<Line["kind"], string> = {
  prompt: "var(--color-cf-orange)",
  "special-token": "var(--color-cf-orange)",
  "json-key": "rgba(207, 207, 207, 0.95)",
  "json-value": "#7AA7E5",
  "json-bracket": "rgba(207, 207, 207, 0.6)",
  // Was using a light-mode warm-brown muted token that rendered as
  // near-invisible dark red on the terminal's #0E0E0F background.
  // Bump to a warm amber/beige so it sits at the same legibility level
  // as the surrounding green/blue terminal text.
  spinner: "#E8C68A",
  answer: "#fff",
};

// ─────────────────────── reveal timing helper ─────────────────────

/**
 * Computes how many lines from the array should be visible at a given
 * `(phase, lineCursor)` state. Phases 0..2 cascade their lines on a
 * 90 ms cadence using the lineCursor (driven by useEffect timeouts);
 * phase 3 is just one line.
 */
function visibleCount(
  phase: number,
  cursor: Record<AnatomyPhase, number>,
): number {
  let count = 0;
  for (const ph of [0, 1, 2, 3] as AnatomyPhase[]) {
    if (phase < ph) break;
    const linesInPhase = LINES.filter((l) => l.phase === ph).length;
    const reveal = phase > ph ? linesInPhase : cursor[ph];
    count += reveal;
  }
  return count;
}

// ─────────────────────── token counter widget ──────────────────────

function TokenCounter({ phase }: { phase: number }) {
  const reduce = useReducedMotion();
  const total = tokensAfterPhase(Math.min(phase, 3) as AnatomyPhase);
  const jump = tokenJumpAtPhase(Math.min(phase, 3) as AnatomyPhase);
  const isJumpPhase = phase === 2; // the dramatic moment

  const [displayed, setDisplayed] = useState(total);
  const [flash, setFlash] = useState(false);

  // Tween the displayed counter towards `total` over ~600 ms so the
  // audience sees it tick up; in reduced-motion just snap.
  useEffect(() => {
    if (reduce) {
      setDisplayed(total);
      return;
    }
    const start = displayed;
    const delta = total - start;
    if (delta === 0) return;
    const dur = 600;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
      setDisplayed(Math.round(start + delta * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, reduce]);

  // Flash red on the dramatic phase-2 jump.
  useEffect(() => {
    if (!isJumpPhase || reduce) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(t);
  }, [isJumpPhase, reduce]);

  // Bar widths reference the final phase total.
  const max = TOKENS_BY_PHASE[3];

  return (
    <CornerBrackets className="flex w-full flex-col gap-4 rounded-2xl border border-cf-border bg-cf-bg-200 p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-muted">
          Tokens consumed
        </span>
        <Tag tone={isJumpPhase ? "error" : "muted"}>
          {phase === 0 && "prompt only"}
          {phase === 1 && "+ tool call"}
          {phase === 2 && "+ result re-fed"}
          {phase >= 3 && "+ answer"}
        </Tag>
      </div>

      <div className="relative">
        <motion.div
          aria-live="polite"
          animate={{
            color: flash ? "#FF4A4A" : "var(--color-cf-text)",
            scale: flash ? 1.04 : 1,
          }}
          transition={{ duration: 0.25, ease: easeButton }}
          className="font-medium leading-none tracking-[-0.04em]"
          style={{ fontSize: "clamp(56px, 7vw, 96px)" }}
        >
          {displayed}
        </motion.div>
        <AnimatePresence>
          {jump > 0 && (
            <motion.span
              key={`jump-${phase}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.35, ease: easeEntrance }}
              className="absolute right-0 top-1 font-mono text-[16px] font-medium uppercase tracking-[0.08em]"
              style={{ color: isJumpPhase ? "#FF4A4A" : "var(--color-cf-orange)" }}
            >
              +{jump}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Stacked bar — each phase contributes a coloured chunk so the
          relative cost of phase 2 is visible at a glance. */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-cf-bg-300">
        {([0, 1, 2, 3] as AnatomyPhase[]).map((p) => {
          const chunk = p === 0 ? TOKENS_BY_PHASE[0] : tokenJumpAtPhase(p);
          const widthPct = (chunk / max) * 100;
          const visible = phase >= p;
          const color =
            p === 2
              ? "#FF4A4A"
              : p === 3
                ? "var(--color-cf-orange)"
                : "rgba(82, 16, 0, 0.45)";
          return (
            <motion.div
              key={`bar-${p}`}
              initial={false}
              animate={{
                width: `${visible ? widthPct : 0}%`,
                opacity: visible ? 1 : 0,
              }}
              transition={{ duration: 0.45, ease: easeButton }}
              style={{ background: color }}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[clamp(15px,1.2vw,18px)] leading-[1.45] tracking-[-0.005em] text-cf-text-muted">
          Each phase's <span className="font-medium text-cf-text">JSON</span> is appended to the
          context — the model re-reads it all, every turn.
        </div>
      </div>
    </CornerBrackets>
  );
}

// ───────────────────────── annotation tag ──────────────────────────

function SpecialTokensAnnotation({ visible }: { visible: boolean }) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : -4 }}
      transition={{ duration: 0.4, ease: easeButton }}
      className="pointer-events-none mt-4 flex items-start gap-3"
      aria-hidden={!visible}
    >
      {/* Dashed leader line pointing back up at the orange tokens
          inside the terminal — keeps the visual link explicit. */}
      <span
        aria-hidden
        className="mt-3 flex-shrink-0"
        style={{
          width: 28,
          height: 0,
          borderTop: "1.5px dashed var(--color-cf-orange)",
        }}
      />
      <div
        className="rounded-xl border border-dashed bg-cf-orange-light px-5 py-4"
        style={{
          borderColor: "var(--color-cf-orange)",
          maxWidth: 560,
        }}
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-cf-orange">
          Special tokens
        </div>
        <p className="mt-2 text-[clamp(15px,1.2vw,18px)] leading-[1.5] tracking-[-0.005em] text-cf-text">
          A tiny vocabulary —{" "}
          <span className="font-mono font-medium text-cf-orange">
            &lt;|tool_call|&gt;
          </span>
          ,{" "}
          <span className="font-mono font-medium text-cf-orange">
            &lt;|end_tool_call|&gt;
          </span>
          ,{" "}
          <span className="font-mono font-medium text-cf-orange">
            &lt;|tool_result|&gt;
          </span>{" "}
          — the model uses to switch between{" "}
          <span className="font-medium text-cf-text">talking</span> and{" "}
          <span className="font-medium text-cf-text">calling</span>. Stitched in
          automatically by the model lab during fine-tuning; invisible to the
          user.
        </p>
      </div>
    </motion.div>
  );
}

// ─────────────────────── terminal body / lines ────────────────────

function TerminalBody({ phase }: { phase: number }) {
  const reduce = useReducedMotion();

  // Per-phase line cursors. Lines within a phase reveal on a 90 ms
  // cadence, except phase 2's spinner pause which gives the audience
  // a moment to read "fetching weather.cloudflare.com…" before the
  // JSON result floods in.
  const [cursor, setCursor] = useState<Record<AnatomyPhase, number>>({
    0: 0,
    1: 0,
    2: 0,
    3: 0,
  });

  // Group lines by phase for timing.
  const byPhase = useMemo(() => {
    const m: Record<AnatomyPhase, Line[]> = { 0: [], 1: [], 2: [], 3: [] };
    for (const l of LINES) m[l.phase].push(l);
    return m;
  }, []);

  // Drive line-by-line reveal whenever phase changes.
  useEffect(() => {
    if (reduce) {
      setCursor({
        0: byPhase[0].length,
        1: byPhase[1].length,
        2: byPhase[2].length,
        3: byPhase[3].length,
      });
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const queueReveal = (p: AnatomyPhase, baseDelay: number, gap: number) => {
      const linesInPhase = byPhase[p].length;
      // Reset cursor for this phase, then reveal one-by-one.
      setCursor((c) => ({ ...c, [p]: 0 }));
      for (let i = 0; i < linesInPhase; i++) {
        let extra = 0;
        // Phase 2: pause AFTER the spinner line (index 0) so it reads
        // as "we're fetching… then the result drops in".
        if (p === 2 && i >= 1) extra = 600;
        timers.push(
          setTimeout(
            () =>
              setCursor((c) =>
                c[p] >= i + 1 ? c : { ...c, [p]: i + 1 },
              ),
            baseDelay + i * gap + extra,
          ),
        );
      }
    };

    // Mark earlier phases as fully revealed; only animate the current.
    setCursor((c) => {
      const next = { ...c };
      for (const ph of [0, 1, 2, 3] as AnatomyPhase[]) {
        if (ph < phase) next[ph] = byPhase[ph].length;
      }
      return next;
    });
    if (phase >= 0 && phase <= 3) {
      queueReveal(phase as AnatomyPhase, 80, 90);
    }

    return () => timers.forEach(clearTimeout);
  }, [phase, byPhase, reduce]);

  const total = visibleCount(phase, cursor);

  return (
    <div
      className="cf-no-scrollbar flex flex-col gap-1 overflow-hidden font-mono"
      style={{ minHeight: 360 }}
    >
      {LINES.slice(0, total).map((line, i) => {
        const color = KIND_COLOR[line.kind];
        const isSpinner = line.kind === "spinner";
        const isLast = i === total - 1;
        return (
          <motion.div
            key={`anatomy-line-${i}`}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: easeButton }}
            className="flex items-baseline gap-2 leading-[1.55]"
            style={{
              fontSize: "clamp(13px, 1.1vw, 17px)",
              color,
              fontWeight: line.kind === "special-token" ? 600 : 400,
            }}
          >
            {isSpinner ? (
              <Spinner />
            ) : null}
            <span style={{ whiteSpace: "pre-wrap" }}>{line.text}</span>
            {isLast && phase >= 3 && line.kind === "answer" && (
              <span
                className="cf-caret ml-1 inline-block"
                style={{
                  width: "0.55em",
                  height: "1em",
                  background: "var(--color-cf-orange)",
                }}
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function Spinner() {
  // CSS-driven dot spinner — no extra deps. Uses border with one
  // accent-coloured side rotated forever.
  return (
    <span
      aria-hidden
      className="inline-block animate-spin"
      style={{
        width: 12,
        height: 12,
        border: "1.6px solid rgba(255,255,255,0.15)",
        borderTopColor: "var(--color-cf-orange)",
        borderRadius: "50%",
        // Slow, calm rotation; reduced-motion still spins but the user
        // mostly only sees it for ~600 ms before the result pops.
        animationDuration: "0.9s",
      }}
    />
  );
}

// ────────────────────── terminal window chrome ────────────────────

function TerminalChrome({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#0E0E0F] shadow-[0_18px_48px_rgba(0,0,0,0.18),0_4px_12px_rgba(0,0,0,0.12)]"
      data-no-advance
    >
      <div className="flex items-center gap-2 border-b border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
        <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
        <span className="h-3 w-3 rounded-full bg-[#28C840]" />
        <span className="flex-1 text-center font-mono text-xs tracking-[0.04em] text-[#888]">
          ~/agent — anatomy of a tool call
        </span>
        <span className="w-12" />
      </div>
      <div className="cf-no-scrollbar overflow-auto px-6 py-5">{children}</div>
    </div>
  );
}

// ───────────────────────────── slide ───────────────────────────────

function Body({ phase }: { phase: number }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col justify-center gap-5">
      {/* Eyebrow */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: easeEntrance }}
        className="flex items-center gap-3"
      >
        <Tag tone="orange">Section 01 · Agents &amp; MCP</Tag>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
          What an LLM "calls a tool" actually means
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.08 }}
        className="text-[clamp(36px,4.6vw,68px)] font-medium leading-[1.02] tracking-[-0.035em] text-cf-text"
      >
        Anatomy of a tool call.
      </motion.h2>

      {/* Two-column body: terminal + counter */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* LEFT — terminal */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: easeEntrance, delay: 0.18 }}
          className="relative"
        >
          <TerminalChrome>
            <TerminalBody phase={phase} />
          </TerminalChrome>

          {/* Annotation hugs the terminal at the bottom-left, only
              meaningful once the special tokens are on screen. */}
          <SpecialTokensAnnotation visible={phase >= 1} />
        </motion.div>

        {/* RIGHT — token counter + caption */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: easeEntrance, delay: 0.28 }}
          className="flex flex-col gap-4"
        >
          <TokenCounter phase={phase} />

          <div className="rounded-xl border border-cf-border bg-cf-bg-100 p-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-cf-text-muted">
              Read me
            </div>
            <p className="mt-2 text-[clamp(15px,1.25vw,19px)] leading-[1.5] tracking-[-0.005em] text-cf-text">
              Every tool result is{" "}
              <span className="font-medium text-cf-orange">re-fed back into the model</span>{" "}
              as input tokens. Add 15 servers and 2,594 endpoints and the bill
              gets ugly fast.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export const anatomyOfToolCallSlide: SlideDef = {
  id: "anatomy-of-a-tool-call",
  title: "Anatomy of a tool call.",
  sectionLabel: "Agents & MCP",
  sectionNumber: "01",
  layout: "default",
  phases: 3,
  render: ({ phase }) => <Body phase={phase} />,
};
