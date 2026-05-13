import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, RotateCcw, Repeat, Wifi, WifiOff } from "lucide-react";
import { CornerBrackets } from "../../components/primitives/CornerBrackets";
import { easeButton, easeEntrance, buttonInteraction } from "../../lib/motion";
import type { DemoModel, DemoPrompt, RunEvent } from "../../lib/run-events";
import { initialColumnState, reduceColumn } from "./state";
import type { ColumnState } from "./state";
import { selectMode } from "./health";
import type { DemoMode } from "./health";
import { findRecordedRun } from "./recorded";
import type { RecordedRun } from "./recorded";
import { streamRun } from "./sse-client";
import {
  formatTokens,
  formatLatency,
  formatCost,
  computeWinner,
} from "./format";
import { estimateCost } from "./pricing";
import { useCountUp } from "./useCountUp";

/* ────────────────────────────────────────────────────────────────────
 *  Reducer wrapper for both columns
 * ──────────────────────────────────────────────────────────────────── */

interface DemoState {
  mcp: ColumnState;
  codeMode: ColumnState;
}

type DemoAction =
  | { type: "reset" }
  | { type: "event"; mode: "mcp" | "code-mode"; event: RunEvent };

function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "reset":
      return { mcp: initialColumnState(), codeMode: initialColumnState() };
    case "event":
      if (action.mode === "mcp") {
        return { ...state, mcp: reduceColumn(state.mcp, action.event) };
      }
      return { ...state, codeMode: reduceColumn(state.codeMode, action.event) };
  }
}

/* ────────────────────────────────────────────────────────────────────
 *  Recorded-run player
 * ──────────────────────────────────────────────────────────────────── */

interface RecordedPlayerHandle {
  cancel(): void;
}

function playRecorded(
  run: RecordedRun,
  delayMs: number,
  dispatch: (a: DemoAction) => void,
): RecordedPlayerHandle {
  let cancelled = false;
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  const playSide = (
    mode: "mcp" | "code-mode",
    events: RunEvent[],
    baseDelay: number,
  ) => {
    events.forEach((event, i) => {
      const t = setTimeout(() => {
        if (cancelled) return;
        dispatch({ type: "event", mode, event });
      }, baseDelay + i * delayMs);
      timeouts.push(t);
    });
  };

  // Code Mode finishes quickly — start MCP straight away, Code Mode at
  // the same time but its events are fewer so it ends first naturally.
  playSide("mcp", run.mcp, 0);
  playSide("code-mode", run.codeMode, 0);

  return {
    cancel() {
      cancelled = true;
      for (const t of timeouts) clearTimeout(t);
    },
  };
}

/* ────────────────────────────────────────────────────────────────────
 *  Top strip — controls
 * ──────────────────────────────────────────────────────────────────── */

function ControlStrip({
  models,
  prompts,
  selectedModel,
  selectedPromptId,
  promptText,
  running,
  onSelectModel,
  onSelectPrompt,
  onChangeText,
  onGo,
  onReset,
  onReplay,
  canReplay,
  mode,
  degraded,
}: {
  models: DemoModel[];
  prompts: DemoPrompt[];
  selectedModel: string;
  selectedPromptId: string | null;
  promptText: string;
  running: boolean;
  onSelectModel(id: string): void;
  onSelectPrompt(id: string): void;
  onChangeText(t: string): void;
  onGo(): void;
  onReset(): void;
  onReplay(): void;
  canReplay: boolean;
  mode: DemoMode | "loading";
  degraded: boolean;
}) {
  const modelsLoaded = models.length > 0;
  const promptsLoaded = prompts.length > 0;
  return (
    <div
      data-interactive
      // Right-padding leaves room for the deck HUD (Overview/Dark/?)
      // which is fixed at top-right z-30 and would otherwise overlap
      // the GO button on a 16:9 slide.
      className="flex flex-wrap items-stretch gap-3 border-b border-cf-border px-6 py-3 pr-[260px]"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-stretch gap-3">
        <label
          data-interactive
          className="flex min-w-0 flex-col gap-1 text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle"
        >
          Model
          <select
            data-interactive
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value)}
            disabled={running || !modelsLoaded}
            className="cf-no-scrollbar w-[220px] rounded-md border border-cf-border bg-cf-bg-200 px-3 py-2 font-mono text-[12.5px] text-cf-text outline-none transition hover:border-cf-orange focus:border-cf-orange disabled:opacity-50"
          >
            {!modelsLoaded && (
              <option value="">
                {mode === "loading" ? "Loading models…" : "No models available"}
              </option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label
          data-interactive
          className="flex min-w-0 flex-col gap-1 text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle"
        >
          Preset
          <select
            data-interactive
            value={selectedPromptId ?? ""}
            onChange={(e) => onSelectPrompt(e.target.value)}
            disabled={running}
            className="w-[240px] rounded-md border border-cf-border bg-cf-bg-200 px-3 py-2 font-mono text-[12.5px] text-cf-text outline-none transition hover:border-cf-orange focus:border-cf-orange disabled:opacity-50"
          >
            <option value="">
              {promptsLoaded
                ? "— custom prompt —"
                : mode === "loading"
                  ? "Loading prompts…"
                  : "Custom prompt only"}
            </option>
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label
          data-interactive
          className="flex min-w-[240px] flex-1 flex-col gap-1 text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle"
        >
          Prompt
          <input
            data-interactive
            type="text"
            value={promptText}
            onChange={(e) => onChangeText(e.target.value)}
            disabled={running}
            placeholder="Ask anything about the connected Cloudflare account…"
            className="w-full rounded-md border border-cf-border bg-cf-bg-200 px-3 py-2 font-mono text-[12.5px] text-cf-text outline-none transition hover:border-cf-orange focus:border-cf-orange disabled:opacity-50"
          />
        </label>
      </div>

      <div className="flex items-end gap-2">
        {/* "Poor connection" sits next to the mode badge, but only when
            we're nominally live — in recorded mode the WifiOff badge
            already conveys that something is degraded. */}
        {degraded && mode === "live" && <ConnectionWarning />}
        <ModeBadge mode={mode} />
        <motion.button
          data-interactive
          {...buttonInteraction}
          type="button"
          onClick={onGo}
          disabled={running || !promptText.trim() || !selectedModel}
          className="inline-flex items-center gap-2 rounded-full bg-cf-orange px-6 py-2.5 font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-cf-bg-100 transition hover:bg-[var(--color-cf-orange-hover)] disabled:opacity-50"
        >
          <Play size={14} strokeWidth={2.5} />
          Go
        </motion.button>
        <motion.button
          data-interactive
          {...buttonInteraction}
          type="button"
          onClick={onReplay}
          disabled={running || !canReplay}
          className="inline-flex items-center gap-2 rounded-full border border-cf-border bg-cf-bg-200 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-cf-text-muted transition hover:border-cf-orange hover:text-cf-orange disabled:opacity-50"
        >
          <Repeat size={12} strokeWidth={2.25} />
          Replay
        </motion.button>
        <motion.button
          data-interactive
          {...buttonInteraction}
          type="button"
          onClick={onReset}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-full border border-cf-border bg-cf-bg-200 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-cf-text-muted transition hover:border-cf-orange hover:text-cf-orange disabled:opacity-50"
        >
          <RotateCcw size={12} strokeWidth={2.25} />
          Reset
        </motion.button>
      </div>
    </div>
  );
}

function ConnectionWarning() {
  return (
    <span
      title="Couldn't reach the demo backend's catalogue. Free-form prompts still work; presets and the model list may be unavailable."
      className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-cf-warning)]/40 bg-[color:var(--color-cf-warning)]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-cf-warning)]"
    >
      <WifiOff size={11} strokeWidth={2.5} />
      Poor connection
    </span>
  );
}

function ModeBadge({ mode }: { mode: DemoMode | "loading" }) {
  if (mode === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-cf-border bg-cf-bg-200 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
        <span className="size-1.5 rounded-full bg-cf-text-subtle" />
        Probing…
      </span>
    );
  }
  if (mode === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-cf-success)]/30 bg-[color:var(--color-cf-success-bg)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-cf-success)]">
        <Wifi size={11} strokeWidth={2.5} />
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-cf-warning)]/30 bg-[color:var(--color-cf-warning)]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-cf-warning)]">
      <WifiOff size={11} strokeWidth={2.5} />
      Recorded
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Per-column counter + transcript
 * ──────────────────────────────────────────────────────────────────── */

function Counter({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-r border-cf-border/60 px-3 py-2 last:border-r-0">
      <span className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-cf-text-subtle">
        {label}
      </span>
      <span
        className={`truncate font-mono text-[18px] tabular-nums leading-none ${highlight ? "text-cf-orange" : "text-cf-text"}`}
      >
        {value}
      </span>
    </div>
  );
}

function Transcript({
  state,
  accent,
}: {
  state: ColumnState;
  accent: "mcp" | "code";
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.tick]);

  return (
    <div
      ref={scrollerRef}
      className="cf-no-scrollbar relative flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-5 py-4"
    >
      {state.transcript.length === 0 && state.status === "idle" && (
        <div className="flex h-full items-center justify-center font-mono text-[12px] uppercase tracking-[0.12em] text-cf-text-subtle">
          Waiting…
        </div>
      )}
      {state.transcript.length === 0 && state.status === "running" && (
        <div className="flex h-full items-center justify-center font-mono text-[12px] uppercase tracking-[0.12em] text-cf-text-subtle">
          <span className="cf-live-dot mr-3" />
          Connecting…
        </div>
      )}

      <AnimatePresence initial={false}>
        {state.transcript.map((entry) => (
          <motion.div
            key={entry.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: easeButton }}
            className="shrink-0"
          >
            <TranscriptItem entry={entry} accent={accent} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function TranscriptItem({
  entry,
  accent,
}: {
  entry: ColumnState["transcript"][number];
  accent: "mcp" | "code";
}) {
  const accentText =
    accent === "mcp"
      ? "text-[color:var(--color-cf-error)]"
      : "text-cf-orange";
  const accentBorder =
    accent === "mcp"
      ? "border-[color:var(--color-cf-error)]/30"
      : "border-cf-orange/30";

  switch (entry.kind) {
    case "thinking":
      return (
        <div className="font-mono text-[11px] leading-[1.5] text-cf-text-subtle">
          <span className={`mr-2 ${accentText}`}>▸</span>
          {entry.text}
        </div>
      );
    case "tool_call":
      return (
        <div
          className={`rounded-md border ${accentBorder} bg-cf-bg-200 px-3 py-2 font-mono text-[12px] leading-[1.5]`}
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em]">
            <span className={accentText}>tool_call</span>
            <span className="text-cf-text">{entry.name}(</span>
            <span className="text-cf-text-muted">
              {entry.args && Object.keys(entry.args as object).length > 0
                ? truncate(JSON.stringify(entry.args), 60)
                : ""}
            </span>
            <span className="text-cf-text">)</span>
          </div>
        </div>
      );
    case "tool_result":
      return (
        <div className="rounded-md border border-cf-border bg-cf-bg-300 px-3 py-2 font-mono text-[11px] leading-[1.5] text-cf-text-muted">
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em]">
            <span className={accentText}>tool_result</span>
            <span className="text-cf-text-subtle">
              {entry.name} · {formatBytes(entry.sizeBytes)}
            </span>
          </div>
          <pre className="cf-no-scrollbar overflow-x-auto whitespace-pre-wrap break-words text-[10.5px]">
            {truncate(JSON.stringify(entry.result), 280)}
          </pre>
        </div>
      );
    case "code":
      return (
        <div className="rounded-md border border-cf-orange/30 bg-cf-bg-300 px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange">
            generated TypeScript
          </div>
          <pre className="cf-no-scrollbar overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] text-cf-text">
            {entry.source}
          </pre>
        </div>
      );
    case "code_log":
      return (
        <div className="rounded-md bg-cf-bg-200 px-3 py-1.5 font-mono text-[12px] leading-[1.55] text-cf-text">
          <span className="mr-2 text-cf-orange">›</span>
          {entry.text}
        </div>
      );
    case "final":
      return (
        <div className="mt-1 rounded-md border border-cf-border bg-cf-bg-100 px-3 py-2.5">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
            Final answer
          </div>
          <div className="whitespace-pre-wrap text-[13px] leading-[1.55] text-cf-text">
            {entry.answer}
          </div>
        </div>
      );
    case "error":
      return (
        <div className="rounded-md border border-[color:var(--color-cf-error)]/30 bg-[color:var(--color-cf-error)]/5 px-3 py-2 font-mono text-[12px] text-[color:var(--color-cf-error)]">
          {entry.message}
        </div>
      );
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/* ────────────────────────────────────────────────────────────────────
 *  Column
 * ──────────────────────────────────────────────────────────────────── */

function Column({
  title,
  subtitle,
  state,
  accent,
}: {
  title: string;
  subtitle: string;
  state: ColumnState;
  accent: "mcp" | "code";
}) {
  const tokens = useCountUp(state.totalTokens);
  const latency = useCountUp(state.latencyMs);
  const cost = estimateCost({
    promptTokens: state.promptTokens || state.totalTokens,
    completionTokens: state.completionTokens,
  });

  const accentText =
    accent === "mcp"
      ? "text-[color:var(--color-cf-error)]"
      : "text-cf-orange";
  const accentBracketBorder =
    accent === "mcp"
      ? "border-[color:var(--color-cf-error)]/40"
      : "border-cf-orange/40";

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <CornerBrackets className="flex h-full min-h-0 flex-col rounded-xl border border-cf-border bg-cf-bg-100">
        <header
          className={`flex items-center justify-between border-b ${accentBracketBorder} px-5 py-3`}
        >
          <div className="flex items-center gap-3">
            <div className={`size-2 rounded-full ${accent === "mcp" ? "bg-[color:var(--color-cf-error)]" : "bg-cf-orange"}`} />
            <h3
              className={`font-mono text-[13px] uppercase tracking-[0.14em] ${accentText}`}
            >
              {title}
            </h3>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
            {subtitle}
          </span>
        </header>

        <div className="flex min-h-0 flex-1">
          <Transcript state={state} accent={accent} />
        </div>

        <footer className="grid grid-cols-4 border-t border-cf-border">
          <Counter
            label="Total tokens"
            value={formatTokens(tokens)}
            highlight={accent === "code"}
          />
          <Counter label="Round-trips" value={String(state.roundTrips || (state.transcript.filter((e) => e.kind === "tool_call").length))} />
          <Counter label="Latency" value={formatLatency(latency)} />
          <Counter label="Cost" value={formatCost(cost)} />
        </footer>
      </CornerBrackets>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Winner badge
 * ──────────────────────────────────────────────────────────────────── */

function WinnerBadge({ state }: { state: DemoState }) {
  const ready =
    state.mcp.status === "done" && state.codeMode.status === "done";
  const winner = ready
    ? computeWinner({
        mcp: state.mcp.totalTokens,
        codeMode: state.codeMode.totalTokens,
      })
    : null;

  // Renders inline as a flex item — the parent reserves the height so
  // the badge never overlaps the columns above it. When no winner yet,
  // we render a hint of breathing space rather than collapsing the bar.
  return (
    <AnimatePresence mode="wait">
      {winner ? (
        <motion.div
          key="winner"
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.4, ease: easeEntrance }}
        >
          <div className="rounded-full border border-cf-orange/40 bg-cf-bg-100 px-5 py-2 font-mono text-[12px] uppercase tracking-[0.14em] text-cf-orange shadow-[var(--shadow-cf-card)]">
            {winner.winner === "tie"
              ? "Within 5% — basically a tie"
              : winner.winner === "code-mode"
                ? `Code Mode used ${winner.percentFewer}% fewer tokens`
                : `MCP used ${winner.percentFewer}% fewer tokens`}
          </div>
        </motion.div>
      ) : (
        <motion.span
          key="placeholder"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-cf-text-subtle"
        >
          Run a prompt — the token-savings verdict lands here
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  The slide body
 *
 *  No fallback prompts or models. The slide boots empty and pulls its
 *  catalogue from the Worker on mount. If the catalogue fetch fails or
 *  comes back empty, we surface a "Poor connection" warning rather
 *  than ship pre-baked content that could drift from the worker's
 *  source of truth (and, historically, did — verbose prompts that
 *  trip Llama 3.3 70B's tool-skipping behaviour).
 * ──────────────────────────────────────────────────────────────────── */

export function LiveDemoBody() {
  const [models, setModels] = useState<DemoModel[]>([]);
  const [prompts, setPrompts] = useState<DemoPrompt[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [promptText, setPromptText] = useState<string>("");
  const [mode, setMode] = useState<DemoMode | "loading">("loading");
  const [degraded, setDegraded] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<{
    prompt: string;
    promptId: string | null;
    modelId: string;
  } | null>(null);

  const [state, dispatch] = useReducer(demoReducer, {
    mcp: initialColumnState(),
    codeMode: initialColumnState(),
  });

  const abortRef = useRef<AbortController | null>(null);
  const recordedRef = useRef<RecordedPlayerHandle | null>(null);

  /* ── Probe health + load catalogues on mount ──────────────────────
     If anything fails or comes back empty, set `degraded` so the UI
     can show a "Poor connection" warning. The slide degrades to its
     recorded fallback if /health rejects entirely.

     Live endpoints (wired in #167 / cf-code-mode slice):
       /api/cf-code-mode/health         — binding probe
       /api/cf-code-mode/models         — demo model catalogue
       /api/cf-code-mode/prompts        — demo prompt presets
       /api/cf-code-mode/run-mcp        — traditional MCP run (SSE)
       /api/cf-code-mode/run-code-mode  — Code Mode run (SSE)
  */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/cf-code-mode/health", { cache: "no-store" });
        const payload = r.ok ? await r.json() : null;
        if (cancelled) return;
        setMode(selectMode(payload));
      } catch {
        if (cancelled) return;
        setMode("recorded");
        setDegraded(true);
      }
    })();
    (async () => {
      try {
        const [mRes, pRes] = await Promise.all([
          fetch("/api/cf-code-mode/models").then((r) =>
            r.ok ? r.json() : null,
          ),
          fetch("/api/cf-code-mode/prompts").then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);
        if (cancelled) return;
        const mList = mRes?.models as DemoModel[] | undefined;
        const pList = pRes?.prompts as DemoPrompt[] | undefined;
        if (mList?.length) {
          setModels(mList);
          setSelectedModel((cur) =>
            cur && mList.some((mm) => mm.id === cur) ? cur : mList[0]!.id,
          );
        } else {
          setDegraded(true);
        }
        if (pList?.length) {
          setPrompts(pList);
        } else {
          setDegraded(true);
        }
      } catch {
        if (cancelled) return;
        setDegraded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Cancel any in-flight run on unmount ────────────────────────── */
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      recordedRef.current?.cancel();
    };
  }, []);

  const onSelectPrompt = useCallback(
    (id: string) => {
      setSelectedPromptId(id || null);
      const found = prompts.find((p) => p.id === id);
      if (found) setPromptText(found.prompt);
    },
    [prompts],
  );

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    recordedRef.current?.cancel();
    recordedRef.current = null;
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setRunning(false);
    dispatch({ type: "reset" });
  }, [cleanup]);

  const launch = useCallback(
    async (
      prompt: string,
      promptId: string | null,
      modelId: string,
    ) => {
      cleanup();
      dispatch({ type: "reset" });
      setRunning(true);
      setLastRun({ prompt, promptId, modelId });

      if (mode === "live") {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const onMcp = (event: RunEvent) =>
          dispatch({ type: "event", mode: "mcp", event });
        const onCode = (event: RunEvent) =>
          dispatch({ type: "event", mode: "code-mode", event });

        const mcpRun = streamRun({
          url: "/api/cf-code-mode/run-mcp",
          prompt,
          modelId,
          promptId,
          signal: ctrl.signal,
          onEvent: onMcp,
        }).catch((err) => {
          if (ctrl.signal.aborted) return;
          onMcp({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
            recoverable: false,
          });
        });
        const codeRun = streamRun({
          url: "/api/cf-code-mode/run-code-mode",
          prompt,
          modelId,
          promptId,
          signal: ctrl.signal,
          onEvent: onCode,
        }).catch((err) => {
          if (ctrl.signal.aborted) return;
          onCode({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
            recoverable: false,
          });
        });

        await Promise.all([mcpRun, codeRun]);
        if (!ctrl.signal.aborted) setRunning(false);
      } else {
        const run = findRecordedRun(prompt, promptId ?? undefined);
        recordedRef.current = playRecorded(
          run,
          run.playbackDelayMs ?? 300,
          dispatch,
        );

        const total =
          (run.playbackDelayMs ?? 300) *
          Math.max(run.mcp.length, run.codeMode.length);
        const t = setTimeout(() => setRunning(false), total + 200);
        return () => clearTimeout(t);
      }
    },
    [cleanup, mode],
  );

  const onGo = useCallback(() => {
    const prompt = promptText.trim();
    if (!prompt || running) return;
    void launch(prompt, selectedPromptId, selectedModel);
  }, [launch, promptText, running, selectedPromptId, selectedModel]);

  const onReplay = useCallback(() => {
    if (!lastRun || running) return;
    void launch(lastRun.prompt, lastRun.promptId, lastRun.modelId);
  }, [launch, lastRun, running]);

  const subtitleMcp = useMemo(
    () => `${state.mcp.transcript.filter((e) => e.kind === "tool_call").length} tool calls`,
    [state.mcp.transcript],
  );
  const subtitleCode = useMemo(
    () =>
      state.codeMode.transcript.some((e) => e.kind === "code")
        ? "1 round-trip · code generated"
        : "1 round-trip",
    [state.codeMode.transcript],
  );

  return (
    <div
      data-no-advance
      className="relative flex h-full w-full flex-col bg-cf-bg-page"
    >
      <ControlStrip
        models={models}
        prompts={prompts}
        selectedModel={selectedModel}
        selectedPromptId={selectedPromptId}
        promptText={promptText}
        running={running}
        onSelectModel={setSelectedModel}
        onSelectPrompt={onSelectPrompt}
        onChangeText={(t) => {
          setPromptText(t);
          setSelectedPromptId(null);
        }}
        onGo={onGo}
        onReset={reset}
        onReplay={onReplay}
        canReplay={!!lastRun}
        mode={mode}
        degraded={degraded}
      />

      <div className="relative grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] gap-5 px-6 pt-4 pb-2">
        <Column
          title="Traditional MCP"
          subtitle={subtitleMcp}
          state={state.mcp}
          accent="mcp"
        />
        <div
          aria-hidden
          className="relative flex flex-col items-center justify-center"
        >
          <div className="cf-dashed-line-v h-full opacity-60" />
        </div>
        <Column
          title="Code Mode"
          subtitle={subtitleCode}
          state={state.codeMode}
          accent="code"
        />
      </div>

      {/* Winner-bar — real in-flow flex item with reserved min-height so
          the columns above never get clipped or overlapped. Always
          rendered; shows a hint when no run has finished yet, the
          actual verdict pill once both sides are done. */}
      <div className="flex shrink-0 items-center justify-center border-t border-cf-border bg-cf-bg-page px-6 py-3 min-h-[56px]">
        <WinnerBadge state={state} />
      </div>
    </div>
  );
}
