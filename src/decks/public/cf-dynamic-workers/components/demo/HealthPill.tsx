import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { easeEntrance } from "../../lib/motion";

/**
 * HealthPill — pre-flight check the speaker can glance at before
 * clicking Spawn on stage. Hits `/api/health` once on mount and
 * displays a coloured pill: green if both LOADER and AI bindings
 * report available, amber if one is missing, red if the backend
 * itself is unreachable.
 *
 * Designed to be unobtrusive: small font-mono pill that lives in
 * the top-right of slide 08. The speaker never has to act on it —
 * it's a passive signal that "the live demo backend is up."
 */

export interface HealthPillProps {
  endpoint?: string;
  className?: string;
}

interface HealthResponse {
  ok: boolean;
  loaderAvailable: boolean;
  aiAvailable: boolean;
  selfAvailable?: boolean;
}

type HealthState =
  | { kind: "checking" }
  | { kind: "ok"; loader: boolean; ai: boolean; self?: boolean }
  | { kind: "simulated" }
  | { kind: "error"; message: string };

/**
 * When `simulate` is true (the default in this build), the pill skips
 * the `/api/health` round-trip entirely and renders a static "simulated"
 * label. The Slide of Hand build doesn't ship a Worker Loader binding
 * yet, so there's no backend to probe.
 *
 * TODO(#101 follow-up): flip simulate=false (or remove the prop) once a
 * Worker Loader binding is added to wrangler.jsonc and a /api/health
 * endpoint is available.
 */
export function HealthPill({
  endpoint = "/api/health",
  className = "",
  simulate = true,
}: HealthPillProps & { simulate?: boolean }) {
  const [state, setState] = useState<HealthState>(() =>
    simulate ? { kind: "simulated" } : { kind: "checking" },
  );

  useEffect(() => {
    if (simulate) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch(endpoint, { signal: controller.signal })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setState({ kind: "error", message: `HTTP ${r.status}` });
          return;
        }
        const body = (await r.json()) as HealthResponse;
        setState({
          kind: "ok",
          loader: !!body.loaderAvailable,
          ai: !!body.aiAvailable,
          self: body.selfAvailable,
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        const message =
          cause && typeof cause === "object" && "name" in cause && cause.name === "AbortError"
            ? "timeout"
            : cause instanceof Error
              ? cause.message
              : String(cause);
        setState({ kind: "error", message });
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint, simulate]);

  return (
    <motion.div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${pillClasses(state)} ${className}`}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: easeEntrance }}
      role="status"
      aria-live="polite"
      data-testid="health-pill"
      data-state={state.kind}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass(state)}`} />
      <span>{label(state)}</span>
    </motion.div>
  );
}

function pillClasses(state: HealthState): string {
  switch (state.kind) {
    case "checking":
      return "border-cf-border bg-cf-bg-200 text-cf-text-muted";
    case "ok":
      return state.loader && state.ai
        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
        : "border-amber-300 bg-amber-50 text-amber-700";
    case "simulated":
      return "border-cf-border bg-cf-bg-200 text-cf-text-muted";
    case "error":
      return "border-red-300 bg-red-50 text-red-700";
  }
}

function dotClass(state: HealthState): string {
  switch (state.kind) {
    case "checking":
      return "bg-cf-text-subtle animate-pulse";
    case "ok":
      return state.loader && state.ai ? "bg-emerald-500" : "bg-amber-500";
    case "simulated":
      return "bg-cf-text-subtle";
    case "error":
      return "bg-red-500";
  }
}

function label(state: HealthState): string {
  switch (state.kind) {
    case "checking":
      return "Checking backend…";
    case "ok": {
      const loader = state.loader ? "LOADER ✓" : "LOADER ✗";
      const ai = state.ai ? "AI ✓" : "AI ✗";
      return `${loader} · ${ai}`;
    }
    case "simulated":
      return "Live demo · simulated";
    case "error":
      return `Backend offline · ${state.message}`;
  }
}
