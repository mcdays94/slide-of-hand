import { useEffect, useState } from "react";
import { motion } from "framer-motion";
// useEffect/useState below are still used by the typewriter (the
// only animation that needs internal timing now that the rest of
// the diagram is phase-driven).
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance } from "../lib/motion";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";
import { SourceFooter, type Source } from "../components/primitives/SourceFooter";
import { Cite } from "../components/primitives/Cite";
import {
  Bot,
  User,
  Github,
  Zap,
  Quote,
  ArrowRight,
  ArrowLeft,
  Wrench,
  Loader2,
  Check,
} from "lucide-react";

/**
 * Slide 11. Cloudflare runs on this (Code Mode).
 *
 * Closes section 04 ("Why this matters") with the strongest possible
 * proof point: Cloudflare itself ships a product on top of the same
 * Worker Loader API the audience just watched live. The MCP gateway
 * and Agents SDK both use Code Mode: convert MCP tools into a
 * TypeScript API, ask the LLM to WRITE CODE, then spawn a fresh
 * Dynamic Worker for each snippet to run it in a sandbox.
 *
 * The slide leads with an animated three-panel mock-up showing a real
 * round-trip:
 *
 *   1. Agent receives a question.
 *   2. LLM writes TypeScript that calls a typed `codemode.*` method.
 *   3. Worker Loader spawns a fresh isolate and the snippet calls the
 *      GitHub MCP server through pre-authorized bindings.
 *   4. Result flows back to the agent and the assistant replies.
 *
 * The animation loops continuously once phase 1 is reached, so the
 * speaker can talk over it without manually advancing micro-states.
 *
 * Phases:
 *   0  Headline + subline.
 *   1  Animated three-panel mock-up of the Code Mode round-trip.
 *   2  Pull quote from the launch post + source footer.
 *
 * Sources are tracked numerically via `<Cite>` markers paired with the
 * `<SourceFooter>` at the bottom (deck-wide convention).
 */

export const codeModeSlide: SlideDef = {
  id: "code-mode",
  title: "Cloudflare runs on this",
  layout: "default",
  sectionLabel: "WHY THIS MATTERS",
  sectionNumber: "04",
  // Each animation stage is its own phase so the speaker advances the
  // diagram at their own pace. 8 phases total: headline (0), six
  // animation stages (1..6), then the pull quote (7).
  phases: 7,
  render: ({ phase }) => <CodeModeBody phase={phase} />,
};

const SOURCES: Source[] = [
  {
    n: 1,
    label: "Cloudflare blog · Code Mode launch (Varda & Pai, 2025)",
    href: "https://blog.cloudflare.com/code-mode/",
  },
  {
    n: 2,
    label: "Agents SDK · Code Mode reference",
    href: "https://developers.cloudflare.com/agents/api-reference/codemode/",
  },
  {
    n: 3,
    label: "Cloudflare One · MCP server portals (code mode)",
    href: "https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/#code-mode",
  },
  {
    n: 4,
    label: "Worker Loader API",
    href: "https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/",
  },
  {
    n: 5,
    label: "Cloudflare Agents SDK overview",
    href: "https://developers.cloudflare.com/agents/",
  },
  {
    n: 6,
    label: "Model Context Protocol specification",
    href: "https://modelcontextprotocol.io/docs/getting-started/intro",
  },
];

function CodeModeBody({ phase }: { phase: number }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1340px] flex-col">
      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance }}
      >
        <Tag tone="orange">04 · Cloudflare runs on this</Tag>
        <h2 className="mt-4 max-w-5xl text-4xl leading-[1.05] tracking-[-0.035em] text-cf-text sm:text-[44px]">
          Cloudflare ships a product on top of{" "}
          <span className="text-cf-orange">env.LOADER.load(…)</span>.
        </h2>
        <p className="mt-2.5 max-w-3xl text-base leading-relaxed text-cf-text-muted sm:text-[17px]">
          Our MCP gateway runs <strong className="text-cf-text">Code Mode</strong>
          <Cite n={1} href={SOURCES[0].href} />. When an AI agent connects
          through Cloudflare, every line of code it writes runs in a brand-new
          Dynamic Worker isolate
          <Cite n={2} href={SOURCES[1].href} />. Same Worker Loader API
          <Cite n={4} href={SOURCES[3].href} />, same ~5 ms spawn. Shipping in
          production today
          <Cite n={3} href={SOURCES[2].href} />.
        </p>
      </motion.div>

      {/* Animated three-panel mock-up. Visible from phase 1 onward;
          its internal stage is driven directly by `phase`, so each
          arrow press / click advances one beat of the round-trip. */}
      <motion.div
        className="mt-6"
        initial={{ opacity: 0, y: 12 }}
        animate={{
          opacity: phase >= FIRST_ANIMATION_PHASE ? 1 : 0,
          y: phase >= FIRST_ANIMATION_PHASE ? 0 : 12,
        }}
        transition={{ duration: 0.5, ease: easeEntrance }}
      >
        <CodeModeAnimation phase={phase} />
      </motion.div>

      {/* Pull quote slot — wrapped in a flex-1 column that vertically
          centres its child between the animated diagram above and the
          source footer below. The motion.div inside still controls the
          fade-in, but the layout slot is reserved from the start so the
          source footer never moves. Reveals at phase PULL_QUOTE_PHASE
          (7), one click after the animation finishes. */}
      <div className="flex flex-1 flex-col justify-center py-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{
            opacity: phase >= PULL_QUOTE_PHASE ? 1 : 0,
            y: phase >= PULL_QUOTE_PHASE ? 0 : 12,
          }}
          transition={{ duration: 0.5, ease: easeEntrance }}
        >
          <PullQuote />
        </motion.div>
      </div>

      {/* Sources footer — always visible. Citation is a reference, not
          a reveal. Anchored to the bottom of the slide via SourceFooter's
          internal `mt-auto`; the flex-1 slot above has already eaten the
          available space, so this just sits flush at the bottom. */}
      <SourceFooter sources={SOURCES} />
    </div>
  );
}

/* ─── Pull quote ─── */

function PullQuote() {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[auto_1fr]">
      <div className="hidden lg:flex lg:items-start lg:pt-1">
        <Quote
          strokeWidth={1.5}
          className="h-8 w-8 text-cf-orange opacity-80"
        />
      </div>
      <blockquote className="border-l-2 border-cf-orange/40 pl-4">
        <p className="text-lg leading-relaxed text-cf-text sm:text-xl">
          “LLMs have seen a lot of code. They have{" "}
          <span className="text-cf-orange">not</span> seen a lot of tool calls.”
        </p>
        <footer className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cf-text-subtle">
          Kenton Varda · Cloudflare · Code Mode launch · 2025-09-26
          <Cite n={1} href={SOURCES[0].href} />
        </footer>
      </blockquote>
    </div>
  );
}

/* ─── Animation stages, driven by slide phase ─── */

/**
 * The diagram walks through six sequential stages — but the speaker
 * advances them MANUALLY using the deck's normal phase trigger
 * (right-arrow / click). There is no auto-advance and no internal
 * timer; each stage corresponds to one slide phase.
 *
 * Phase mapping:
 *
 *   phase 0   nothing — headline + sources only
 *   phase 1   ask     user message slides into the chat panel
 *   phase 2   write   LLM types TypeScript; chat→code arrow active
 *   phase 3   spawn   Worker rectangle pulses; code→worker arrow active
 *   phase 4   call    binding-line packet travels DOWN, MCP lights up
 *   phase 5   return  binding-line packet travels UP, stdout fills,
 *                     worker→code and code→chat return arrows active
 *   phase 6   answer  assistant reply settles in, both tool calls ✓
 *   phase 7   pull quote appears
 *
 * Going BACK with left-arrow walks the diagram backwards too — the
 * Typewriter resets to "empty" on phase 1, the assistant reply hides
 * before phase 6, etc. So the speaker can step forward and backward
 * during a live talk without anything getting visually stuck.
 */
type Stage = "ask" | "write" | "spawn" | "call" | "return" | "answer";

const STAGES_BY_PHASE: readonly Stage[] = [
  "ask", // phase 1
  "write", // phase 2
  "spawn", // phase 3
  "call", // phase 4
  "return", // phase 5
  "answer", // phase 6+
] as const;

/** First phase at which the animation is visible. */
const FIRST_ANIMATION_PHASE = 1;
/** Last phase that maps to a distinct animation stage. */
const FINAL_ANIMATION_PHASE = STAGES_BY_PHASE.length; // 6
/** Phase at which the pull quote reveals. */
const PULL_QUOTE_PHASE = FINAL_ANIMATION_PHASE + 1; // 7

function phaseToStage(phase: number): Stage {
  if (phase < FIRST_ANIMATION_PHASE) return "ask";
  return STAGES_BY_PHASE[
    Math.min(phase - FIRST_ANIMATION_PHASE, STAGES_BY_PHASE.length - 1)
  ];
}

/** TypeScript shown in the code panel during the "write" stage. The
 *  LLM's program ends with a `console.log` so the audience can see
 *  what gets piped back through stdout. In Code Mode, console output
 *  is exactly what flows back to the agent — making the stdout panel
 *  on stage a faithful mirror of the runtime. */
const TYPEWRITER_CODE = `// LLM writes:
const docs = await codemode
  .search_agents_docs({
    query: "Worker Loader",
  });
console.log(docs.results.length);`;

/** Output that appears in the stdout strip once the worker finishes.
 *  This is the literal value `console.log` would have written, fed
 *  back to the LLM as the program's result. */
const STDOUT_VALUE = "12";

/** The MCP tool call the worker's snippet ends up making, in two
 *  parts: the request the worker sends, and the response that comes
 *  back. Rendered inside the MCP server box so the audience watches
 *  the actual tool invocation, not just an abstract "MCP call". */
const TOOL_CALL = {
  fn: "search_agents_docs",
  args: { query: "Worker Loader" },
  result: { count: 12 },
} as const;

/** Final assistant reply after the round-trip completes. */
const USER_QUESTION =
  'How many docs in cloudflare/agents mention "Worker Loader"?';
const ASSISTANT_REPLY =
  "Found 12 matching docs. The Worker Loader binding is documented in the Agents SDK and the Cloudflare One MCP portal pages.";

/**
 * Per-stage activity tables. Pulled out so the panel + connector
 * components can stay declarative and the choreography is in one place.
 */
const PANEL_ACTIVE = {
  chat: (s: Stage) => s === "ask" || s === "answer",
  code: (s: Stage) => s === "write" || s === "return",
  worker: (s: Stage) => s === "spawn" || s === "call" || s === "return",
  mcp: (s: Stage) => s === "call" || s === "return",
} as const;

/** Forward connector arrows (left → right). */
const FWD_ACTIVE = {
  chatToCode: (s: Stage) => s === "write",
  codeToWorker: (s: Stage) => s === "spawn" || s === "call",
} as const;

/** Return connector arrows (right → left). Both fire together during
 *  the single "return" stage so the audience reads "the result is
 *  flowing all the way back to the user" as a single beat. They go
 *  quiet at the "answer" stage so the slide truly settles once the
 *  cycle completes — no packets cycling forever in the background. */
const BACK_ACTIVE = {
  workerToCode: (s: Stage) => s === "return",
  codeToChat: (s: Stage) => s === "return",
} as const;

function CodeModeAnimation({ phase }: { phase: number }) {
  // Stage is computed directly from the slide's phase number. No
  // setTimeout, no internal state machine — the deck framework owns
  // pacing and the speaker drives it from arrow / click.
  const stage = phaseToStage(phase);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
      <ChatPanel stage={stage} />
      <Connector
        forwardActive={FWD_ACTIVE.chatToCode(stage)}
        backActive={BACK_ACTIVE.codeToChat(stage)}
        forwardLabel="prompt"
        backLabel="answer"
      />
      <CodePanel stage={stage} />
      <Connector
        forwardActive={FWD_ACTIVE.codeToWorker(stage)}
        backActive={BACK_ACTIVE.workerToCode(stage)}
        forwardLabel="env.LOADER.load(…)"
        backLabel="stdout"
      />
      <WorkerMcpPanel stage={stage} />
    </div>
  );
}

/* ─── Connector between panels ─── */

/**
 * Bidirectional connector between two panels: a forward arrow on top
 * (left → right) and a return arrow on the bottom (right → left). Both
 * are always present so the round-trip nature of the flow reads even
 * when nothing is active; only the "active" one glows orange and
 * shows a travelling packet.
 *
 * This is what tells the audience "the worker doesn't just receive a
 * call, it also sends a result back." Without the return arrow, the
 * earlier diagram only showed one half of the round-trip.
 */
function Connector({
  forwardActive,
  backActive,
  forwardLabel,
  backLabel,
}: {
  forwardActive: boolean;
  backActive: boolean;
  forwardLabel: string;
  backLabel: string;
}) {
  return (
    <div
      className="hidden flex-col items-center justify-center gap-3 px-1 lg:flex"
      aria-hidden
    >
      <ArrowRow
        direction="forward"
        active={forwardActive}
        label={forwardLabel}
      />
      <ArrowRow direction="back" active={backActive} label={backLabel} />
    </div>
  );
}

function ArrowRow({
  direction,
  active,
  label,
}: {
  direction: "forward" | "back";
  active: boolean;
  label: string;
}) {
  const ArrowGlyph = direction === "forward" ? ArrowRight : ArrowLeft;
  const lineColor = active
    ? "var(--color-cf-orange)"
    : "color-mix(in srgb, var(--color-cf-border) 80%, transparent)";
  const labelColor = active
    ? "var(--color-cf-orange)"
    : "var(--color-cf-text-subtle)";

  // Forward arrow: label on top. Back arrow: label on bottom.
  // This keeps the two arrows symmetrical around the gap between them
  // and makes "what's flowing where" unambiguous.
  return (
    <div className="flex flex-col items-center gap-0.5">
      {direction === "forward" && (
        <span
          className="font-mono text-[9px] uppercase tracking-[0.12em] transition-colors duration-300"
          style={{ color: labelColor }}
        >
          {label}
        </span>
      )}
      <div className="flex items-center gap-0.5">
        {direction === "back" && (
          <ArrowGlyph
            strokeWidth={1.6}
            className="h-4 w-4 transition-colors duration-300"
            style={{ color: labelColor }}
          />
        )}
        <div className="relative flex h-px w-12 items-center">
          <div
            className="absolute inset-0 transition-colors duration-300"
            style={{ background: lineColor }}
          />
          {active && (
            <motion.span
              key={`${direction}-${active}`}
              className="absolute h-1.5 w-1.5 rounded-full bg-cf-orange"
              initial={{
                left: direction === "forward" ? "0%" : "100%",
                opacity: 0,
              }}
              animate={{
                left:
                  direction === "forward"
                    ? ["0%", "100%"]
                    : ["100%", "0%"],
                opacity: [0, 1, 0],
              }}
              transition={{
                duration: 0.9,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              style={{ top: "-2px" }}
            />
          )}
        </div>
        {direction === "forward" && (
          <ArrowGlyph
            strokeWidth={1.6}
            className="h-4 w-4 transition-colors duration-300"
            style={{ color: labelColor }}
          />
        )}
      </div>
      {direction === "back" && (
        <span
          className="font-mono text-[9px] uppercase tracking-[0.12em] transition-colors duration-300"
          style={{ color: labelColor }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/* ─── Chat panel ─── */

function ChatPanel({ stage }: { stage: Stage }) {
  const showReply = stage === "answer";
  const isActive = PANEL_ACTIVE.chat(stage);

  return (
    <PanelShell
      kicker="01 · AGENT"
      label="Chat"
      icon={<Bot strokeWidth={1.6} className="h-4 w-4" />}
      active={isActive}
    >
      <div className="flex min-h-[210px] flex-col gap-2.5">
        {/* User bubble. Slides in once on mount (when phase 1 starts).
            Stays visible for the whole cycle. */}
        <motion.div
          className="flex items-start gap-2"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: easeEntrance }}
        >
          <Avatar tone="muted">
            <User strokeWidth={1.6} className="h-3.5 w-3.5" />
          </Avatar>
          <div className="flex-1 rounded-md rounded-tl-none bg-cf-bg-200 px-3 py-2 text-[12px] leading-snug text-cf-text">
            {USER_QUESTION}
          </div>
        </motion.div>

        {/* Tool-call section. The Cloudflare MCP gateway in
            `?codemode=search_and_execute` mode exposes exactly two
            tools to the agent — `search` (look up which codemode.*
            methods exist) and `execute` (ship the JS that runs in a
            Dynamic Worker). This panel makes those calls explicit
            from the agent's POV, the way OpenCode / Claude / Cursor
            UIs render tool use. The chips appear once the LLM has
            decided to use Code Mode (start of "write"); search
            resolves immediately, execute keeps a spinner until the
            round-trip is complete at "answer". */}
        <ToolCallSection stage={stage} />

        {/* Assistant bubble. Renders typing dots until the round-trip
            completes; once `stage === "answer"` is reached, the dots
            dissolve into the actual reply string. */}
        <motion.div
          className="flex items-start gap-2"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.35,
            ease: easeEntrance,
            delay: 0.2,
          }}
        >
          <Avatar tone="orange">
            <Bot strokeWidth={1.6} className="h-3.5 w-3.5" />
          </Avatar>
          <div className="flex-1 rounded-md rounded-tl-none border border-cf-orange/25 bg-cf-orange-light/60 px-3 py-2 text-[12px] leading-snug text-cf-text">
            {showReply ? (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
              >
                {ASSISTANT_REPLY}
              </motion.span>
            ) : (
              <TypingDots />
            )}
          </div>
        </motion.div>
      </div>
    </PanelShell>
  );
}

/**
 * The two tool calls that any Code Mode round-trip makes against the
 * Cloudflare MCP gateway, rendered as small "tool use" chips:
 *
 *   - `search` resolves quickly with the list of available
 *     `codemode.*` methods (the gateway returns matching tool
 *     signatures so the LLM can write valid code against them).
 *   - `execute` is the one that triggers the Dynamic Worker spawn:
 *     the LLM hands it a JS string, the gateway runs it, console.log
 *     output flows back as the tool result.
 *
 * Visibility / state:
 *   - hidden during "ask"
 *   - both chips visible from "write" onward
 *   - search is always shown as ✓ (it resolves before "write" begins)
 *   - execute spins through write/spawn/call/return, becomes ✓ at
 *     "answer" — no animation continues past the final stage
 */
function ToolCallSection({ stage }: { stage: Stage }) {
  const visible = stage !== "ask";
  const executeStatus: "running" | "done" =
    stage === "answer" ? "done" : "running";

  return (
    <motion.div
      className="flex flex-col gap-1.5 pl-8"
      initial={{ opacity: 0, y: 4 }}
      animate={{
        opacity: visible ? 1 : 0,
        y: visible ? 0 : 4,
      }}
      transition={{ duration: 0.35, ease: easeEntrance }}
    >
      <ToolChip name="search" hint='"Worker Loader"' status="done" />
      <ToolChip name="execute" hint="code" status={executeStatus} />
    </motion.div>
  );
}

function ToolChip({
  name,
  hint,
  status,
}: {
  name: string;
  hint?: string;
  status: "running" | "done";
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-cf-border bg-cf-bg-200 px-2 py-1 font-mono text-[10px] leading-tight"
    >
      <Wrench
        size={10}
        strokeWidth={1.6}
        className="shrink-0 text-cf-text-subtle"
      />
      <span className="text-cf-text-muted">tool</span>
      <span className="text-cf-text-subtle">·</span>
      <span className="font-medium text-cf-text">{name}</span>
      {hint && (
        <span className="truncate text-cf-text-subtle">({hint})</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1 text-cf-orange">
        {status === "running" ? (
          <>
            <Loader2
              size={10}
              strokeWidth={2.2}
              className="animate-spin"
            />
            <span>running…</span>
          </>
        ) : (
          <>
            <Check size={10} strokeWidth={2.4} />
            <span>done</span>
          </>
        )}
      </span>
    </div>
  );
}

function Avatar({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "orange" | "muted";
}) {
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
      style={{
        background:
          tone === "orange"
            ? "color-mix(in srgb, var(--color-cf-orange) 14%, transparent)"
            : "var(--color-cf-bg-200)",
        borderColor:
          tone === "orange"
            ? "color-mix(in srgb, var(--color-cf-orange) 40%, transparent)"
            : "var(--color-cf-border)",
        color:
          tone === "orange"
            ? "var(--color-cf-orange)"
            : "var(--color-cf-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-cf-orange/60"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: 1.0,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.18,
          }}
        />
      ))}
    </span>
  );
}

/* ─── Code panel ─── */

function CodePanel({ stage }: { stage: Stage }) {
  // Map global stage to code-block reveal state. The code stays on
  // screen once typed — there's no resetting back to empty mid-cycle.
  const codeState: "empty" | "typing" | "complete" =
    stage === "ask"
      ? "empty"
      : stage === "write"
        ? "typing"
        : "complete";

  // stdout fills in once the worker has finished its round-trip and
  // returned a value. That timing matches "return" stage where data
  // is flowing back from the worker to the LLM.
  const showStdout = stage === "return" || stage === "answer";

  return (
    <PanelShell
      kicker="02 · LLM WRITES"
      label="codemode"
      icon={<TypeScriptGlyph />}
      active={PANEL_ACTIVE.code(stage)}
    >
      <div
        className="flex flex-col gap-2.5 rounded-md p-3 font-mono text-[11px] leading-relaxed"
        style={{
          backgroundColor: "#1c1b19",
          color: "#fffbf5",
          border:
            "1px solid color-mix(in srgb, var(--color-cf-orange) 22%, #2a2825)",
          boxShadow:
            "0 0 0 1px rgba(255, 72, 1, 0.06), inset 0 1px 0 0 rgba(255, 251, 245, 0.04)",
          minHeight: "210px",
        }}
      >
        <Typewriter code={TYPEWRITER_CODE} state={codeState} />
        {/* Inline caption that names the highlighted `codemode` token
            for what it is: a typed TypeScript API generated from the
            MCP tool definitions. Pairs with the orange pill + dashed
            underline applied to `codemode` in <RenderLine> so the eye
            lands on token, then on caption. Visible from the moment
            the typewriter starts. */}
        <ApiHint visible={codeState !== "empty"} />
        {/* stdout strip — same dark background as the source above so
            the box reads as a single "execution context": code on top,
            output below. The slot is reserved from the start (motion
            opacity rather than mount/unmount) so adding the stdout
            line doesn't shift the code's vertical position. */}
        <StdoutStrip active={showStdout} value={STDOUT_VALUE} />
      </div>
    </PanelShell>
  );
}

/**
 * Calls out the `codemode` token in the source as the "typed
 * TypeScript API" — paired with the orange pill + dashed underline in
 * <RenderLine>. A subtle italic strip beneath the code, no box
 * chrome, so it reads as commentary on the source above rather than a
 * separate panel competing for attention.
 *
 * The wording is deliberately plain-English so non-coder audiences
 * can land on what they're looking at: "this thing the LLM is
 * calling is a typed API."
 */
function ApiHint({ visible }: { visible: boolean }) {
  return (
    <motion.div
      className="flex items-baseline gap-2 px-1 font-mono text-[10px] leading-tight"
      initial={{ opacity: 0, y: 4 }}
      animate={{
        opacity: visible ? 1 : 0,
        y: visible ? 0 : 4,
      }}
      transition={{ duration: 0.4, ease: easeEntrance }}
    >
      <span
        className="rounded-sm px-1 font-semibold"
        style={{
          color: "var(--color-cf-orange)",
          background:
            "color-mix(in srgb, var(--color-cf-orange) 18%, transparent)",
        }}
      >
        codemode
      </span>
      <span className="italic" style={{ color: "#a89578" }}>
        a typed TypeScript API · generated from the MCP tools
      </span>
    </motion.div>
  );
}

function StdoutStrip({ active, value }: { active: boolean; value: string }) {
  return (
    <div
      className="mt-auto pt-2"
      style={{
        borderTop: "1px solid #2a2825",
      }}
    >
      <div
        className="font-mono text-[9px] uppercase tracking-[0.18em]"
        style={{ color: "#7a6f60" }}
      >
        stdout
      </div>
      <motion.div
        className="mt-1 font-mono text-[13px] leading-tight"
        style={{ color: "#fffbf5" }}
        initial={{ opacity: 0, y: 4 }}
        animate={{
          opacity: active ? 1 : 0,
          y: active ? 0 : 4,
        }}
        transition={{ duration: 0.4, ease: easeEntrance }}
      >
        <span style={{ color: "#7a6f60" }}>$ </span>
        {value}
      </motion.div>
    </div>
  );
}

function TypeScriptGlyph() {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-sm font-mono text-[8px] font-bold tracking-tight text-cf-bg-100"
      style={{ backgroundColor: "var(--color-cf-orange)" }}
    >
      TS
    </span>
  );
}

function Typewriter({
  code,
  state,
}: {
  code: string;
  state: "empty" | "typing" | "complete";
}) {
  const [chars, setChars] = useState(0);

  useEffect(() => {
    if (state === "empty") {
      setChars(0);
      return;
    }
    if (state === "complete") {
      setChars(code.length);
      return;
    }
    // Typing: from 0 to full length over the stage duration.
    setChars(0);
    const stepMs = 26;
    const id = window.setInterval(() => {
      setChars((c) => {
        if (c >= code.length) {
          window.clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, stepMs);
    return () => window.clearInterval(id);
  }, [state, code.length]);

  // Render with a tiny bit of inline tinting so the code reads as
  // syntax-highlighted without needing the full Prism pipeline. Comment
  // line gets the deck's muted comment colour, `codemode` gets the
  // orange-keyword treatment, strings get the cream string colour.
  return (
    <pre className="m-0 whitespace-pre-wrap break-words bg-transparent p-0">
      {code.slice(0, chars).split("\n").map((line, i, arr) => (
        <span key={i}>
          <RenderLine line={line} />
          {i < arr.length - 1 && "\n"}
        </span>
      ))}
      {/* Cursor blinks only while actively typing. After the code is
          fully written, the cursor disappears so the slide stops
          looping any animation once the cycle settles at "answer". */}
      {state === "typing" && (
        <motion.span
          className="ml-0.5 inline-block h-[1em] w-[2px] align-middle"
          style={{ backgroundColor: "#fffbf5" }}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      )}
    </pre>
  );
}

/**
 * Tiny ad-hoc syntax tinter. Doesn't try to be Prism. It picks out the
 * three patterns that matter on stage:
 *
 *   - leading `//` comments  → muted brown
 *   - the `codemode` identifier → brand orange
 *   - quoted strings → sandy cream
 *
 * Everything else is plain warm cream (the panel's body colour).
 */
function RenderLine({ line }: { line: string }) {
  if (line.trimStart().startsWith("//")) {
    return <span style={{ color: "#7a6f60", fontStyle: "italic" }}>{line}</span>;
  }
  // Split into segments preserving order: codemode, strings, rest.
  // The `codemode` token gets `highlight: true` so it can render with
  // an orange-tinted pill instead of plain coloured text — this is the
  // visual cue that pairs with the "typed TypeScript API" caption below
  // the source code, calling out exactly which token IS the API.
  const tokens: Array<{ text: string; color?: string; highlight?: boolean }> =
    [];
  let i = 0;
  while (i < line.length) {
    if (line.startsWith("codemode", i)) {
      tokens.push({ text: "codemode", color: "#ff7849", highlight: true });
      i += "codemode".length;
      continue;
    }
    if (line[i] === '"') {
      const end = line.indexOf('"', i + 1);
      if (end !== -1) {
        tokens.push({ text: line.slice(i, end + 1), color: "#fde9b8" });
        i = end + 1;
        continue;
      }
    }
    if (line.startsWith("const ", i) || line.startsWith("return ", i) || line.startsWith("await ", i)) {
      const word = line.startsWith("const ", i)
        ? "const"
        : line.startsWith("return ", i)
          ? "return"
          : "await";
      tokens.push({ text: word, color: "#ff7849" });
      i += word.length;
      continue;
    }
    // Default: walk forward to the next interesting boundary.
    let next = i + 1;
    while (
      next < line.length &&
      !line.startsWith("codemode", next) &&
      line[next] !== '"' &&
      !line.startsWith("const ", next) &&
      !line.startsWith("return ", next) &&
      !line.startsWith("await ", next)
    ) {
      next++;
    }
    tokens.push({ text: line.slice(i, next) });
    i = next;
  }
  return (
    <>
      {tokens.map((t, k) => {
        if (t.highlight && t.color) {
          return (
            <span
              key={k}
              className="rounded-sm px-1"
              style={{
                color: t.color,
                background:
                  "color-mix(in srgb, var(--color-cf-orange) 18%, transparent)",
                borderBottom: "1px dashed var(--color-cf-orange)",
              }}
            >
              {t.text}
            </span>
          );
        }
        if (t.color) {
          return (
            <span key={k} style={{ color: t.color }}>
              {t.text}
            </span>
          );
        }
        return <span key={k}>{t.text}</span>;
      })}
    </>
  );
}

/* ─── Worker + MCP panel ─── */

function WorkerMcpPanel({ stage }: { stage: Stage }) {
  const workerActive = PANEL_ACTIVE.worker(stage);
  const mcpActive = PANEL_ACTIVE.mcp(stage);
  // Binding-line direction: outbound during "call", inbound during
  // "return". Both light the line up; only the packet's direction
  // differs, which is what tells the audience whether data is going
  // out to MCP or coming back from it.
  const bindingDown = stage === "call";
  const bindingUp = stage === "return";
  const bindingActive = bindingDown || bindingUp;
  // Strong perimeter pulse only at the spawn beat; once the cycle
  // moves past spawn the worker stays orange-bordered but no longer
  // pulses, so the eye can move on to the MCP exchange without a
  // pulse competing for attention.
  const showPulse = stage === "spawn";

  return (
    <PanelShell
      kicker="03 · DYNAMIC WORKER"
      label="env.LOADER"
      icon={<Zap strokeWidth={1.7} className="h-4 w-4" />}
      active={workerActive}
    >
      <div className="flex min-h-[210px] flex-col items-stretch justify-between gap-2.5">
        {/* Worker box */}
        <div className="relative">
          {showPulse && (
            <>
              <PerimeterPulse delay={0} />
              <PerimeterPulse delay={0.6} />
            </>
          )}
          <div
            className="relative z-10 flex items-center gap-2.5 rounded-md border bg-cf-bg-100 px-3 py-2.5"
            style={{
              borderColor: workerActive
                ? "color-mix(in srgb, var(--color-cf-orange) 50%, transparent)"
                : "var(--color-cf-border)",
              boxShadow: workerActive
                ? "0 0 0 1px color-mix(in srgb, var(--color-cf-orange) 25%, transparent), 0 0 18px 0 rgba(255, 72, 1, 0.22)"
                : "none",
            }}
          >
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md"
              style={{
                background:
                  "color-mix(in srgb, var(--color-cf-orange) 16%, transparent)",
                color: "var(--color-cf-orange)",
              }}
            >
              <Zap size={14} strokeWidth={1.6} />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cf-orange">
                Dynamic Worker
              </span>
              <span className="font-mono text-[11px] tracking-[-0.01em] text-cf-text">
                iso_4f3a91c8
              </span>
            </div>
          </div>
        </div>

        {/* Vertical binding line. Packet travels DOWN when the worker
            is calling MCP, UP when MCP returns the result. The line
            colour stays orange across both stages so the eye reads it
            as one active connection. */}
        <div className="flex flex-col items-center gap-0.5">
          <div className="relative h-7 w-px">
            <div
              className="absolute inset-0 transition-colors duration-300"
              style={{
                background: bindingActive
                  ? "var(--color-cf-orange)"
                  : "color-mix(in srgb, var(--color-cf-border) 80%, transparent)",
              }}
            />
            {bindingDown && (
              <motion.span
                key="binding-down"
                className="absolute h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cf-orange"
                style={{ left: "50%" }}
                initial={{ top: "0%", opacity: 0 }}
                animate={{ top: ["0%", "100%"], opacity: [0, 1, 0] }}
                transition={{
                  duration: 0.9,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            )}
            {bindingUp && (
              <motion.span
                key="binding-up"
                className="absolute h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cf-orange"
                style={{ left: "50%" }}
                initial={{ top: "100%", opacity: 0 }}
                animate={{ top: ["100%", "0%"], opacity: [0, 1, 0] }}
                transition={{
                  duration: 0.9,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            )}
          </div>
          <span
            className="font-mono text-[9px] uppercase tracking-[0.14em]"
            style={{
              color: bindingActive
                ? "var(--color-cf-orange)"
                : "var(--color-cf-text-subtle)",
            }}
          >
            codemode binding
          </span>
        </div>

        {/* MCP server box. Header row stays static (icon + URL); the
            tool-call log underneath fills in across stages so the
            audience watches the literal RPC happen — invocation
            appears at "call", response appears at "return". */}
        <div
          className="flex flex-col gap-2 rounded-md border bg-cf-bg-100 px-3 py-2.5 transition-shadow duration-300"
          style={{
            borderColor: mcpActive
              ? "color-mix(in srgb, var(--color-cf-orange) 45%, transparent)"
              : "var(--color-cf-border)",
            boxShadow: mcpActive
              ? "0 0 0 1px color-mix(in srgb, var(--color-cf-orange) 22%, transparent), 0 0 16px 0 rgba(255, 72, 1, 0.20)"
              : "none",
          }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border"
              style={{
                background: "var(--color-cf-bg-200)",
                borderColor: "var(--color-cf-border)",
                color: "var(--color-cf-text)",
              }}
            >
              <Github size={14} strokeWidth={1.6} />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cf-text-muted">
                MCP server
              </span>
              <span className="font-mono text-[11px] tracking-[-0.01em] text-cf-text">
                gitmcp.io/cloudflare/agents
              </span>
            </div>
          </div>
          <ToolCallLog stage={stage} />
        </div>
      </div>
    </PanelShell>
  );
}

/**
 * Renders the actual tool invocation + response inside the MCP server
 * box. Two motion lines: a "→" line that types in during the "call"
 * stage and stays, and a "←" line that types in during "return".
 *
 * Layout slot is reserved from the start (motion opacity, not
 * conditional mount) so the MCP server box stays the same height
 * across all stages and nothing shifts.
 */
function ToolCallLog({ stage }: { stage: Stage }) {
  const showCall =
    stage === "call" || stage === "return" || stage === "answer";
  const showResponse = stage === "return" || stage === "answer";

  return (
    <div
      className="flex flex-col gap-1 pt-2 font-mono text-[10.5px] leading-snug"
      style={{ borderTop: "1px solid var(--color-cf-border)" }}
    >
      {/* Outbound call: → search_agents_docs({ query: "Worker Loader" }) */}
      <motion.div
        className="flex items-baseline gap-1.5"
        initial={{ opacity: 0, x: -4 }}
        animate={{
          opacity: showCall ? 1 : 0,
          x: showCall ? 0 : -4,
        }}
        transition={{ duration: 0.4, ease: easeEntrance }}
      >
        <span className="font-bold text-cf-orange">→</span>
        <span className="break-all">
          <span className="text-cf-text">{TOOL_CALL.fn}</span>
          <span className="text-cf-text-muted">{`({ `}</span>
          <span className="text-cf-text-muted">query: </span>
          <span className="text-cf-text">{`"${TOOL_CALL.args.query}"`}</span>
          <span className="text-cf-text-muted">{` })`}</span>
        </span>
      </motion.div>

      {/* Response: ← { count: 12 } */}
      <motion.div
        className="flex items-baseline gap-1.5"
        initial={{ opacity: 0, x: 4 }}
        animate={{
          opacity: showResponse ? 1 : 0,
          x: showResponse ? 0 : 4,
        }}
        transition={{
          duration: 0.4,
          ease: easeEntrance,
          delay: showResponse ? 0.15 : 0,
        }}
      >
        <span className="font-bold text-cf-orange">←</span>
        <span>
          <span className="text-cf-text-muted">{`{ `}</span>
          <span className="text-cf-text-muted">count: </span>
          <span className="text-cf-text">{TOOL_CALL.result.count}</span>
          <span className="text-cf-text-muted">{` }`}</span>
        </span>
      </motion.div>
    </div>
  );
}

/**
 * Single perimeter pulse ring. Identical pattern to the one on the
 * Dynamic Worker badge in slide 06: shares the parent's bounding box
 * via `inset: 0` and animates `scale` outward.
 */
function PerimeterPulse({ delay }: { delay: number }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 rounded-md"
      style={{
        border: "1.4px solid var(--color-cf-orange)",
        transformOrigin: "center center",
      }}
      initial={{ scale: 1, opacity: 0 }}
      animate={{
        scale: [1, 1.18, 1.32],
        opacity: [0, 0.55, 0],
      }}
      transition={{
        duration: 1.2,
        repeat: Infinity,
        ease: "easeOut",
        delay,
      }}
      aria-hidden
    />
  );
}

/* ─── Reusable panel shell ─── */

function PanelShell({
  kicker,
  label,
  icon,
  active,
  children,
}: {
  kicker: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <CornerBrackets
      className="cf-card relative flex flex-col overflow-hidden p-0 transition-all duration-300"
      inset={-3}
      style={{
        borderColor: active
          ? "color-mix(in srgb, var(--color-cf-orange) 38%, var(--color-cf-border))"
          : "var(--color-cf-border)",
        boxShadow: active
          ? "0 0 0 1px color-mix(in srgb, var(--color-cf-orange) 18%, transparent), 0 14px 32px -24px var(--color-cf-orange)"
          : "0 8px 22px -20px rgba(82, 16, 0, 0.18)",
      }}
    >
      <div
        className="h-1 w-full transition-opacity duration-300"
        style={{
          background:
            "linear-gradient(to right, var(--color-cf-orange), color-mix(in srgb, var(--color-cf-orange) 40%, transparent))",
          opacity: active ? 1 : 0.3,
        }}
        aria-hidden
      />
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span
          className="font-mono text-[10px] uppercase tracking-[0.18em] transition-colors duration-300"
          style={{
            color: active
              ? "var(--color-cf-orange)"
              : "var(--color-cf-text-muted)",
          }}
        >
          {kicker}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[-0.01em] text-cf-text-subtle">
          {icon}
          {label}
        </span>
      </div>
      <div className="flex-1 px-4 pb-4">{children}</div>
    </CornerBrackets>
  );
}
