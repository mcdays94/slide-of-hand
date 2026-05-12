/**
 * Six-chip phase strip rendered at the top of the deck-creation
 * canvas. Each chip is one orchestrator phase (fork → clone → ai_gen
 * → apply → commit → push). The current phase is highlighted; earlier
 * phases tick green; later phases sit pending. A failure marks the
 * failed chip red and leaves the rest at their current state.
 *
 * Pure presentational — takes the current phase + optional
 * failedPhase, computes per-chip state, renders. Used by
 * `<DeckCreationCanvas>` (issue #178 sub-pieces 1 + 3).
 */

import type { DeckCreationSnapshot } from "@/lib/deck-creation-snapshot";

export type PipelinePhase = "fork" | "clone" | "ai_gen" | "apply" | "commit" | "push";

const PHASE_ORDER: ReadonlyArray<PipelinePhase> = [
  "fork",
  "clone",
  "ai_gen",
  "apply",
  "commit",
  "push",
];

const PHASE_LABEL: Record<PipelinePhase, string> = {
  fork: "Fork",
  clone: "Clone",
  ai_gen: "Generate",
  apply: "Apply",
  commit: "Commit",
  push: "Push",
};

export interface PhaseStripProps {
  /** The orchestrator phase the snapshot is in. */
  currentPhase: DeckCreationSnapshot["phase"];
  /** When phase === "error", which chip should be marked failed. */
  failedPhase?: DeckCreationSnapshot["failedPhase"];
}

type ChipState = "pending" | "current" | "done" | "failed";

function chipState(
  phase: PipelinePhase,
  currentPhase: DeckCreationSnapshot["phase"],
  failedPhase: PipelinePhase | undefined,
): ChipState {
  if (failedPhase === phase) return "failed";
  if (currentPhase === "done") return "done";
  if (currentPhase === "error") {
    // After an error with a known failedPhase, mark earlier chips
    // as done (the orchestrator successfully traversed them) and
    // later chips as pending.
    if (failedPhase) {
      const failedIdx = PHASE_ORDER.indexOf(failedPhase);
      const chipIdx = PHASE_ORDER.indexOf(phase);
      if (chipIdx < failedIdx) return "done";
      return "pending";
    }
    // No failedPhase — best we can do is leave them all pending.
    return "pending";
  }
  const currentIdx = PHASE_ORDER.indexOf(currentPhase as PipelinePhase);
  const chipIdx = PHASE_ORDER.indexOf(phase);
  if (chipIdx < currentIdx) return "done";
  if (chipIdx === currentIdx) return "current";
  return "pending";
}

const STATE_CLASSES: Record<ChipState, string> = {
  pending:
    "border-cf-text/15 text-cf-text-muted bg-transparent",
  current:
    "border-cf-orange text-cf-orange bg-cf-orange/5 animate-pulse",
  done:
    "border-cf-text/25 text-cf-text bg-cf-text/5",
  failed:
    "border-red-500 text-red-600 bg-red-50",
};

const STATE_ICON: Record<ChipState, string> = {
  pending: "○",
  current: "◌",
  done: "✓",
  failed: "✕",
};

export function PhaseStrip({ currentPhase, failedPhase }: PhaseStripProps) {
  return (
    <ol
      data-testid="deck-creation-phase-strip"
      className="flex items-center gap-2 text-xs tracking-tight"
    >
      {PHASE_ORDER.map((phase, i) => {
        const state = chipState(phase, currentPhase, failedPhase);
        return (
          <li key={phase} className="flex items-center gap-2">
            <span
              data-testid={`deck-creation-phase-chip-${phase}`}
              data-state={state}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono uppercase ${STATE_CLASSES[state]}`}
            >
              <span aria-hidden>{STATE_ICON[state]}</span>
              {PHASE_LABEL[phase]}
            </span>
            {i < PHASE_ORDER.length - 1 ? (
              <span aria-hidden className="text-cf-text/20">
                ·
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
