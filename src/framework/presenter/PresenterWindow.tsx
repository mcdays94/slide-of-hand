/**
 * Presenter window — rendered when the deck route receives `?presenter=1`.
 *
 * Shows the author the four things they need while presenting:
 *
 *   1. Current slide thumbnail (live render at small scale).
 *   2. Next slide thumbnail.
 *   3. Speaker notes for the current slide.
 *   4. Elapsed time + pacing feedback.
 *   5. Click-to-jump grid of every slide.
 *
 * Synced to the main viewer over `BroadcastChannel('slide-of-hand-deck-<slug>')`.
 * On mount we broadcast `request-state` so a presenter window opened
 * after the main viewer is mid-deck still arrives in sync.
 *
 * The thumbnails reuse each slide's own `render()` output inside a
 * fixed 16:9 box scaled with CSS `transform: scale()`. This isn't a
 * pixel snapshot — it's a live, much-smaller copy of the slide's React
 * tree. Cheap enough for a 5-slide deck; future slices can swap to
 * `html2canvas`-style snapshots if a deck grows large.
 */
import { useEffect, useMemo, useState } from "react";
import type { Deck } from "@/framework/viewer/types";
import { PhaseProvider } from "@/framework/viewer/PhaseContext";
import { useDeckBroadcast } from "./broadcast";
import { SpeakerNotes } from "./SpeakerNotes";
import {
  classifyPacing,
  expectedRuntimeMs,
  formatDelta,
  formatElapsed,
  useElapsedTime,
} from "./usePresenterTimer";

export interface PresenterWindowProps {
  deck: Deck;
}

interface Cursor {
  slide: number;
  phase: number;
}

const PACING_TEXT_CLASSES: Record<"green" | "amber" | "red", string> = {
  green: "text-cf-success",
  amber: "text-cf-warning",
  red: "text-cf-danger",
};

const PACING_DOT_CLASSES: Record<"green" | "amber" | "red", string> = {
  green: "bg-cf-success",
  amber: "bg-cf-warning",
  red: "bg-cf-danger",
};

/**
 * Live mini-render of a slide. Uses the deck's own `render()` output inside a
 * 16:9 frame scaled with CSS — the scale factor is what makes it a thumbnail.
 */
function SlideThumbnail({
  deck,
  slideIndex,
  phase,
  label,
  emphasized,
  onClick,
  scale = 0.18,
  showLabel = true,
}: {
  deck: Deck;
  slideIndex: number;
  phase: number;
  label: string;
  emphasized?: boolean;
  onClick?: () => void;
  /** CSS scale factor. The inner pseudo-viewport is scaled by this. */
  scale?: number;
  /** Suppress the corner label overlay. Tiny thumbnails read better without it. */
  showLabel?: boolean;
}) {
  const slide = deck.slides[slideIndex];
  const layout = slide?.layout ?? "default";
  const Tag: "button" | "div" = onClick ? "button" : "div";
  // Emulate `<Slide>`'s centering + padding without re-running its motion
  // animation (which would replay every time the cursor changes).
  const inner =
    layout === "full"
      ? "h-full w-full"
      : "flex h-full w-full items-center justify-center px-12 py-16";
  // The pseudo-viewport renders at 1280x720 then is scaled down. Reciprocal
  // sizing means scale=0.18 on a 100%-of-thumbnail container yields a tiny
  // preview whose layout matches the real 16:9 slide.
  const reciprocal = `${(100 / scale).toFixed(2)}%`;
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={`thumbnail-${slideIndex}`}
      className={`group relative flex aspect-video w-full flex-col overflow-hidden rounded-md border bg-cf-bg-100 text-left transition-colors ${
        emphasized
          ? "border-cf-orange ring-2 ring-cf-orange/40"
          : "border-cf-border hover:border-dashed"
      }`}
    >
      {showLabel && (
        <span className="pointer-events-none absolute left-2 top-2 z-10 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle">
          {label} · {String(slideIndex + 1).padStart(2, "0")}
        </span>
      )}
      {slide ? (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 origin-top-left transform-gpu"
          style={{ width: reciprocal, height: reciprocal, transform: `scale(${scale})` }}
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
  const elapsedMs = useElapsedTime(deck.meta.slug);
  const expectedMs = useMemo(
    () =>
      expectedRuntimeMs(
        visibleSlides.map((s) => s.runtimeSeconds),
        deck.meta.runtimeMinutes,
      ),
    [visibleSlides, deck.meta.runtimeMinutes],
  );
  const elapsedTarget = useMemo(() => {
    // Expected elapsed at the start of the current slide:
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

  const onJump = (target: number) => {
    send({ type: "navigate", slide: target, phase: 0 });
    // Optimistically reflect the jump locally; the main viewer's broadcast
    // will overwrite this within a frame.
    setCursor({ slide: target, phase: 0 });
  };

  return (
    <main
      data-testid="presenter-window"
      className="grid h-screen min-h-screen w-screen grid-rows-[auto_1fr_auto] gap-4 bg-cf-bg-200 p-6 text-cf-text"
    >
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="flex items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <p className="cf-tag">Presenter</p>
          <h1 className="text-2xl font-medium tracking-[-0.025em] text-cf-text">
            {deck.meta.title}
          </h1>
        </div>
        <div className="flex items-baseline gap-6 font-mono tabular-nums">
          <span
            data-testid="presenter-elapsed"
            className="text-3xl font-medium tracking-tight text-cf-text"
          >
            {formatElapsed(elapsedMs)}
          </span>
          <span
            data-testid="presenter-pacing"
            data-pacing={pacing}
            className={`flex items-center gap-2 text-lg font-medium ${PACING_TEXT_CLASSES[pacing]}`}
          >
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${PACING_DOT_CLASSES[pacing]}`}
            />
            {formatDelta(deltaMs)}
          </span>
        </div>
      </header>

      {/* ── MAIN ───────────────────────────────────────────────────────── */}
      <section className="grid min-h-0 grid-cols-12 gap-4">
        {/* Current slide thumbnail — ~40% */}
        <div className="col-span-7 flex min-h-0 flex-col gap-2">
          <p className="cf-tag">Current</p>
          <SlideThumbnail
            deck={deck}
            slideIndex={cursor.slide}
            phase={cursor.phase}
            label="Now"
            emphasized
            scale={0.42}
          />
        </div>

        {/* Next slide thumbnail — ~30% */}
        <div className="col-span-5 flex min-h-0 flex-col gap-2">
          <p className="cf-tag">Next</p>
          {nextSlide ? (
            <SlideThumbnail
              deck={deck}
              slideIndex={cursor.slide + 1}
              phase={0}
              label="Next"
              scale={0.32}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-cf-border text-cf-text-subtle">
              End of deck
            </div>
          )}
        </div>
      </section>

      {/* ── NOTES + JUMP GRID ──────────────────────────────────────────── */}
      <section className="grid min-h-0 grid-cols-12 gap-4">
        <div className="col-span-7 min-h-0">
          <SpeakerNotes
            notes={currentSlide?.notes}
            slideTitle={currentSlide?.title}
            slideNumber={cursor.slide + 1}
            totalSlides={visibleSlides.length}
          />
        </div>

        <div className="col-span-5 flex min-h-0 flex-col gap-2 overflow-y-auto">
          <p className="cf-tag">Jump to slide</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {visibleSlides.map((s, i) => (
              <div key={s.id} className="flex flex-col gap-1">
                <SlideThumbnail
                  deck={deck}
                  slideIndex={i}
                  phase={0}
                  label={s.title || s.id}
                  emphasized={i === cursor.slide}
                  onClick={() => onJump(i)}
                  showLabel={false}
                  scale={0.16}
                />
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle">
                  {String(i + 1).padStart(2, "0")} · {s.title || s.id}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
