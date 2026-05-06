/**
 * Top-level deck viewer.
 *
 * Hosts:
 *   - navigation reducer (`useDeckState`)
 *   - keyboard shortcut handler
 *   - click-to-advance handler with `data-no-advance` / `data-interactive`
 *      opt-outs
 *   - dark/light theme toggle (`D` key) persisted to `localStorage`
 *   - overlays: Overview (`O`) and KeyboardHelp (`?` / `H`)
 *
 * The deck registry, the route, and the deck author all see this component as
 * the single mounting point. Slices #5+ extend it (presenter window broadcast,
 * tool overlays, fullscreen) by hooking into the same key handler / cursor.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { SlideDef } from "./types";
import { useDeckState } from "./useDeckState";
import { Slide } from "./Slide";
import { PhaseProvider } from "./PhaseContext";
import { Overview } from "./Overview";
import { KeyboardHelp } from "./KeyboardHelp";
import { ThemeSidebar } from "./ThemeSidebar";
import { useDeckTheme } from "./useDeckTheme";
import { SlideManager } from "./SlideManager";
import { useDeckManifest } from "./useDeckManifest";
import { useDeckAnalytics } from "./useDeckAnalytics";
import { mergeSlides } from "@/lib/manifest-merge";
import { usePresenterMode } from "@/framework/presenter/mode";
import { PresenterAffordances } from "@/framework/presenter/PresenterAffordances";
import { slideTransition } from "@/lib/motion";

const THEME_STORAGE_KEY = "slide-of-hand-theme";

export interface DeckProps {
  slug: string;
  title: string;
  slides: SlideDef[];
}

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage may be denied */
  }
  return "light";
}

/**
 * True if the click target (or any ancestor up to the slide root) opted out
 * of click-to-advance via `data-no-advance` or `data-interactive`. Also true
 * when the user is mid-text-selection, since clicking inside a selection is
 * almost always intentional content interaction.
 */
function shouldSuppressAdvance(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (window.getSelection()?.toString()) return true;
  // Native interactive elements receive their own click semantics.
  const interactive = target.closest(
    "[data-no-advance], [data-interactive], a, button, input, select, textarea, label, [contenteditable=true]",
  );
  return Boolean(interactive);
}

export function Deck({ slug, title, slides }: DeckProps) {
  // ── Per-deck slide manifest (issue #13 / Bucket B2) ─────────────────────
  // The manifest layers reorder + hidden + title + notes overrides on top
  // of the source slide list. Public viewers fetch + apply silently; the
  // <SlideManager> sidebar (admin only) edits + persists.
  const manifestHook = useDeckManifest(slug);
  const effectiveSlides = useMemo(
    () => mergeSlides(slides, manifestHook.applied),
    [slides, manifestHook.applied],
  );

  const visibleSlides = useMemo(
    () => effectiveSlides.filter((s) => !s.hidden),
    [effectiveSlides],
  );

  const deckShape = useMemo(
    () => ({
      slug,
      phases: visibleSlides.map((s) => s.phases ?? 0),
    }),
    [slug, visibleSlides],
  );

  const { cursor, total, next, prev, first, last, goto } =
    useDeckState(deckShape);

  // ── Theme ───────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage may be denied */
    }
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  // ── Per-deck theme override (issue #12 / Bucket B1) ────────────────────
  // Both public viewers and admin viewers fetch + apply on mount; the
  // sidebar that EDITS the override is gated by `usePresenterMode()` below.
  const themeOverride = useDeckTheme(slug);
  const presenterMode = usePresenterMode();

  // ── Per-deck analytics (issue #19 / Bucket C3) ─────────────────────────
  // Public + admin viewers both fire beacons; the author's own local
  // dev runs are silenced inside the hook via the `__PROJECT_ROOT__`
  // sentinel. No data identifies the audience — the session ID is a
  // per-tab UUID held in `sessionStorage`.
  const analytics = useDeckAnalytics(slug);

  // Track the previous slide ID + the timestamp it became active so we
  // can attribute durations correctly on advance. `prevSlideRef` starts
  // null so the very first cursor effect emits a `view` without a prior
  // `slide_advance` (no slide to attribute the duration to).
  const prevSlideRef = useRef<string | null>(null);
  const slideEnteredAtRef = useRef<number>(
    typeof performance !== "undefined" ? performance.now() : 0,
  );
  const prevPhaseRef = useRef<number>(0);

  // Wrap goto so any non-cursor-keyed jump (overview → N, slide footer
  // links) emits a `jump` beacon. We fire BEFORE goto updates the
  // cursor so the analytics module sees "jumped to slide N" as a
  // separate event from the implied `view` that follows.
  const gotoWithBeacon = useCallback(
    (targetSlide: number, phase?: number) => {
      const targetSlideDef = visibleSlides[targetSlide];
      if (targetSlideDef && targetSlideDef.id !== prevSlideRef.current) {
        analytics.trackJump(targetSlideDef.id);
      }
      goto(targetSlide, phase);
    },
    [goto, visibleSlides, analytics],
  );

  // ── Overlays ────────────────────────────────────────────────────────────
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [themeSidebarOpen, setThemeSidebarOpen] = useState(false);
  const [slideManagerOpen, setSlideManagerOpen] = useState(false);

  const closeOverlays = useCallback(() => {
    setOverviewOpen(false);
    setHelpOpen(false);
    setThemeSidebarOpen(false);
    setSlideManagerOpen(false);
  }, []);

  const toggleOverview = useCallback(() => {
    setOverviewOpen((wasOpen) => {
      const nowOpen = !wasOpen;
      // Only beacon the open transition (not the close), since the audience
      // may also press `O` to dismiss — that's not interesting to track.
      if (nowOpen) analytics.trackOverviewOpen();
      return nowOpen;
    });
    setHelpOpen(false);
    setThemeSidebarOpen(false);
    setSlideManagerOpen(false);
  }, [analytics]);

  const toggleHelp = useCallback(() => {
    setHelpOpen((h) => !h);
    setOverviewOpen(false);
    setThemeSidebarOpen(false);
    setSlideManagerOpen(false);
  }, []);

  const toggleThemeSidebar = useCallback(() => {
    setThemeSidebarOpen((o) => !o);
    setOverviewOpen(false);
    setHelpOpen(false);
    setSlideManagerOpen(false);
  }, []);

  const closeThemeSidebar = useCallback(() => {
    setThemeSidebarOpen(false);
  }, []);

  const toggleSlideManager = useCallback(() => {
    setSlideManagerOpen((o) => !o);
    setOverviewOpen(false);
    setHelpOpen(false);
    setThemeSidebarOpen(false);
  }, []);

  const closeSlideManager = useCallback(() => {
    setSlideManagerOpen(false);
    // Drop any in-flight draft so closing without saving reverts the
    // visible deck to the persisted manifest.
    manifestHook.clearDraft();
  }, [manifestHook]);

  // ── Keyboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore key events while focus sits on an interactive element. This is
      // how `data-interactive` opt-out works for keyboard nav: a focused input
      // / button / select gets to handle its own keys.
      const target = e.target as Element | null;
      if (
        target &&
        target.closest(
          "[data-interactive], input, select, textarea, [contenteditable=true]",
        )
      ) {
        return;
      }

      // Modifier-bearing keystrokes are reserved for the browser / OS (cmd-r,
      // ctrl-shift-i, etc.). The deck consumes plain key events only.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
        case "Enter":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "PageUp":
        case "Backspace":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          first();
          break;
        case "End":
          e.preventDefault();
          last();
          break;
        case "o":
        case "O":
          e.preventDefault();
          toggleOverview();
          break;
        case "?":
        case "h":
        case "H":
          e.preventDefault();
          toggleHelp();
          break;
        case "d":
        case "D":
          e.preventDefault();
          toggleTheme();
          break;
        case "t":
        case "T":
          // Theme override sidebar — admin (presenter mode) only.
          if (presenterMode) {
            e.preventDefault();
            toggleThemeSidebar();
          }
          break;
        case "m":
        case "M":
          // Slide manifest manager — admin (presenter mode) only.
          if (presenterMode) {
            e.preventDefault();
            toggleSlideManager();
          }
          break;
        case "f":
        case "F":
          e.preventDefault();
          if (document.fullscreenElement) {
            void document.exitFullscreen();
          } else {
            void document.documentElement.requestFullscreen?.().catch(() => {
              /* ignore — fullscreen may be denied */
            });
          }
          break;
        case "Escape":
          if (overviewOpen || helpOpen || themeSidebarOpen || slideManagerOpen) {
            e.preventDefault();
            closeOverlays();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    next,
    prev,
    first,
    last,
    toggleOverview,
    toggleHelp,
    toggleTheme,
    toggleThemeSidebar,
    toggleSlideManager,
    presenterMode,
    overviewOpen,
    helpOpen,
    themeSidebarOpen,
    slideManagerOpen,
    closeOverlays,
  ]);

  // ── Click-to-advance ────────────────────────────────────────────────────
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const onSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (overviewOpen || helpOpen || themeSidebarOpen || slideManagerOpen)
        return;
      if (shouldSuppressAdvance(e.target)) return;
      // Right-click / middle-click should never advance.
      if (e.button !== 0) return;
      next();
    },
    [next, overviewOpen, helpOpen, themeSidebarOpen, slideManagerOpen],
  );

  const slide = visibleSlides[cursor.slide];

  // Update document title for each slide; nice to have for tabs.
  useEffect(() => {
    if (typeof document !== "undefined") {
      const slideTitle = slide?.title || slide?.id;
      document.title = slideTitle ? `${title} · ${slideTitle}` : title;
    }
  }, [title, slide]);

  // Analytics — fire beacons on cursor changes. We split slide / phase
  // so a phase reveal does not also count as a slide advance.
  useEffect(() => {
    if (!slide) return;
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const prevSlideId = prevSlideRef.current;
    if (prevSlideId !== slide.id) {
      const durationMs =
        prevSlideId === null ? 0 : Math.max(0, now - slideEnteredAtRef.current);
      analytics.trackSlideAdvance(prevSlideId, slide.id, durationMs);
      prevSlideRef.current = slide.id;
      slideEnteredAtRef.current = now;
      prevPhaseRef.current = cursor.phase;
    } else if (cursor.phase !== prevPhaseRef.current) {
      // Phase change within the same slide.
      if (cursor.phase > prevPhaseRef.current) {
        analytics.trackPhaseAdvance(slide.id, cursor.phase);
      }
      prevPhaseRef.current = cursor.phase;
    }
  }, [slide, cursor.phase, analytics]);

  if (!slide) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-cf-bg-100 text-cf-text"
        role="alert"
      >
        <p className="cf-tag">Empty deck</p>
      </div>
    );
  }

  // 16:9 viewport. The deck always fills the available height / width and
  // letterboxes if the host is the wrong shape.
  const viewportStyle: CSSProperties = {
    aspectRatio: "16 / 9",
  };

  return (
    <div
      ref={surfaceRef}
      data-deck-slug={slug}
      onClick={onSurfaceClick}
      className="relative flex h-screen min-h-screen w-screen items-center justify-center overflow-hidden bg-cf-bg-200 dark:bg-cf-bg-200"
    >
      <div
        className="relative h-full w-full max-h-screen max-w-[100vw] shadow-[0_0_0_1px_var(--color-cf-border)]"
        style={viewportStyle}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={cursor.slide}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={slideTransition}
            className="absolute inset-0"
          >
            <PhaseProvider phase={cursor.phase}>
              <Slide
                slide={slide}
                index={cursor.slide}
                total={total}
                phase={cursor.phase}
                onJump={(i) => gotoWithBeacon(i)}
              >
                {slide.render({ phase: cursor.phase })}
              </Slide>
            </PhaseProvider>
          </motion.div>
        </AnimatePresence>

        <Overview
          open={overviewOpen}
          slug={slug}
          slides={visibleSlides}
          current={cursor.slide}
          onJump={(i) => gotoWithBeacon(i)}
          onClose={closeOverlays}
        />
        <KeyboardHelp open={helpOpen} onClose={closeOverlays} />
        {presenterMode && (
          <ThemeSidebar
            open={themeSidebarOpen}
            slug={slug}
            theme={themeOverride}
            onClose={closeThemeSidebar}
          />
        )}
        {presenterMode && (
          <SlideManager
            open={slideManagerOpen}
            slug={slug}
            sourceSlides={slides}
            manifest={manifestHook}
            onClose={closeSlideManager}
          />
        )}
        <PresenterAffordances />
      </div>
    </div>
  );
}
