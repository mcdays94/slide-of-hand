/**
 * Presenter window — rendered when the deck route receives `?presenter=1`.
 *
 * Issue #36 reshapes this layout to give the current slide ~60-70% of the
 * vertical space (a la cf-slides' SpeakerView), and adds:
 *
 *   - A pause/resume control on the elapsed clock.
 *   - Phase indicator dots beneath the current-slide preview when the
 *     active slide has more than one phase.
 *   - Prev / Next chevron buttons that navigate the deck via the existing
 *     `navigate` BroadcastMessage.
 *   - An End-Show button that closes the popup with `window.close()`. If
 *     the window wasn't opened by `window.open()` (e.g. it's a regular
 *     tab someone navigated to), the call no-ops, so we also surface a
 *     "press Esc to close" hint.
 *   - A horizontal filmstrip of slide-number chips along the bottom of
 *     the notes panel, replacing the prior 3-col jump grid.
 *   - A resizable notes panel on the right, persisted via localStorage.
 *   - A font-size knob in the notes header.
 *
 * KEEP from the prior implementation:
 *
 *   - BroadcastChannel sync via `useDeckBroadcast` (channel name unchanged).
 *   - The pacing classification (green / amber / red) on the header chip.
 *   - sessionStorage-persisted elapsed clock, now via `usePausableElapsedTime`.
 *   - The live-render-then-CSS-scale `<SlideThumbnail>` (works fine for
 *     small decks; cf-slides' ResizeObserver-based approach was tempting
 *     but brings its own quirks and we don't need it for the v1 deck).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Deck } from "@/framework/viewer/types";
import { PhaseProvider } from "@/framework/viewer/PhaseContext";
import { useDeckBroadcast } from "./broadcast";
import { SpeakerNotes } from "./SpeakerNotes";
import { PhaseDots } from "./PhaseDots";
import { Filmstrip } from "./Filmstrip";
import { useResizable } from "./useResizable";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  PauseIcon,
  PlayIcon,
} from "./NavControls";
import {
  classifyPacing,
  expectedRuntimeMs,
  formatElapsed,
  usePausableElapsedTime,
} from "./usePresenterTimer";

export interface PresenterWindowProps {
  deck: Deck;
}

interface Cursor {
  slide: number;
  phase: number;
}

/**
 * Pacing colour for the elapsed clock. The standalone pacing chip was
 * removed in #111; the calculation still subtly tints the elapsed digits
 * so the presenter sees pacing at-a-glance without a separate visual
 * element competing for attention.
 *
 * Returns the bare colour utility (`text-cf-orange` is the default
 * green-ish-on-cream "on pace" treatment) so the consumer can compose it
 * into the className alongside the paused-state and font-mono utilities.
 */
function pacingTextClass(p: "green" | "amber" | "red"): string {
  switch (p) {
    case "amber":
      return "text-cf-warning";
    case "red":
      return "text-cf-danger";
    case "green":
    default:
      return "text-cf-orange";
  }
}

/**
 * Live mini-render of a slide, scaled with CSS transform.
 *
 * Same approach as the previous version of this file: render the slide's
 * own JSX inside a 1280×720 pseudo-viewport, scale it down to thumbnail
 * size, and absolutely-position it inside a 16:9 frame. Fast and
 * dependency-free.
 */
function SlideThumbnail({
  deck,
  slideIndex,
  phase,
  scale,
  emphasized,
  onClick,
  cornerLabel,
}: {
  deck: Deck;
  slideIndex: number;
  phase: number;
  scale: number;
  emphasized?: boolean;
  onClick?: () => void;
  /** Optional pill text rendered in the top-left of the frame. */
  cornerLabel?: string;
}) {
  const slide = deck.slides[slideIndex];
  const layout = slide?.layout ?? "default";
  const Tag: "button" | "div" = onClick ? "button" : "div";
  const inner =
    layout === "full"
      ? "h-full w-full"
      : "flex h-full w-full items-center justify-center px-12 py-16";
  // Reciprocal sizing so a 100%-of-thumbnail container, when scaled by
  // `scale`, lays out at 1280×720 internally.
  const reciprocal = `${(100 / scale).toFixed(2)}%`;
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={`thumbnail-${slideIndex}`}
      className={`group relative flex h-full w-full flex-col overflow-hidden rounded-md border bg-cf-bg-100 text-left transition-colors ${
        emphasized
          ? "border-cf-orange ring-2 ring-cf-orange/40"
          : "border-cf-border hover:border-dashed"
      }`}
    >
      {cornerLabel && (
        <span className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center rounded-full bg-cf-orange/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-orange">
          {cornerLabel}
        </span>
      )}
      {slide ? (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 origin-top-left transform-gpu"
          style={{
            width: reciprocal,
            height: reciprocal,
            transform: `scale(${scale})`,
          }}
        >
          <div className={`${inner} h-full w-full bg-cf-bg-100 text-cf-text`}>
            <PhaseProvider phase={phase}>
              {slide.render({ phase })}
            </PhaseProvider>
          </div>
        </div>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-cf-text-subtle">
          —
        </span>
      )}
    </Tag>
  );
}

export function PresenterWindow({ deck }: PresenterWindowProps) {
  const visibleSlides = useMemo(
    () => deck.slides.filter((s) => !s.hidden),
    [deck.slides],
  );

  const [cursor, setCursor] = useState<Cursor>({ slide: 0, phase: 0 });

  // Ref to the current-slide preview DOM node. Used by item E to scope
  // tool overlays / cursor tracking to that panel only.
  const currentPreviewRef = useRef<HTMLDivElement | null>(null);

  const { send } = useDeckBroadcast(deck.meta.slug, (msg) => {
    if (msg.type === "state" && msg.deckSlug === deck.meta.slug) {
      setCursor({ slide: msg.slide, phase: msg.phase });
    }
  });

  // Ask the main viewer for its current state on mount (and on slug change,
  // though that's rare since the route owns the slug).
  useEffect(() => {
    send({ type: "request-state" });
  }, [deck.meta.slug, send]);

  // Update document title to "Presenter — <deck title>".
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = `Presenter — ${deck.meta.title}`;
    }
  }, [deck.meta.title]);

  // Elapsed + pacing.
  const {
    elapsedMs,
    paused,
    toggle: toggleTimer,
  } = usePausableElapsedTime(deck.meta.slug);
  const expectedMs = useMemo(
    () =>
      expectedRuntimeMs(
        visibleSlides.map((s) => s.runtimeSeconds),
        deck.meta.runtimeMinutes,
      ),
    [visibleSlides, deck.meta.runtimeMinutes],
  );
  const elapsedTarget = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < cursor.slide && i < visibleSlides.length; i++) {
      const secs = visibleSlides[i]?.runtimeSeconds;
      if (typeof secs === "number" && secs > 0) acc += secs * 1000;
    }
    return acc;
  }, [cursor.slide, visibleSlides]);
  const deltaMs = elapsedMs - elapsedTarget;
  const pacing = classifyPacing(deltaMs, expectedMs);

  const currentSlide = visibleSlides[cursor.slide];
  const nextSlide = visibleSlides[cursor.slide + 1];
  const totalPhases = (currentSlide?.phases ?? 0) + 1;

  // Notes panel resize.
  const notesPanel = useResizable({
    storageKey: "notes",
    defaultWidth: 320,
    minWidth: 200,
    maxWidth: 600,
  });

  // Send a navigate broadcast and optimistically reflect the move locally.
  const onJump = useCallback(
    (slide: number, phase: number = 0) => {
      const target = Math.max(0, Math.min(visibleSlides.length - 1, slide));
      send({ type: "navigate", slide: target, phase });
      setCursor({ slide: target, phase });
    },
    [send, visibleSlides.length],
  );

  const goPrev = useCallback(() => {
    if (cursor.phase > 0) {
      onJump(cursor.slide, cursor.phase - 1);
      return;
    }
    if (cursor.slide > 0) {
      const prev = visibleSlides[cursor.slide - 1];
      const prevPhases = (prev?.phases ?? 0);
      onJump(cursor.slide - 1, prevPhases);
    }
  }, [cursor, onJump, visibleSlides]);

  const goNext = useCallback(() => {
    if (cursor.phase < totalPhases - 1) {
      onJump(cursor.slide, cursor.phase + 1);
      return;
    }
    if (cursor.slide < visibleSlides.length - 1) {
      onJump(cursor.slide + 1, 0);
    }
  }, [cursor, onJump, totalPhases, visibleSlides.length]);

  const goFirst = useCallback(() => onJump(0, 0), [onJump]);
  const goLast = useCallback(() => {
    const last = Math.max(0, visibleSlides.length - 1);
    const lastSlide = visibleSlides[last];
    const lastPhase = lastSlide?.phases ?? 0;
    onJump(last, lastPhase);
  }, [onJump, visibleSlides]);

  // ── Keyboard navigation (item A / #111) ────────────────────────────────
  // Mirror the public viewer's keyboard handlers so the presenter window
  // reacts to → / ← / Space / Enter / Backspace / Home / End. Without
  // this the presenter could only navigate via the chevron buttons.
  //
  // Same `Element`-target guard as Deck.tsx: synthetic events dispatched
  // on `window` carry `target = Window`, which has no `.closest()`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          "[data-interactive], input, select, textarea, [contenteditable=true]",
        )
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
        case "Enter":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
        case "PageUp":
        case "Backspace":
          e.preventDefault();
          goPrev();
          break;
        case "Home":
          e.preventDefault();
          goFirst();
          break;
        case "End":
          e.preventDefault();
          goLast();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, goFirst, goLast]);

  const isAtStart = cursor.slide === 0 && cursor.phase === 0;
  const isAtEnd =
    cursor.slide === visibleSlides.length - 1 &&
    cursor.phase === totalPhases - 1;

  // End Show — try `window.close()` (works only when this window was
  // opened by `window.open()`). If it doesn't close (regular tab), the
  // call is a silent no-op; the kicker hint already mentions Esc.
  const endShow = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.close();
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <main
      data-testid="presenter-window"
      className="flex h-screen min-h-screen w-screen flex-col overflow-hidden bg-cf-bg-200 text-cf-text"
    >
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="flex flex-shrink-0 items-center gap-4 border-b border-cf-border bg-cf-bg-100/95 px-5 py-2 backdrop-blur-[2px]">
        <p className="cf-tag">Presenter</p>
        <h1 className="truncate text-sm font-medium tracking-[-0.02em] text-cf-text">
          {deck.meta.title}
        </h1>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span
            data-testid="presenter-elapsed"
            data-paused={paused ? "true" : "false"}
            data-pacing={pacing}
            className={`font-mono text-lg tabular-nums tracking-tight transition-colors ${
              paused ? "text-cf-text-subtle" : pacingTextClass(pacing)
            }`}
          >
            {formatElapsed(elapsedMs)}
          </span>
          <button
            type="button"
            onClick={toggleTimer}
            data-testid="presenter-timer-toggle"
            data-paused={paused ? "true" : "false"}
            aria-label={paused ? "Resume timer" : "Pause timer"}
            title={paused ? "Resume timer" : "Pause timer"}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-cf-border transition-colors hover:border-dashed ${
              paused ? "text-cf-orange" : "text-cf-text-subtle"
            }`}
          >
            {paused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}
          </button>
        </div>
        <span aria-hidden className="h-5 w-px bg-cf-border" />
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-cf-text-subtle">
          {String(cursor.slide + 1).padStart(2, "0")} /{" "}
          {String(visibleSlides.length).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={endShow}
          data-testid="presenter-end-show"
          aria-label="End show"
          title="Close presenter window (or press Esc)"
          className="inline-flex items-center gap-1.5 rounded-full border border-cf-danger/30 bg-transparent px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-cf-danger transition-colors hover:border-cf-danger hover:bg-cf-danger/10"
        >
          <CloseIcon size={11} />
          End Show
        </button>
      </header>

      {/* ── BODY ───────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Slides column — current preview + bottom row */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
          {/* Current slide — large, ~60% of vertical space.
              16:9 enforcement (item C / #111): the wrapper uses
              container-query units to compute the largest 16:9 box that
              fits in both axes. Same trick as the next preview below. */}
          <div
            data-testid="presenter-current-preview-container"
            className="flex min-h-0 min-w-0 flex-[5] items-center justify-center"
            style={{ containerType: "size" }}
          >
            <div
              ref={currentPreviewRef}
              data-testid="presenter-current-preview"
              className="relative"
              style={{
                width: "min(100cqw, calc(100cqh * 16 / 9))",
                height: "min(100cqh, calc(100cqw * 9 / 16))",
              }}
            >
              <SlideThumbnail
                deck={deck}
                slideIndex={cursor.slide}
                phase={cursor.phase}
                scale={0.55}
                emphasized
                cornerLabel={`Current · Slide ${cursor.slide + 1}`}
              />
              {/* Phase dots overlay — bottom-left of the preview frame. */}
              {totalPhases > 1 && (
                <div className="pointer-events-none absolute bottom-3 left-3 z-10">
                  <PhaseDots total={totalPhases} current={cursor.phase} />
                </div>
              )}
            </div>
          </div>

          {/* Bottom row — next preview + nav controls */}
          <div className="flex min-h-0 flex-[2] gap-3">
            {/* 16:9 enforcement (item C / #111). The previous markup used
                `w-full max-h-full aspect-video` which squashes whenever the
                container's aspect ratio differs from 16:9 — `w-full` pins
                width = parent.width, `aspect-video` resolves height to
                width × 9/16, but `max-h-full` then clips visual height
                while layout width stays full → squash.
                The fix uses container query units to compute the largest
                16:9 box that fits in BOTH axes:
                  width  = min(100% of container width, container height × 16/9)
                  height = min(100% of container height, container width × 9/16)
                The resulting rectangle always has aspect 16:9 and
                always fits, regardless of container shape. */}
            <div
              data-testid="presenter-next-preview-container"
              className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
              style={{ containerType: "size" }}
            >
              <div
                className="relative"
                style={{
                  width: "min(100cqw, calc(100cqh * 16 / 9))",
                  height: "min(100cqh, calc(100cqw * 9 / 16))",
                }}
              >
                {nextSlide ? (
                  <SlideThumbnail
                    deck={deck}
                    slideIndex={cursor.slide + 1}
                    phase={0}
                    scale={0.32}
                    cornerLabel={`Next · ${nextSlide.title || nextSlide.id}`}
                    onClick={() => onJump(cursor.slide + 1)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-cf-border bg-cf-bg-100 text-cf-text-subtle">
                    <span className="font-mono text-sm uppercase tracking-[0.25em]">
                      End of deck
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-shrink-0 flex-col items-center justify-center gap-3 px-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={isAtStart}
                  data-testid="presenter-prev"
                  aria-label="Previous slide or phase"
                  title="Previous (← or Backspace)"
                  className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-cf-border bg-cf-bg-100 text-cf-text transition-colors hover:border-dashed disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeftIcon size={20} />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={isAtEnd}
                  data-testid="presenter-next"
                  aria-label="Next slide or phase"
                  title="Next (→ / Space / Enter)"
                  className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-transparent bg-cf-orange text-cf-bg-100 transition-colors hover:bg-cf-orange/90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRightIcon size={20} />
                </button>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle">
                ← → or click
              </span>
            </div>
          </div>
        </div>

        {/* Splitter — 1px wide; expanded hover hit-area via padding */}
        <div
          data-testid="presenter-notes-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize notes panel"
          onMouseDown={(e) => notesPanel.onMouseDown(e, -1)}
          className="group flex-shrink-0 cursor-col-resize px-1 py-0"
        >
          <div className="h-full w-px bg-cf-border transition-colors group-hover:bg-cf-orange/50 group-active:bg-cf-orange" />
        </div>

        {/* Notes column */}
        <aside
          data-testid="presenter-notes-panel"
          className="flex min-h-0 flex-shrink-0 flex-col gap-3 bg-cf-bg-200 p-3"
          style={{ width: notesPanel.width }}
        >
          <div className="min-h-0 flex-1">
            <SpeakerNotes
              notes={currentSlide?.notes}
              slideTitle={currentSlide?.title}
              slideNumber={cursor.slide + 1}
              totalSlides={visibleSlides.length}
            />
          </div>
          <div className="flex-shrink-0 border-t border-cf-border pt-3">
            <Filmstrip
              slides={visibleSlides}
              current={cursor.slide}
              onJump={(i) => onJump(i)}
            />
          </div>
        </aside>
      </div>
    </main>
  );
}
