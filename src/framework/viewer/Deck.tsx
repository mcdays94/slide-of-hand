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
import { PresenterAffordances } from "@/framework/presenter/PresenterAffordances";
import { slideTransition } from "@/lib/motion";

const THEME_STORAGE_KEY = "reaction-theme";

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
  const visibleSlides = useMemo(
    () => slides.filter((s) => !s.hidden),
    [slides],
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

  // ── Overlays ────────────────────────────────────────────────────────────
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const closeOverlays = useCallback(() => {
    setOverviewOpen(false);
    setHelpOpen(false);
  }, []);

  const toggleOverview = useCallback(() => {
    setOverviewOpen((o) => !o);
    setHelpOpen(false);
  }, []);

  const toggleHelp = useCallback(() => {
    setHelpOpen((h) => !h);
    setOverviewOpen(false);
  }, []);

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
          if (overviewOpen || helpOpen) {
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
    overviewOpen,
    helpOpen,
    closeOverlays,
  ]);

  // ── Click-to-advance ────────────────────────────────────────────────────
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const onSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (overviewOpen || helpOpen) return;
      if (shouldSuppressAdvance(e.target)) return;
      // Right-click / middle-click should never advance.
      if (e.button !== 0) return;
      next();
    },
    [next, overviewOpen, helpOpen],
  );

  const slide = visibleSlides[cursor.slide];

  // Update document title for each slide; nice to have for tabs.
  useEffect(() => {
    if (typeof document !== "undefined") {
      const slideTitle = slide?.title || slide?.id;
      document.title = slideTitle ? `${title} · ${slideTitle}` : title;
    }
  }, [title, slide]);

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
                onJump={(i) => goto(i)}
              >
                {slide.render({ phase: cursor.phase })}
              </Slide>
            </PhaseProvider>
          </motion.div>
        </AnimatePresence>

        <Overview
          open={overviewOpen}
          slides={visibleSlides}
          current={cursor.slide}
          onJump={(i) => goto(i)}
          onClose={closeOverlays}
        />
        <KeyboardHelp open={helpOpen} onClose={closeOverlays} />
        <PresenterAffordances />
      </div>
    </div>
  );
}
