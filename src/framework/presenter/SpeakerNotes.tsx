/**
 * Speaker notes panel rendered inside the presenter window.
 *
 * The notes are passed through verbatim — they are an arbitrary `ReactNode`
 * authored on `slide.notes`, so we just wrap them in a typography-bearing
 * container. Empty / nullish notes render a muted placeholder.
 *
 * Slice #36 adds:
 *
 *   - A header treatment closer to cf-slides' speaker view (uppercase mono
 *     kicker tinted in cf-orange).
 *   - A font-size +/- knob, range 12–22 px, default 16, persisted under
 *     `slide-of-hand-presenter-notes-fontsize` in localStorage. Steps in
 *     2 px increments to match a small set of sensible sizes.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MinusIcon, PlusIcon } from "./NavControls";

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 22;
const DEFAULT_FONT_SIZE = 16;
const STEP = 2;
export const NOTES_FONT_SIZE_KEY = "slide-of-hand-presenter-notes-fontsize";

function readPersistedFontSize(): number {
  if (typeof window === "undefined") return DEFAULT_FONT_SIZE;
  try {
    const raw = window.localStorage.getItem(NOTES_FONT_SIZE_KEY);
    if (raw == null) return DEFAULT_FONT_SIZE;
    const parsed = Number(raw);
    if (
      !Number.isFinite(parsed) ||
      parsed < MIN_FONT_SIZE ||
      parsed > MAX_FONT_SIZE
    ) {
      return DEFAULT_FONT_SIZE;
    }
    return parsed;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

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
  const [fontSize, setFontSize] = useState<number>(() =>
    readPersistedFontSize(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(NOTES_FONT_SIZE_KEY, String(fontSize));
    } catch {
      /* ignore — quota or private mode */
    }
  }, [fontSize]);

  const inc = useCallback(() => {
    setFontSize((s) => Math.min(MAX_FONT_SIZE, s + STEP));
  }, []);
  const dec = useCallback(() => {
    setFontSize((s) => Math.max(MIN_FONT_SIZE, s - STEP));
  }, []);

  // Map the numeric font-size to a Tailwind utility class. Stops at 2px
  // intervals between 12 and 22 — exhaustive list keeps the runtime CSS
  // bundle predictable and avoids inline `style={fontSize}` (which the
  // brief asks us to avoid).
  const fontSizeClass = useMemo(() => {
    switch (fontSize) {
      case 12:
        return "text-[12px] leading-[1.5]";
      case 14:
        return "text-[14px] leading-[1.55]";
      case 16:
        return "text-[16px] leading-[1.6]";
      case 18:
        return "text-[18px] leading-[1.6]";
      case 20:
        return "text-[20px] leading-[1.65]";
      case 22:
        return "text-[22px] leading-[1.65]";
      default:
        return "text-[16px] leading-[1.6]";
    }
  }, [fontSize]);

  const minDisabled = fontSize <= MIN_FONT_SIZE;
  const maxDisabled = fontSize >= MAX_FONT_SIZE;

  return (
    <section
      data-testid="speaker-notes"
      className="flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-md border border-cf-border bg-cf-bg-100 p-5 text-cf-text"
      aria-label="Speaker notes"
    >
      <header className="flex flex-shrink-0 items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <p
            data-testid="speaker-notes-kicker"
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-cf-orange"
          >
            Speaker notes
          </p>
          {typeof slideNumber === "number" &&
            typeof totalSlides === "number" && (
              <span className="font-mono text-xs uppercase tracking-[0.25em] text-cf-text-subtle">
                {String(slideNumber).padStart(2, "0")} /{" "}
                {String(totalSlides).padStart(2, "0")}
              </span>
            )}
        </div>
        <div
          data-testid="speaker-notes-fontsize"
          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle"
          aria-label="Notes font size"
        >
          <button
            type="button"
            onClick={dec}
            disabled={minDisabled}
            data-testid="speaker-notes-fontsize-decrease"
            aria-label="Decrease notes font size"
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-cf-border text-cf-text-muted transition-colors hover:border-dashed hover:text-cf-text disabled:opacity-30"
          >
            <MinusIcon size={11} />
          </button>
          <span
            data-testid="speaker-notes-fontsize-value"
            className="w-7 select-none text-center tabular-nums"
          >
            {fontSize}
          </span>
          <button
            type="button"
            onClick={inc}
            disabled={maxDisabled}
            data-testid="speaker-notes-fontsize-increase"
            aria-label="Increase notes font size"
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-cf-border text-cf-text-muted transition-colors hover:border-dashed hover:text-cf-text disabled:opacity-30"
          >
            <PlusIcon size={11} />
          </button>
        </div>
      </header>
      {slideTitle && (
        <h2 className="flex-shrink-0 text-2xl font-medium tracking-[-0.025em] text-cf-text">
          {slideTitle}
        </h2>
      )}
      <div
        data-testid="speaker-notes-body"
        className={`presenter-notes flex-1 space-y-3 overflow-y-auto pr-1 text-cf-text-muted ${fontSizeClass}`}
      >
        {notes ?? (
          <p className="text-cf-text-subtle italic">
            No notes for this slide.
          </p>
        )}
      </div>
    </section>
  );
}
