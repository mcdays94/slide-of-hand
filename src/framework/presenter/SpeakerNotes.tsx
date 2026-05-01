/**
 * Speaker notes panel rendered inside the presenter window.
 *
 * The notes are passed through verbatim — they are an arbitrary `ReactNode`
 * authored on `slide.notes`, so we just wrap them in a typography-bearing
 * container. Empty / nullish notes render a muted placeholder.
 */
import type { ReactNode } from "react";

export interface SpeakerNotesProps {
  notes?: ReactNode;
  slideTitle?: string;
  slideNumber?: number;
  totalSlides?: number;
}

export function SpeakerNotes({
  notes,
  slideTitle,
  slideNumber,
  totalSlides,
}: SpeakerNotesProps) {
  return (
    <section
      data-testid="speaker-notes"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto rounded-md border border-cf-border bg-cf-bg-100 p-6 text-cf-text"
      aria-label="Speaker notes"
    >
      <header className="flex items-baseline justify-between gap-3">
        <p className="cf-tag">Speaker notes</p>
        {typeof slideNumber === "number" && typeof totalSlides === "number" && (
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-cf-text-subtle">
            {String(slideNumber).padStart(2, "0")} / {String(totalSlides).padStart(2, "0")}
          </span>
        )}
      </header>
      {slideTitle && (
        <h2 className="text-2xl font-medium tracking-[-0.025em] text-cf-text">
          {slideTitle}
        </h2>
      )}
      <div className="presenter-notes flex-1 space-y-3 text-base leading-relaxed text-cf-text-muted">
        {notes ?? (
          <p className="text-cf-text-subtle italic">
            No notes for this slide.
          </p>
        )}
      </div>
    </section>
  );
}
