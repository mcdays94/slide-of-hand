import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Send, Zap, X, Check } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";
import { easeEntrance, easeButton } from "../lib/motion";

/**
 * 13c — Dynamic Workers, live.
 *
 * A visual, non-coder-friendly demo of what a Dynamic Worker actually
 * IS. The audience sees three independent code requests come in, each
 * spawning a fresh V8 isolate that runs the snippet in a millisecond
 * and is then thrown away. Three points the slide must land:
 *
 *   1. Every snippet gets a NEW sandbox — no shared state.
 *   2. Spin-up is so fast it feels instant.
 *   3. The sandbox is gone after the snippet runs — perfect for
 *      ephemeral, untrusted code.
 *
 * The animation auto-plays on a ~10s loop.
 */

// ─── Timeline ─────────────────────────────────────────────────────────

const T_REQ_1 = 0.6;
const T_RUN_1 = 1.6;
const T_DONE_1 = 2.6;
const T_DISPOSE_1 = 3.4;

const T_REQ_2 = 1.2;
const T_RUN_2 = 2.2;
const T_DONE_2 = 3.4;
const T_DISPOSE_2 = 4.2;

const T_REQ_3 = 2.0;
const T_RUN_3 = 3.0;
const T_DONE_3 = 4.2;
const T_DISPOSE_3 = 5.0;

const T_LOOP_RESET = 7.5;

// ─── Sandbox demo entries ─────────────────────────────────────────────

interface DemoRequest {
  id: string;
  /** Code that "arrives" at the worker. */
  snippet: string;
  /** What the snippet returns. */
  result: string;
  /** Timeline anchor times. */
  reqAt: number;
  runAt: number;
  doneAt: number;
  disposeAt: number;
  /** Accent colour for this lane. */
  accent: string;
}

const REQUESTS: readonly DemoRequest[] = [
  {
    id: "lane-1",
    snippet: "fetchInvoice(42).then(toPdf)",
    result: "invoice-42.pdf",
    reqAt: T_REQ_1,
    runAt: T_RUN_1,
    doneAt: T_DONE_1,
    disposeAt: T_DISPOSE_1,
    accent: "var(--color-cf-orange)",
  },
  {
    id: "lane-2",
    snippet: "summarise(slack.lastMessages(20))",
    result: "summary.txt",
    reqAt: T_REQ_2,
    runAt: T_RUN_2,
    doneAt: T_DONE_2,
    disposeAt: T_DISPOSE_2,
    accent: "#0A95FF",
  },
  {
    id: "lane-3",
    snippet: "thumbnail(image, 320)",
    result: "thumb.webp",
    reqAt: T_REQ_3,
    runAt: T_RUN_3,
    doneAt: T_DONE_3,
    disposeAt: T_DISPOSE_3,
    accent: "var(--color-cf-success)",
  },
];

// ─── Hook: looping clock ──────────────────────────────────────────────

function useTimeline(loopAt: number) {
  const [t, setT] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      setT(loopAt - 0.1);
      return;
    }
    if (typeof window === "undefined") return;
    let raf = 0;
    let start = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      if (elapsed >= loopAt) {
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

// ─── Sandbox lane ─────────────────────────────────────────────────────

function SandboxLane({ req, t }: { req: DemoRequest; t: number }) {
  const reqVisible = t >= req.reqAt;
  const sandboxAlive = t >= req.runAt && t < req.disposeAt;
  const running = t >= req.runAt && t < req.doneAt;
  const finished = t >= req.doneAt && t < req.disposeAt;
  const resultVisible = t >= req.doneAt;

  // How "complete" the run is, 0-1, just for the progress fill.
  const runProgress = Math.max(
    0,
    Math.min(1, (t - req.runAt) / (req.doneAt - req.runAt)),
  );

  return (
    <div className="flex items-center gap-4">
      {/* INCOMING REQUEST — fades in from left, then disappears once
          the sandbox absorbs it. */}
      <motion.div
        initial={false}
        animate={{
          opacity: reqVisible && t < req.runAt ? 1 : 0,
          x: reqVisible && t < req.runAt ? 0 : -16,
        }}
        transition={{ duration: 0.35, ease: easeEntrance }}
        className="flex w-[260px] shrink-0 items-center gap-2 rounded-lg border border-cf-border bg-cf-bg-200 px-3 py-2 font-mono text-[12px]"
      >
        <Send size={14} strokeWidth={1.8} className="shrink-0 text-cf-orange" />
        <code className="truncate text-cf-text">{req.snippet}</code>
      </motion.div>

      {/* SANDBOX — appears mid-lane, runs, then disposes. */}
      <div className="relative flex-1">
        <AnimatePresence>
          {sandboxAlive && (
            <motion.div
              key={req.id + "-sandbox"}
              initial={{ opacity: 0, scale: 0.7, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{
                opacity: 0,
                scale: 0.7,
                y: -10,
                transition: { duration: 0.4, ease: easeButton },
              }}
              transition={{ duration: 0.35, ease: easeEntrance }}
              className="relative"
            >
              <CornerBrackets>
                <div
                  className="flex items-center gap-3 rounded-xl border bg-cf-bg-100 px-4 py-2.5"
                  style={{
                    borderColor: req.accent,
                    boxShadow: running
                      ? `0 0 0 3px color-mix(in srgb, ${req.accent} 20%, transparent), 0 14px 32px -22px ${req.accent}`
                      : "0 0 0 0 rgba(0,0,0,0)",
                  }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: `color-mix(in srgb, ${req.accent} 14%, var(--color-cf-bg-200))`,
                      color: req.accent,
                    }}
                  >
                    <Zap size={18} strokeWidth={1.8} />
                  </span>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                      <span style={{ color: req.accent }}>v8 isolate</span>
                      <span className="text-cf-text-subtle">·</span>
                      <span className="text-cf-text-muted">
                        {running ? "running" : finished ? "done" : "spawning"}
                      </span>
                    </div>
                    <div
                      className="h-1.5 w-[160px] overflow-hidden rounded-full"
                      style={{ background: "var(--color-cf-bg-200)" }}
                    >
                      <motion.div
                        className="h-full"
                        style={{ background: req.accent }}
                        animate={{ width: `${runProgress * 100}%` }}
                        transition={{ duration: 0.1, ease: "linear" }}
                      />
                    </div>
                  </div>
                </div>
              </CornerBrackets>

              {/* "Disposing…" splash on phase 4 of this lane */}
              {finished && (
                <motion.span
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, ease: easeEntrance }}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border bg-cf-bg-100"
                  style={{ borderColor: req.accent }}
                >
                  <Check size={12} strokeWidth={2.4} style={{ color: req.accent }} />
                </motion.span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* "Disposed" placeholder ghost — small × icon that briefly
            shows the moment the isolate vanishes, reinforcing the
            "throw it away" narrative. */}
        <AnimatePresence>
          {!sandboxAlive && t >= req.disposeAt && t < req.disposeAt + 0.6 && (
            <motion.div
              key={req.id + "-ghost"}
              initial={{ opacity: 0, scale: 1 }}
              animate={{ opacity: 0.6, scale: 1.2 }}
              exit={{ opacity: 0, scale: 1.4 }}
              transition={{ duration: 0.5, ease: easeEntrance }}
              className="absolute left-0 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle"
            >
              <X size={14} strokeWidth={1.6} className="inline" />{" "}
              isolate disposed
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* RESULT — fades in once sandbox finishes; persists until reset. */}
      <motion.div
        initial={false}
        animate={{
          opacity: resultVisible ? 1 : 0,
          x: resultVisible ? 0 : 16,
        }}
        transition={{ duration: 0.4, ease: easeEntrance }}
        className="flex w-[200px] shrink-0 items-center gap-2 rounded-lg border bg-cf-bg-200 px-3 py-2 font-mono text-[12px]"
        style={{ borderColor: req.accent }}
      >
        <span
          className="block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: req.accent }}
        />
        <code className="truncate text-cf-text">{req.result}</code>
      </motion.div>
    </div>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────

function DemoBody() {
  const t = useTimeline(T_LOOP_RESET);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-5 pt-2">
      {/* Eyebrow */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: easeEntrance }}
        className="flex flex-wrap items-center gap-3"
      >
        <Tag tone="orange">Live</Tag>
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-cf-text-subtle">
          A new sandbox per request · spin-up in milliseconds · gone the
          moment it&rsquo;s done
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.08 }}
        className="text-[clamp(36px,4.6vw,68px)] font-medium leading-[1.0] tracking-[-0.035em] text-cf-text"
      >
        Dynamic Workers,{" "}
        <span className="text-cf-orange">in motion</span>.
      </motion.h2>

      {/* Description — full width */}
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: easeEntrance, delay: 0.18 }}
        className="text-[clamp(15px,1.25vw,20px)] leading-snug text-cf-text-muted"
      >
        Three different snippets arrive at the same Worker. Each one gets
        its own freshly-spawned V8 isolate, runs in isolation, returns,
        and is thrown away. Same recipe, three sandboxes, no shared
        state. That&rsquo;s the engine that powers Code Mode.
      </motion.p>

      {/* Header row — column labels for the three lanes */}
      <div className="grid grid-cols-[260px_1fr_200px] items-center gap-4 border-b border-cf-border pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
          1 · code arrives
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
          2 · fresh v8 isolate spins up & runs
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
          3 · result returned
        </span>
      </div>

      {/* Three lanes */}
      <div className="flex flex-col gap-5">
        {REQUESTS.map((req) => (
          <SandboxLane key={req.id} req={req} t={t} />
        ))}
      </div>

      {/* Bottom callout — the takeaway numbers */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.4 }}
        className="mt-auto grid grid-cols-3 gap-4"
      >
        <Stat
          number="5–15 ms"
          label="Cold-start, per isolate"
          accent="var(--color-cf-orange)"
        />
        <Stat
          number="100s/sec"
          label="Isolates an edge can spawn concurrently"
          accent="var(--color-cf-info)"
        />
        <Stat
          number="zero"
          label="Shared state between requests"
          accent="var(--color-cf-success)"
        />
      </motion.div>
    </div>
  );
}

function Stat({
  number,
  label,
  accent,
}: {
  number: string;
  label: string;
  accent: string;
}) {
  return (
    <CornerBrackets className="block">
      <div className="rounded-xl border border-cf-border bg-cf-bg-200 px-5 py-3">
        <div
          className="text-[clamp(22px,2vw,32px)] font-medium leading-none tracking-[-0.02em]"
          style={{ color: accent }}
        >
          {number}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-muted">
          {label}
        </div>
      </div>
    </CornerBrackets>
  );
}

export const dynamicWorkerDemoSlide: SlideDef = {
  id: "dynamic-worker-demo",
  title: "Dynamic Workers, in motion.",
  layout: "default",
  sectionLabel: "The foundation",
  sectionNumber: "06",
  phases: 0,
  render: () => <DemoBody />,
};
