/**
 * Error banner overlay rendered across the canvas body when a
 * snapshot lands with `phase: "error"`. The PhaseStrip behind it
 * still shows the chip flow (with the failed chip red); this overlay
 * focuses attention on the message + retry affordance.
 *
 * Pure presentational. The Retry button calls back to whatever the
 * route wires up — typically `useAgentChat`'s `sendMessage(...)` with
 * the original prompt. Issue #178 sub-pieces 1 + 3.
 */

import type { DeckCreationSnapshot } from "@/lib/deck-creation-snapshot";

export interface ErrorOverlayProps {
  message: string;
  /** Which phase failed — used for the heading. */
  failedPhase?: DeckCreationSnapshot["failedPhase"];
  /** Optional retry callback. Hidden when undefined. */
  onRetry?: () => void;
}

const PHASE_NAME: Record<NonNullable<DeckCreationSnapshot["failedPhase"]>, string> = {
  fork: "Fork",
  clone: "Clone",
  ai_gen: "Generation",
  apply: "Apply",
  commit: "Commit",
  push: "Push",
};

export function ErrorOverlay({ message, failedPhase, onRetry }: ErrorOverlayProps) {
  const heading = failedPhase
    ? `${PHASE_NAME[failedPhase]} failed`
    : "Something went wrong";
  return (
    <div
      data-testid="deck-creation-error-overlay"
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 shadow-sm"
    >
      <p className="font-medium tracking-tight">{heading}</p>
      <p
        data-testid="deck-creation-error-message"
        className="mt-1 break-words font-mono text-xs leading-relaxed text-red-800"
      >
        {message}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          data-testid="deck-creation-error-retry"
          className="mt-3 rounded-md border border-dashed border-red-400 px-3 py-1 text-xs uppercase tracking-wider text-red-700 hover:bg-red-100"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
