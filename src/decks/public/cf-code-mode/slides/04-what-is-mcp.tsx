import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Github,
  Slack,
  Kanban,
  Layers,
  CloudCog,
  Send,
  Sparkles,
} from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";
import { easeEntrance, easeButton } from "../lib/motion";

/**
 * Slide 04 — "What is MCP?" (rewritten as a moving picture).
 *
 * The previous fan-of-icons illustration was too static. This version
 * shows MCP IN ACTION: a ChatGPT-style chat window on the left, a
 * column of branded MCP server tiles on the right, and a 7-step
 * auto-playing animation where:
 *
 *   1. The user types a multi-step prompt.
 *   2. The assistant starts a thinking shimmer.
 *   3. It calls github.search_code() → GitHub tile glows, an
 *      orange flow-line draws from the chat to the tile and back.
 *   4. It calls slack.send_message() → Slack tile glows.
 *   5. It calls jira.create_ticket() → Jira tile glows.
 *   6. The assistant's final answer streams in.
 *   7. A "MCP = the protocol" caption settles at the bottom.
 *
 * The audience watches one whole prompt-to-answer cycle and walks
 * away knowing exactly what an MCP call looks like — no jargon, no
 * JSON, just chat → tool → answer.
 */

// ─── Animation timeline (seconds since slide mount) ───────────────────

const T_USER_TYPED = 0.6;
const T_THINKING = 1.6;
const T_GITHUB_CALL = 2.4;
const T_GITHUB_DONE = 3.5;
const T_SLACK_CALL = 4.0;
const T_SLACK_DONE = 5.1;
const T_JIRA_CALL = 5.6;
const T_JIRA_DONE = 6.7;
const T_FINAL_ANSWER = 7.2;
const T_FINAL_TAG = 8.6;
const T_LOOP_RESET = 12; // long enough to read the final answer

// ─── MCP server tile config ───────────────────────────────────────────

interface ServerSpec {
  id: "github" | "slack" | "jira" | "linear" | "cloudflare";
  label: string;
  /** Function name shown in the chat tool-call pill. */
  toolName: string;
  icon: ReactNode;
  /** Brand-ish accent. */
  accent: string;
  /** When this tile is called in the timeline (seconds). */
  callAt: number;
  /** When the tile call completes. */
  doneAt: number;
}

const ICON_PROPS = { size: 26, strokeWidth: 1.6 } as const;

const SERVERS: readonly ServerSpec[] = [
  {
    id: "github",
    label: "GitHub",
    toolName: "github.search_code",
    icon: <Github {...ICON_PROPS} />,
    accent: "#1a1a1a",
    callAt: T_GITHUB_CALL,
    doneAt: T_GITHUB_DONE,
  },
  {
    id: "slack",
    label: "Slack",
    toolName: "slack.post_message",
    icon: <Slack {...ICON_PROPS} />,
    accent: "#4A154B",
    callAt: T_SLACK_CALL,
    doneAt: T_SLACK_DONE,
  },
  {
    id: "jira",
    label: "Jira",
    toolName: "jira.create_ticket",
    icon: <Kanban {...ICON_PROPS} />,
    accent: "#0052CC",
    callAt: T_JIRA_CALL,
    doneAt: T_JIRA_DONE,
  },
  // Two more, never called in this scenario — there to make the point
  // that an agent typically has many MCP servers connected even when
  // a given prompt only needs a few.
  {
    id: "linear",
    label: "Linear",
    toolName: "linear.create_issue",
    icon: <Layers {...ICON_PROPS} />,
    accent: "#5E6AD2",
    callAt: -1,
    doneAt: -1,
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    toolName: "cloudflare.list_zones",
    icon: <CloudCog {...ICON_PROPS} color="#FF4801" />,
    accent: "#FF4801",
    callAt: -1,
    doneAt: -1,
  },
];

// ─── Hook: clock with optional loop ───────────────────────────────────

function useTimeline(loopAt: number) {
  const [t, setT] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      // Snap to the end-state so static viewers see the full payoff.
      setT(T_FINAL_TAG + 0.5);
      return;
    }
    if (typeof window === "undefined") return;
    let raf = 0;
    let start = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      if (elapsed >= loopAt) {
        // Reset for the next loop. The user can watch it twice if
        // they're hovering on this slide.
        start = now;
        setT(0);
      } else {
        setT(elapsed);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce, loopAt]);

  return t;
}

// ─── Chat UI ──────────────────────────────────────────────────────────

const USER_PROMPT =
  "Find the SQL injection bug in our payment service, post a heads-up in #engineering, and open a Jira ticket.";

const FINAL_ANSWER =
  "Found it — payment-service/charge.py:42 builds a query with string concat. I posted a heads-up in #engineering and opened JIRA-2491 (P1).";

function ChatWindow({ t }: { t: number }) {
  // Type-effect for the user prompt — chars revealed proportional to
  // (t / T_USER_TYPED). Capped at full string after T_USER_TYPED.
  const typedRatio = Math.min(1, t / T_USER_TYPED);
  const typedChars = Math.floor(typedRatio * USER_PROMPT.length);
  const userText = USER_PROMPT.slice(0, typedChars);
  const userDone = t >= T_USER_TYPED;

  // Final answer streams over 1.4s starting at T_FINAL_ANSWER.
  const answerRatio = Math.max(
    0,
    Math.min(1, (t - T_FINAL_ANSWER) / 1.4),
  );
  const answerChars = Math.floor(answerRatio * FINAL_ANSWER.length);
  const answerText = FINAL_ANSWER.slice(0, answerChars);

  const showThinking =
    t >= T_THINKING && t < T_FINAL_ANSWER;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-cf-border bg-cf-bg-100 shadow-[0_24px_48px_-32px_rgba(82,16,0,0.18)]">
      {/* Window chrome */}
      <div className="flex items-center justify-between border-b border-cf-border bg-cf-bg-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="block h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="block h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="block h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-cf-text-muted">
          <Sparkles size={12} strokeWidth={1.6} />
          <span>chat with claude</span>
        </div>
        <div className="w-12" />
      </div>

      {/* Messages — flex column with scrollable area */}
      <div className="relative flex-1 overflow-hidden px-6 py-5">
        <div className="flex flex-col gap-4">
          {/* User message */}
          <div className="flex justify-end">
            <div
              className="max-w-[78%] rounded-2xl rounded-br-md px-4 py-3 text-[clamp(13px,1.05vw,16px)] leading-snug text-cf-text"
              style={{
                background: "var(--color-cf-bg-200)",
                border: "1px solid var(--color-cf-border)",
              }}
            >
              {userText}
              {!userDone && (
                <motion.span
                  aria-hidden
                  className="ml-0.5 inline-block h-[0.95em] w-[2px] -translate-y-[2px] bg-cf-text"
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
                />
              )}
            </div>
          </div>

          {/* Assistant tool-call pills + final answer */}
          <div className="flex flex-col items-start gap-2">
            <AnimatePresence>
              {SERVERS.filter((s) => s.callAt > 0).map((s) => {
                const visible = t >= s.callAt;
                const inFlight = visible && t < s.doneAt;
                if (!visible) return null;
                return (
                  <motion.div
                    key={s.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: easeEntrance }}
                    className="flex items-center gap-2 rounded-full border border-cf-border bg-cf-bg-200 px-3 py-1.5 font-mono text-[12px] tracking-[0.01em] text-cf-text"
                  >
                    {/* Status dot — pulses while in flight, settles when done */}
                    <motion.span
                      className="block h-2 w-2 rounded-full"
                      style={{
                        background: inFlight
                          ? "var(--color-cf-orange)"
                          : "var(--color-cf-success)",
                      }}
                      animate={
                        inFlight
                          ? { opacity: [0.4, 1, 0.4] }
                          : { opacity: 1 }
                      }
                      transition={
                        inFlight
                          ? { duration: 0.8, repeat: Infinity, ease: "easeInOut" }
                          : { duration: 0 }
                      }
                    />
                    <span className="text-cf-text-muted">→</span>
                    <span style={{ color: s.accent }}>{s.toolName}</span>
                    <span className="text-cf-text-muted">()</span>
                    {!inFlight && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                        className="ml-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-cf-success)]"
                      >
                        ok
                      </motion.span>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {showThinking && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-cf-text-muted"
              >
                <ThinkingDots />
              </motion.div>
            )}

            {/* Final answer bubble */}
            {t >= T_FINAL_ANSWER && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: easeEntrance }}
                className="mt-1 max-w-[88%] rounded-2xl rounded-bl-md px-4 py-3 text-[clamp(13px,1.05vw,16px)] leading-snug text-cf-text"
                style={{
                  background: "var(--color-cf-bg-100)",
                  border: "1px solid var(--color-cf-border)",
                }}
              >
                {answerText}
                {answerRatio < 1 && (
                  <motion.span
                    aria-hidden
                    className="ml-0.5 inline-block h-[0.95em] w-[2px] -translate-y-[2px] bg-cf-orange"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{
                      duration: 0.7,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                  />
                )}
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Composer — purely decorative, shows the user "input" box */}
      <div className="flex items-center gap-3 border-t border-cf-border bg-cf-bg-200 px-4 py-3">
        <div className="flex-1 truncate rounded-xl border border-cf-border bg-cf-bg-100 px-3 py-2 font-mono text-[12px] text-cf-text-subtle">
          Ask anything…
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cf-orange text-cf-bg-100"
        >
          <Send size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 text-cf-orange">
      thinking
      <span className="ml-1.5 inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block h-1 w-1 rounded-full bg-cf-orange"
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
    </span>
  );
}

// ─── MCP server tile (right column) ───────────────────────────────────

function ServerTile({ spec, t }: { spec: ServerSpec; t: number }) {
  const calling =
    spec.callAt > 0 && t >= spec.callAt && t < spec.doneAt;
  const used = spec.callAt > 0 && t >= spec.doneAt;

  return (
    <CornerBrackets className="block">
      <motion.div
        animate={{
          borderColor: calling
            ? "var(--color-cf-orange)"
            : used
              ? `color-mix(in srgb, var(--color-cf-success) 50%, var(--color-cf-border))`
              : "var(--color-cf-border)",
          boxShadow: calling
            ? "0 0 0 3px color-mix(in srgb, var(--color-cf-orange) 20%, transparent), 0 18px 38px -22px var(--color-cf-orange)"
            : "0 0 0 0 rgba(0,0,0,0)",
        }}
        transition={{ duration: 0.35, ease: easeButton }}
        className="flex items-center gap-3 rounded-xl border bg-cf-bg-200 px-4 py-3"
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border"
          style={{
            color: spec.accent,
            background: calling
              ? "color-mix(in srgb, var(--color-cf-orange) 12%, var(--color-cf-bg-100))"
              : "var(--color-cf-bg-100)",
            borderColor: calling
              ? "var(--color-cf-orange)"
              : "var(--color-cf-border)",
          }}
        >
          {spec.icon}
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[clamp(14px,1.1vw,17px)] font-medium leading-tight tracking-[-0.01em] text-cf-text">
            {spec.label}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
            mcp · {spec.toolName.split(".")[1] ?? ""}
          </span>
        </div>
        {/* Status indicator on the right */}
        <span
          aria-hidden
          className="ml-auto block h-2 w-2 rounded-full"
          style={{
            background: calling
              ? "var(--color-cf-orange)"
              : used
                ? "var(--color-cf-success)"
                : "var(--color-cf-text-subtle)",
            opacity: calling ? 1 : used ? 0.85 : 0.35,
          }}
        />
      </motion.div>
    </CornerBrackets>
  );
}

// ─── Flow line (chat → server) ────────────────────────────────────────
//
// When a server is being called, an orange dashed line draws from the
// right edge of the chat window to the left edge of the matching tile.
// We render the lines as absolutely-positioned SVGs in an overlay layer
// that sits behind the chat / tile content.

function FlowLines({ t }: { t: number }) {
  // For each server with a positive callAt, decide whether the line is
  // visible right now. We don't need precise per-tile coordinates — we
  // render all lines in a fixed grid and use opacity / dasharray to
  // animate them.
  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      {SERVERS.map((s, i) => {
        if (s.callAt < 0) return null;
        const active = t >= s.callAt && t < s.doneAt + 0.4;
        // Vertical position of each tile inside the right column.
        // Tiles are stacked with gap-3 (12px); each tile is ~72px tall.
        const y = 18 + i * 86 + 36;
        return (
          <motion.svg
            key={s.id}
            className="absolute left-[var(--chat-right,55%)] top-0 h-full w-[200px]"
            initial={false}
            animate={{ opacity: active ? 1 : 0 }}
            transition={{ duration: 0.25, ease: easeButton }}
            preserveAspectRatio="none"
          >
            <motion.line
              x1="0"
              y1={y}
              x2="200"
              y2={y}
              stroke="var(--color-cf-orange)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: active ? 1 : 0 }}
              transition={{
                duration: 0.55,
                ease: easeEntrance,
              }}
            />
          </motion.svg>
        );
      })}
    </div>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────

function McpBody() {
  const t = useTimeline(T_LOOP_RESET);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col gap-4 pt-1">
      {/* Eyebrow */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: easeEntrance }}
        className="flex shrink-0 flex-wrap items-center gap-3"
      >
        <Tag tone="orange">MCP</Tag>
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-cf-text-subtle">
          Model Context Protocol · the agent's plug-and-play tool socket
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.08 }}
        className="shrink-0 text-[clamp(36px,4.6vw,68px)] font-medium leading-[1.0] tracking-[-0.035em] text-cf-text"
      >
        How does an agent use{" "}
        <span className="text-cf-orange">tools</span>?
      </motion.h2>

      {/* Sub-line — full slide width */}
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: easeEntrance, delay: 0.18 }}
        className="shrink-0 max-w-none text-[clamp(15px,1.25vw,20px)] leading-snug text-cf-text-muted"
      >
        Every modern AI assistant — ChatGPT, Claude, Gemini — speaks one
        protocol to talk to outside services. Watch a single prompt fan
        out across MCP servers, then come back as one answer.
      </motion.p>

      {/* Main canvas: chat window (left, ~58%) | servers column (right, ~42%) */}
      <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-8">
        <FlowLines t={t} />
        <div className="relative z-10 min-h-0">
          <ChatWindow t={t} />
        </div>
        <div className="relative z-10 flex min-h-0 flex-col gap-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-cf-text-subtle">
            <span className="block h-[1px] w-6 bg-cf-text-subtle/40" />
            connected MCP servers
          </div>
          {SERVERS.map((s) => (
            <ServerTile key={s.id} spec={s} t={t} />
          ))}
          <div className="mt-auto rounded-xl border border-cf-border bg-cf-bg-200 px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange">
              the protocol
            </div>
            <p className="mt-1 text-[clamp(13px,1.05vw,16px)] leading-snug text-cf-text">
              MCP is the <span className="font-medium">standard cable</span>{" "}
              between the model and every tool. One protocol, any vendor.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export const whatIsMcpSlide: SlideDef = {
  id: "what-is-mcp",
  title: "What is MCP?",
  layout: "default",
  sectionLabel: "Agents & MCP",
  sectionNumber: "01",
  phases: 0,
  render: () => <McpBody />,
};
