import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { easeEntrance } from "../../lib/motion";
import { CornerBrackets } from "../../components/primitives/CornerBrackets";

/**
 * IsolateLifecycleViz — the animated isolate-card on the right side of
 * slide 08. The audience watches an isolate's full lifecycle play out
 * in front of them: empty → loading → running → result → disposed (or
 * failed).
 *
 * Deep module:
 *   - Public interface: state + meta + counter + recentIds.
 *   - Owns the animation, the status colours, the dot pulse, the
 *     recent-isolates ribbon, the lifecycle timeline visualisation.
 *   - Caller never has to know about Framer Motion, easings, or the
 *     CSS classes that drive each state.
 */

export type LifecycleState =
  | "idle"
  | "loading"
  | "running"
  | "result"
  | "disposed"
  | "failed";

export interface IsolateMeta {
  id?: string;
  elapsedMs?: number;
  memoryKb?: number;
  errorMessage?: string;
  /** Optional secondary label shown beneath the id (e.g. snippet name). */
  label?: string;
}

export interface IsolateLifecycleVizProps {
  state: LifecycleState;
  meta?: IsolateMeta;
  /** Total isolates spawned in the current session. */
  counter: number;
  /** Most-recent N isolate ids (newest first), for the recent-ids ribbon. */
  recentIds?: string[];
  className?: string;
}

interface StateVisual {
  label: string;
  ringClass: string;
  dotClass: string;
  pulse: boolean;
  textClass?: string;
}

const STATE_VISUALS: Record<LifecycleState, StateVisual> = {
  idle: {
    label: "Awaiting spawn",
    ringClass: "border-cf-border",
    dotClass: "bg-cf-text-subtle",
    pulse: true,
  },
  loading: {
    label: "Loading code into V8 isolate…",
    ringClass: "border-cf-orange",
    dotClass: "bg-cf-orange",
    pulse: true,
    textClass: "text-cf-orange",
  },
  running: {
    label: "Executing…",
    ringClass: "border-cf-orange",
    dotClass: "bg-cf-orange",
    pulse: true,
    textClass: "text-cf-orange",
  },
  result: {
    label: "Result returned",
    ringClass: "border-emerald-300",
    dotClass: "bg-emerald-500",
    pulse: false,
    textClass: "text-emerald-700",
  },
  disposed: {
    label: "Isolate disposed",
    ringClass: "border-cf-border",
    dotClass: "bg-cf-text-subtle",
    pulse: false,
  },
  failed: {
    label: "Failed",
    ringClass: "border-red-300",
    dotClass: "bg-red-500",
    pulse: false,
    textClass: "text-red-700",
  },
};

const TIMELINE_ORDER: LifecycleState[] = [
  "idle",
  "loading",
  "running",
  "result",
  "disposed",
];

export function IsolateLifecycleViz({
  state,
  meta,
  counter,
  recentIds = [],
  className = "",
}: IsolateLifecycleVizProps) {
  const visual = STATE_VISUALS[state];
  const isFailed = state === "failed";

  // Track the timestamp at which we entered the current state, for the
  // small live elapsed-time pulse during loading/running.
  const enteredAtRef = useRef<number>(performance.now());
  const [liveMs, setLiveMs] = useState(0);
  useEffect(() => {
    enteredAtRef.current = performance.now();
    setLiveMs(0);
    if (state !== "loading" && state !== "running") return;
    let frame = 0;
    function tick() {
      setLiveMs(Math.round(performance.now() - enteredAtRef.current));
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  return (
    <div
      className={`flex flex-col gap-5 ${className}`}
      data-testid="isolate-lifecycle-viz"
      aria-live="polite"
    >
      {/* Big isolate card */}
      <CornerBrackets className="cf-card relative p-6" inset={-3}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cf-text-muted">
              Isolate
            </span>
            <motion.div
              className={`inline-flex items-center gap-2.5 rounded-full border ${visual.ringClass} bg-cf-bg-200 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${visual.textClass ?? "text-cf-text"}`}
              key={state}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: easeEntrance }}
              data-testid="lifecycle-status-pill"
              data-state={state}
            >
              <motion.span
                className={`h-2 w-2 rounded-full ${visual.dotClass}`}
                animate={
                  visual.pulse
                    ? { scale: [1, 1.6, 1], opacity: [0.55, 1, 0.55] }
                    : { scale: 1, opacity: 1 }
                }
                transition={
                  visual.pulse
                    ? { duration: 1.0, repeat: Infinity, ease: "easeInOut" }
                    : { duration: 0.2 }
                }
              />
              <span>{visual.label}</span>
            </motion.div>
          </div>

          {/* Big id + meta block */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline gap-3">
              <span
                className={`font-mono text-2xl tracking-[-0.01em] ${
                  isFailed ? "text-red-700" : "text-cf-text"
                }`}
                data-testid="isolate-id"
              >
                {meta?.id ?? "—"}
              </span>
              {meta?.label && (
                <span className="text-xs text-cf-text-muted">{meta.label}</span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <MetaPill label="elapsed">
                {state === "loading" || state === "running"
                  ? `${liveMs} ms`
                  : meta?.elapsedMs != null
                    ? `${meta.elapsedMs} ms`
                    : "—"}
              </MetaPill>
              <MetaPill label="mem">
                {meta?.memoryKb != null ? `${meta.memoryKb} kB` : "—"}
              </MetaPill>
              <MetaPill label="state">{state}</MetaPill>
            </div>

            {isFailed && meta?.errorMessage && (
              <div className="mt-1 rounded-md border border-red-200 bg-red-50 p-3 font-mono text-[11px] leading-relaxed text-red-700">
                {meta.errorMessage}
              </div>
            )}
          </div>

          {/* Lifecycle timeline */}
          <div className="mt-1 flex items-center gap-2">
            {TIMELINE_ORDER.map((s, i) => {
              const reached = isReached(state, s);
              const isCurrent = state === s;
              return (
                <div key={s} className="flex flex-1 items-center gap-2">
                  <span
                    className={[
                      "h-1.5 w-1.5 rounded-full transition-colors",
                      reached ? "bg-cf-orange" : "bg-cf-border",
                      isCurrent && state !== "result" && state !== "disposed"
                        ? "ring-2 ring-cf-orange/30"
                        : "",
                    ].join(" ")}
                    aria-current={isCurrent ? "step" : undefined}
                  />
                  {i < TIMELINE_ORDER.length - 1 && (
                    <span
                      className={`h-px flex-1 ${reached ? "bg-cf-orange/60" : "bg-cf-border"}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CornerBrackets>

      {/* Counter */}
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cf-text-muted">
          Isolates spawned this session
        </span>
        <span
          className="font-mono text-2xl tabular-nums text-cf-orange"
          data-testid="isolate-counter"
        >
          {String(counter).padStart(3, "0")}
        </span>
      </div>

      {/* Recent ids ribbon */}
      <div className="min-h-[28px]">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.ul
            key={recentIds.join(",")}
            className="flex flex-wrap gap-2"
            data-testid="recent-isolates"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {recentIds.slice(0, 5).map((id, i) => (
              <motion.li
                key={id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1 - i * 0.18, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.3, ease: easeEntrance }}
                className="rounded-md border border-cf-border bg-cf-bg-200 px-2 py-1 font-mono text-[10px] tracking-[0.04em] text-cf-text-muted"
              >
                {id}
              </motion.li>
            ))}
          </motion.ul>
        </AnimatePresence>
      </div>
    </div>
  );
}

function MetaPill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-cf-border bg-cf-bg-200 px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] text-cf-text">
      <span className="text-cf-text-subtle uppercase">{label}</span>
      <span className="tabular-nums">{children}</span>
    </span>
  );
}

/**
 * Has the lifecycle progressed AT LEAST as far as the given step?
 * Used for the timeline rail rendering.
 */
function isReached(current: LifecycleState, target: LifecycleState): boolean {
  if (current === "failed") {
    // Failed slides past `loading`; show the rail filled up to where it
    // got, but not all the way through.
    return target === "idle" || target === "loading";
  }
  return TIMELINE_ORDER.indexOf(current) >= TIMELINE_ORDER.indexOf(target);
}
