/**
 * Composing overlay — rendered across the canvas body during the
 * empty `ai_gen` phase (snapshot.phase === "ai_gen" AND files.length
 * === 0). Tells the user the AI is working and roughly how long to
 * wait.
 *
 * Why this exists: `generateObject` runs single-shot during `ai_gen`
 * and yields all files at once at the end. The canvas used to look
 * dead for ~142 s with no signal of progress. The PhaseStrip above
 * still correctly shows `ai_gen` as the active chip; this overlay
 * fills the body area that would otherwise show an empty file tree
 * with a placeholder.
 *
 * Pure presentational. The only stateful bit is the elapsed-time
 * counter, kept local to the component so the parent canvas stays
 * declarative. The component is rendered conditionally by
 * `<DeckCreationCanvas>`; when it unmounts (files start to land, or
 * the user navigates away), the interval is cleaned up. Re-mounting
 * the overlay (e.g. iterating on a draft kicks off a new generation)
 * starts the timer fresh at `0:00`.
 *
 * Pulse animation: a subtle three-dot stagger using a CSS keyframe
 * driven by the design-system `cf-orange` token. We avoid spinners
 * and progress bars by design — "subtle is the brand" and we can't
 * show real progress through a single-shot model call anyway.
 */

import { useEffect, useState } from "react";

/** Format seconds as `m:ss` (e.g. `0:23`, `1:23`). */
function formatMmSs(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ComposingOverlay() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      data-testid="deck-creation-composing-overlay"
      className="flex flex-1 flex-col items-center justify-center gap-6 rounded-lg border border-cf-text/10 bg-cf-bg-100 p-10"
    >
      {/* Subtle pulsing dot row — orange token, ~1.5s loop, staggered. */}
      <div
        aria-hidden="true"
        className="flex items-center gap-2"
        data-testid="deck-creation-composing-pulse"
      >
        <span className="composing-dot h-2 w-2 rounded-full bg-cf-orange/70" />
        <span
          className="composing-dot composing-dot--delay-1 h-2 w-2 rounded-full bg-cf-orange/70"
        />
        <span
          className="composing-dot composing-dot--delay-2 h-2 w-2 rounded-full bg-cf-orange/70"
        />
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-2xl font-medium tracking-[-0.025em] text-cf-text">
          Composing your deck
        </h2>
        <p className="max-w-md text-sm text-cf-text-muted">
          Typically 1-3 minutes. The AI is generating all files at once.
        </p>
      </div>

      <div
        data-testid="deck-creation-composing-timer"
        className="font-mono text-xs uppercase tracking-[0.25em] text-cf-text-subtle"
        aria-label={`Elapsed time: ${formatMmSs(elapsedSeconds)}`}
      >
        {formatMmSs(elapsedSeconds)}
      </div>
    </div>
  );
}
