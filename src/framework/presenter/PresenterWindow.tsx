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
import { resolveInitialCursor } from "@/framework/viewer/useDeckState";
import { PhaseProvider } from "@/framework/viewer/PhaseContext";
import { SettingsModal } from "@/framework/viewer/SettingsModal";
import { SettingsProvider, useSettings } from "@/framework/viewer/useSettings";
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

/**
 * Public entry — wraps `<PresenterWindowInner>` in a `<SettingsProvider>`.
 *
 * The presenter window route mounts `<PresenterWindow>` directly (not via
 * `<Deck>`), so it doesn't inherit a settings context from the viewer.
 * Wrapping here lets the inner component (and its `<SettingsModal>`)
 * read + persist `Settings` exactly the way the public viewer does.
 */
export function PresenterWindow(props: PresenterWindowProps) {
  return (
    <SettingsProvider>
      <PresenterWindowInner {...props} />
    </SettingsProvider>
  );
}

/**
 * Lightweight gear icon (4 spokes) used as the settings trigger in the
 * presenter header. Inline SVG to avoid pulling lucide-react into the
 * presenter chunk for one icon.
 */
function GearIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/**
 * Render the next-slide preview area: either a single thumbnail or a
 * horizontal filmstrip of every phase, depending on the user's
 * `presenterNextSlideShowsFinalPhase` setting and how many phases the
 * next slide has.
 *
 * Three render branches:
 *
 *   1. Setting ON → single thumbnail at the LAST phase (fully revealed).
 *   2. Setting OFF + multi-phase next slide → filmstrip of N thumbnails,
 *      one per phase, in order.
 *   3. Setting OFF + single-phase next slide → single thumbnail at
 *      phase 0 (current behaviour, no change).
 *
 * End-of-deck (no next slide) renders a placeholder. The container that
 * houses this component owns the 16:9 sizing so each branch can fill the
 * frame without re-deriving aspect ratios.
 */
function NextPreview({
  deck,
  nextIndex,
  showsFinalPhase,
  onJump,
}: {
  deck: Deck;
  nextIndex: number;
  showsFinalPhase: boolean;
  onJump: (slideIndex: number, phase?: number) => void;
}) {
  const next = deck.slides[nextIndex];
  if (!next) {
    return (
      <div
        data-testid="presenter-next-preview-end"
        className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-cf-border bg-cf-bg-100 text-cf-text-subtle"
      >
        <span className="font-mono text-sm uppercase tracking-[0.25em]">
          End of deck
        </span>
      </div>
    );
  }

  const phaseCount = (next.phases ?? 0) + 1;
  const cornerLabel = `Next · ${next.title || next.id}`;

  // Branch 1: setting ON → always show the last phase, single thumb.
  if (showsFinalPhase) {
    return (
      <SlideThumbnail
        deck={deck}
        slideIndex={nextIndex}
        phase={phaseCount - 1}
        cornerLabel={cornerLabel}
        onClick={() => onJump(nextIndex)}
      />
    );
  }

  // Branch 3: single-phase → unchanged single thumb (filmstrip is moot).
  if (phaseCount <= 1) {
    return (
      <SlideThumbnail
        deck={deck}
        slideIndex={nextIndex}
        phase={0}
        cornerLabel={cornerLabel}
        onClick={() => onJump(nextIndex)}
      />
    );
  }

  // Branch 2: multi-phase + setting OFF → filmstrip.
  // Each phase tile is a SlideThumbnail at progressively higher phase.
  // Tiles share the available horizontal space; the smallest practical
  // size is when phaseCount is large (e.g. 6). At that point each tile
  // is roughly 1/6 of the full next-preview width but still 16:9.
  return (
    <div
      data-testid="presenter-next-preview-filmstrip"
      className="flex h-full w-full items-center justify-center gap-1.5"
    >
      {Array.from({ length: phaseCount }).map((_, p) => (
        <div
          key={p}
          data-testid={`presenter-next-preview-phase-${p}`}
          className="relative flex h-full min-w-0 flex-1 items-center justify-center"
          style={{ containerType: "size" }}
        >
          <div
            className="relative"
            style={{
              width: "min(100cqw, calc(100cqh * 16 / 9))",
              height: "min(100cqh, calc(100cqw * 9 / 16))",
            }}
          >
            <SlideThumbnail
              deck={deck}
              slideIndex={nextIndex}
              phase={p}
              cornerLabel={p === 0 ? cornerLabel : `Phase ${p}`}
              onClick={() => onJump(nextIndex, p)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Render a filmstrip of the CURRENT slide's phases as the "lookahead"
 * panel content. Used in place of <NextPreview> when the current slide
 * has phases the presenter has not yet revealed (Mode A — issue #115).
 *
 * Each tile is a SlideThumbnail of the same slide rendered at a different
 * phase. The current-phase tile is `emphasized` (orange border + ring)
 * to mirror the main current-slide preview's treatment, so the eye ties
 * "the big preview" and "the current tile in the filmstrip" together at
 * a glance.
 *
 * Click → jump to that phase of the current slide. The corner label on
 * each tile is "Now · Phase X/N" so the presenter can also navigate by
 * counting down ("two more reveals before the next slide").
 *
 * The component does not own its outer 16:9 frame — it expects to fill
 * its parent's full band, with each tile sized via container-query units
 * relative to its own per-tile container. This matches <NextPreview>'s
 * filmstrip branch (Mode B's filmstrip variant), so the call site can
 * place either component inside the same band wrapper.
 */
function CurrentSlideFilmstrip({
  deck,
  currentIndex,
  currentPhase,
  phaseCount,
  onJump,
}: {
  deck: Deck;
  currentIndex: number;
  currentPhase: number;
  phaseCount: number;
  onJump: (slideIndex: number, phase?: number) => void;
}) {
  return (
    <div
      data-testid="presenter-upcoming-current-filmstrip"
      className="flex h-full w-full items-center justify-center gap-1.5"
    >
      {Array.from({ length: phaseCount }).map((_, p) => (
        <div
          key={p}
          data-testid={`presenter-upcoming-current-phase-${p}`}
          className="relative flex h-full min-w-0 flex-1 items-center justify-center"
          style={{ containerType: "size" }}
        >
          <div
            className="relative"
            style={{
              width: "min(100cqw, calc(100cqh * 16 / 9))",
              height: "min(100cqh, calc(100cqw * 9 / 16))",
            }}
          >
            <SlideThumbnail
              deck={deck}
              slideIndex={currentIndex}
              phase={p}
              emphasized={p === currentPhase}
              cornerLabel={`Now · Phase ${p + 1}/${phaseCount}`}
              onClick={() => onJump(currentIndex, p)}
            />
          </div>
        </div>
      ))}
    </div>
  );
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
/**
 * Canonical design viewport for slide thumbnails. Build-time thumbnails
 * (scripts/build-thumbnails.mjs) snap each slide at 1920×1080, then
 * resize to 320×180. Slide JSX uses absolute Tailwind sizes (text-7xl,
 * max-w-5xl, gap-10, px-12, …) tuned to that viewport. Rendering into
 * any other inner-div size makes those absolute sizes land in the
 * wrong proportions — and rendering into a SHORTER viewport (the bug
 * fixed by issue #124) clips the top + bottom of slides whose natural
 * content height is taller than the inner div.
 *
 * The fix: render at a FIXED 1920×1080 design viewport, regardless of
 * the SlideThumbnail's actual rendered tile size, and let CSS
 * container queries drive the dynamic scale-down.
 */
const SLIDE_DESIGN_WIDTH = 1920;
const SLIDE_DESIGN_HEIGHT = 1080;

function SlideThumbnail({
  deck,
  slideIndex,
  phase,
  emphasized,
  onClick,
  cornerLabel,
}: {
  deck: Deck;
  slideIndex: number;
  phase: number;
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
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={`thumbnail-${slideIndex}`}
      // `container-type: size` makes this <Tag> the size context for
      // the `100cqw` unit used in the transform below, so the scale
      // computes against the tile's actual rendered width regardless
      // of where this thumbnail is mounted in the tree (filmstrip
      // tile, single-thumb 16:9 wrapper, or the BIG current preview).
      style={{ containerType: "size" }}
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
            width: `${SLIDE_DESIGN_WIDTH}px`,
            height: `${SLIDE_DESIGN_HEIGHT}px`,
            // (length / length) → unitless number, which is what
            // transform: scale() requires. CSS Values 4 spec.
            transform: `scale(calc(100cqw / ${SLIDE_DESIGN_WIDTH}px))`,
          }}
        >
          {/* `key={slideIndex}` forces a fresh React mount whenever the
              cursor moves to a different slide. Without it, React
              reconciles the inner subtree across slide changes, which:
                - leaves framer-motion variants in their last "animate"
                  state instead of re-running the entrance, and
                - leaves WebGL / R3F canvases mid-frame, sometimes black.
              The cf-code-mode cover slide hits both: its motion.div
              wrappers freeze at opacity 0 (initial state, never animated
              because parent reconciled instead of mounted), and the
              <Globe3D> canvas occasionally fails to redraw. Mounting
              fresh is cheap (these are thumbnails) and gives the
              "every visit looks like the first" semantics the deck
              authors wrote their entrance animations against. (Issue
              #111 item D.) */}
          <div
            key={slideIndex}
            className={`${inner} h-full w-full bg-cf-bg-100 text-cf-text`}
          >
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

function PresenterWindowInner({ deck }: PresenterWindowProps) {
  const { settings } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const visibleSlides = useMemo(
    () => deck.slides.filter((s) => !s.hidden),
    [deck.slides],
  );

  // Issue #122 — initial cursor comes from `?slide=N&phase=K` (priority)
  // → sessionStorage (shared with audience-side <Deck>, so a reload of
  // either window restores to the same position) → {0, 0}. Reuse the
  // exact resolver the audience side uses so the two windows agree on
  // initial-cursor priority.
  const initialCursor = useMemo<Cursor>(() => {
    const phasesPerSlide = visibleSlides.map((s) => s.phases ?? 0);
    return resolveInitialCursor(
      { slug: deck.meta.slug, phases: phasesPerSlide },
      {
        search: typeof window !== "undefined" ? window.location.search : "",
        storage:
          typeof window !== "undefined" ? window.sessionStorage : undefined,
      },
    );
    // Locked to first mount per the AGENTS convention "URL on mount only".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.meta.slug]);

  const [cursor, setCursor] = useState<Cursor>(initialCursor);

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

  // Issue #122 — mirror the cursor into the URL as `?slide=N&phase=K` so
  // the presenter window is reload-safe and deep-linkable. Same pattern
  // as the audience-side <Deck>: `history.replaceState` (NOT pushState)
  // so the browser Back button still means "leave the deck", not "step
  // backwards through reveals". Other query params (notably
  // `?presenter=1` itself) survive the rewrite.
  //
  // Note that we ALSO write the same key into sessionStorage as the
  // audience side (via the shared STORAGE_PREFIX in useDeckState), so
  // the two windows stay in sync via the `state` broadcast on top of
  // the URL/storage layers.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("slide", String(cursor.slide));
      url.searchParams.set("phase", String(cursor.phase));
      window.history.replaceState(window.history.state, "", url.toString());
      window.sessionStorage.setItem(
        `slide-of-hand-deck-cursor:${deck.meta.slug}`,
        JSON.stringify(cursor),
      );
    } catch {
      /* sandboxed iframes / private mode quotas — silently ignore */
    }
  }, [cursor.slide, cursor.phase, deck.meta.slug]);

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
      data-deck-slug={deck.meta.slug}
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
          onClick={() => setSettingsOpen(true)}
          data-testid="presenter-settings-toggle"
          data-interactive
          aria-label="Open presenter settings"
          title="Open settings"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-cf-border text-cf-text-muted transition-colors hover:border-dashed hover:text-cf-text"
        >
          <GearIcon size={13} />
        </button>
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
              data-presenter-tools-scope="true"
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

          {/* Bottom row — next preview + nav controls.
              16:9 enforcement (item C / #111): the wrapper uses container-
              query units so the next preview always fits cleanly regardless
              of container shape — see the matching comment on the current-
              slide preview above for the math.
              When the next slide is multi-phase AND the user's
              `presenterNextSlideShowsFinalPhase` setting is OFF, this area
              renders as a horizontal phase filmstrip instead of a single
              thumb (issue #113). */}
          <div className="flex min-h-0 flex-[2] gap-3">
            <div
              data-testid="presenter-next-preview-container"
              className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
              style={{ containerType: "size" }}
            >
              {/* For the FILMSTRIP branch we want each tile to size itself
                  via container queries against this outer 1-row band, so
                  we hand the band straight to <NextPreview>. The single-
                  thumb branches still render in a 16:9 frame; that frame
                  is computed inside <NextPreview> for the single-thumb
                  branches OR per-tile in the filmstrip branch. */}
              {(() => {
                const showsFinal = settings.presenterNextSlideShowsFinalPhase;
                // Mode A — current slide still has phases to reveal.
                // Show a filmstrip of the CURRENT slide so the presenter
                // can see how many reveals are left. Switches to Mode B
                // once we land on the last phase. Issue #115.
                const current = visibleSlides[cursor.slide];
                const currentPhaseCount = (current?.phases ?? 0) + 1;
                const inModeA =
                  !!current && cursor.phase < currentPhaseCount - 1;
                if (inModeA) {
                  return (
                    <CurrentSlideFilmstrip
                      deck={deck}
                      currentIndex={cursor.slide}
                      currentPhase={cursor.phase}
                      phaseCount={currentPhaseCount}
                      onJump={onJump}
                    />
                  );
                }
                // Mode B — current slide on its last phase (or single-
                // phase). Show the next-slide preview, governed by the
                // existing presenterNextSlideShowsFinalPhase setting.
                const next = visibleSlides[cursor.slide + 1];
                const phaseCount = (next?.phases ?? 0) + 1;
                const isFilmstripBranch =
                  !!next && !showsFinal && phaseCount > 1;
                if (isFilmstripBranch) {
                  // Filmstrip fills the full band; each tile is its own
                  // 16:9 frame.
                  return (
                    <NextPreview
                      deck={deck}
                      nextIndex={cursor.slide + 1}
                      showsFinalPhase={showsFinal}
                      onJump={onJump}
                    />
                  );
                }
                // Single-thumb branches keep the existing 16:9 frame.
                return (
                  <div
                    className="relative"
                    style={{
                      width: "min(100cqw, calc(100cqh * 16 / 9))",
                      height: "min(100cqh, calc(100cqw * 9 / 16))",
                    }}
                  >
                    <NextPreview
                      deck={deck}
                      nextIndex={cursor.slide + 1}
                      showsFinalPhase={showsFinal}
                      onJump={onJump}
                    />
                  </div>
                );
              })()}
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
              deckSlug={deck.meta.slug}
              slideIndex={cursor.slide}
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
      {/* Settings modal — opened by the gear button in the header. The
          modal lives inside <main> so it inherits the same SettingsProvider
          context and renders on top of the presenter UI when open. */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </main>
  );
}
