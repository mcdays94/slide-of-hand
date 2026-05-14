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
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import type { SlideDef } from "./types";
import { useDeckState } from "./useDeckState";
import { Slide } from "./Slide";
import { PhaseProvider } from "./PhaseContext";
import { Overview } from "./Overview";
import { KeyboardHelp } from "./KeyboardHelp";
import { SettingsModal } from "./SettingsModal";
import { SettingsProvider } from "./useSettings";
import { ThemeSidebar } from "./ThemeSidebar";
import { TopToolbar } from "./TopToolbar";
import { useDeckTheme } from "./useDeckTheme";
import { SlideManager } from "./SlideManager";
import { ToCEdgeHandle } from "./ToCEdgeHandle";
import { useToCEdgeHover } from "./useToCEdgeHover";
import { useDeckManifest } from "./useDeckManifest";
import { useDeckAnalytics } from "./useDeckAnalytics";
import {
  ElementInspector,
  buildSelectionLabel,
  type InspectorSelection,
} from "./ElementInspector";
import { SelectionOverlay } from "./SelectionOverlay";
import {
  useElementOverrides,
  type ElementOverride,
} from "./useElementOverrides";
import { computeSelector, fingerprint, findBySelector } from "@/lib/element-selector";
import { mergeSlides } from "@/lib/manifest-merge";
import { findNextNonHiddenSlide } from "./findNextNonHiddenSlide";
import { usePresenterMode } from "@/framework/presenter/mode";
import { PresenterAffordances } from "@/framework/presenter/PresenterAffordances";
import { PresenterTools } from "@/framework/tools/PresenterTools";
import type { ActiveTool } from "@/framework/tools/ToolActivePill";
import { AudienceToolMirror } from "@/framework/tools/AudienceToolMirror";
import { slideTransition } from "@/lib/motion";

/**
 * Lazy-loaded in-Studio AI chat panel (issue #131 phase 1).
 *
 * Same pattern as `EditMode`'s lazy mount in `src/framework/editor/EditMode.tsx`:
 * the audience-side / public deck route never opens this panel and shouldn't
 * pay for the ~300 KB of chat / streaming SDK deps. Admin presenter-mode
 * routes can open it via the `<StudioAgentToggle>` in `<TopToolbar>`.
 */
const StudioAgentPanel = lazy(() =>
  import("@/components/StudioAgentPanel").then((m) => ({
    default: m.StudioAgentPanel,
  })),
);

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
 * Two overrides identify the SAME entry iff they share `(slideId,
 * selector)`. Used by the diff-based live applier to compute add/remove
 * deltas across `applied` changes.
 *
 * Exported for unit-testing the diff helpers in isolation (#54).
 */
export function sameOverrideKey(
  a: ElementOverride,
  b: ElementOverride,
): boolean {
  return a.slideId === b.slideId && a.selector === b.selector;
}

/**
 * Live-DOM apply: locate the override's target element under
 * `slideRoot` and swap each `from` class for its `to`. No-op if the
 * element isn't found (the override's slide isn't currently mounted)
 * or the `from` class is already absent (already swapped).
 *
 * Exported for unit-testing the diff helpers in isolation (#54).
 */
export function applyOverride(slideRoot: Element, ov: ElementOverride): void {
  const found = findBySelector(slideRoot, ov.selector, ov.fingerprint);
  if (found.status !== "matched" || !found.el) return;
  for (const swap of ov.classOverrides) {
    if (found.el.classList.contains(swap.from)) {
      found.el.classList.replace(swap.from, swap.to);
    } else if (!found.el.classList.contains(swap.to)) {
      // Source class not present (already swapped, or external
      // mutation) — additive add so the override still lands.
      found.el.classList.add(swap.to);
    }
  }
}

/**
 * Live-DOM revert: locate the override's target element under
 * `slideRoot` and swap each `to` class BACK to its `from`. Used by
 * the diff applier when an override has been removed from the
 * applied list (per-row × in the inspector list view, or
 * "Clear all orphaned" — #54).
 *
 * Note: we use the override's stored `fingerprint` for lookup. After
 * an apply, the live element's text fingerprint is unchanged (we
 * only mutate classes), so the fingerprint check still passes here
 * even though one of its classes has flipped.
 *
 * Exported for unit-testing the diff helpers in isolation (#54).
 */
export function revertOverride(slideRoot: Element, ov: ElementOverride): void {
  const found = findBySelector(slideRoot, ov.selector, ov.fingerprint);
  if (found.status !== "matched" || !found.el) return;
  for (const swap of ov.classOverrides) {
    if (found.el.classList.contains(swap.to)) {
      found.el.classList.replace(swap.to, swap.from);
    } else if (!found.el.classList.contains(swap.from)) {
      // Defensive: external mutation already removed `to`. Restore
      // `from` so the element doesn't end up with neither class.
      found.el.classList.add(swap.from);
    }
  }
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
  // ── Edit-mode toggle (Slice 6 / #62) ────────────────────────────────────
  // The `R` key flips `?edit=1` on the URL, but ONLY when the route is
  // `/admin/decks/<slug>` (build-time decks aren't editable in Slice 6,
  // and the public viewer should never enter edit mode). The route
  // component (`admin/decks.$slug.tsx`) consumes `?edit=1` to mount
  // `<EditMode>` — this hook just toggles the query param.
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminDeckRoute = /^\/admin\/decks\/[^/]+\/?$/.test(location.pathname);

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

  // Per ADR 0003, `useDeckState`'s cursor is keyed on **effective
  // slides** (Hidden included) rather than **visible slides**. The
  // audience render path still derives `visibleSlides` for the rendered
  // viewport and audience ToC row list — see below — but Sequential nav
  // state walks the full effective list and skips Hidden internally via
  // `findNextNonHiddenSlide`.
  const deckShape = useMemo(
    () => ({
      slug,
      slides: effectiveSlides.map((s) => ({
        phases: s.phases ?? 0,
        hidden: s.hidden,
      })),
    }),
    [slug, effectiveSlides],
  );

  const { cursor, total, next, prev, first, last, goto } =
    useDeckState(deckShape);

  const slide = effectiveSlides[cursor.slide];

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

  // ── Audience deep-link clamp (#209) ────────────────────────────────────
  // Per ADR 0003 the URL `?slide=N` indexes into effective slides, so a
  // handcrafted deep link can land on a Hidden slide. Admins want this
  // (ToC nav to a hidden slide for Q&A). Audiences shouldn't see it.
  //
  // When the initial cursor for an audience viewer points at a Hidden
  // slide, scan forward via `findNextNonHiddenSlide` (then backward as
  // fallback, then to index 0 if both yield null) and silently `goto`
  // the clamped index. Fires AT MOST ONCE per mount — once the audience
  // is steered onto a visible slide we leave the cursor alone so
  // subsequent navigation isn't fought.
  const clampedOnceRef = useRef(false);
  useEffect(() => {
    if (presenterMode) return; // admin can navigate to hidden slides
    if (clampedOnceRef.current) return;
    if (effectiveSlides.length === 0) return;
    const current = effectiveSlides[cursor.slide];
    if (!current?.hidden) {
      // Nothing to clamp — mark done so we don't fire later when an
      // unrelated cursor change happens to land on a hidden slide.
      clampedOnceRef.current = true;
      return;
    }
    const fwd = findNextNonHiddenSlide(effectiveSlides, cursor.slide, 1);
    const back = fwd === null
      ? findNextNonHiddenSlide(effectiveSlides, cursor.slide, -1)
      : null;
    const clamped = fwd ?? back ?? 0;
    clampedOnceRef.current = true;
    // eslint-disable-next-line no-console
    console.warn(`[deck] requested slide is hidden; clamped to ${clamped}`);
    goto(clamped);
  }, [presenterMode, effectiveSlides, cursor.slide, goto]);

  // ── Per-deck element overrides (issue #14 / Slice 3, #45) ──────────────
  // Both public + admin viewers fetch + apply: the audience also sees a
  // saved class swap. The inspector that AUTHORS overrides is gated to
  // presenter mode.
  const elementOverrides = useElementOverrides(slug);

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

  // ToC nav from `<SlideManager>`: takes an **effective**-slides index
  // (Hidden slides included) and jumps the deck cursor there. Per
  // ADR 0003, `goto(N)` is keyed against effectiveSlides, so this
  // lands on a Hidden slide without un-hiding it — admin can pull up
  // a supporting slide during audience Q&A.
  const gotoEffectiveWithBeacon = useCallback(
    (effectiveIndex: number) => {
      const targetSlideDef = effectiveSlides[effectiveIndex];
      if (targetSlideDef && targetSlideDef.id !== prevSlideRef.current) {
        analytics.trackJump(targetSlideDef.id);
      }
      goto(effectiveIndex);
    },
    [goto, effectiveSlides, analytics],
  );

  // ── Overlays ────────────────────────────────────────────────────────────
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [themeSidebarOpen, setThemeSidebarOpen] = useState(false);
  const [slideManagerOpen, setSlideManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // ── ToC sidebar edge (#210) ───────────────────────────────────────────
  // Which side the sidebar anchors to when it opens. Default `"right"`
  // matches the prior single-side behaviour; clicking a left-edge handle
  // (added below) flips this to `"left"` before opening. The per-user
  // `tocSidebarEdge` preference that lets the audience pick a default
  // lands in the next slice (#211).
  const [sidebarSide, setSidebarSide] = useState<"left" | "right">("right");
  // ── Active presenter tool (#210) ──────────────────────────────────────
  // Mirrored from `<PresenterTools>` via `onActiveToolChange`. Used to
  // suppress the ToC edge handles while a laser / magnifier / marker
  // overlay is engaged — the floating chrome would compete with the
  // overlay cursor.
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  // ── Fullscreen mirror (#210) ──────────────────────────────────────────
  // Used by `useToCEdgeHover` to tighten the proximity threshold so
  // sub-pixel browser quirks don't flicker the handle during a
  // fullscreen talk.
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── In-Studio AI agent (#131 phase 1) ──────────────────────────────────
  // Toggled from `<TopToolbar>`'s right cluster (visible only in
  // presenter / admin mode). State lives here so the lazy
  // `<StudioAgentPanel>` mount sits adjacent to the toolbar, sharing
  // the deck's `slug` for the agent instance name.
  const [agentOpen, setAgentOpen] = useState(false);

  // ── Element inspector (#45) ─────────────────────────────────────────────
  // `inspectMode` true = clicks select instead of advancing; cursor is
  // crosshair via the `data-inspect-mode` attribute on the deck root.
  // `inspectorOpen` true = sidebar is mounted; we keep them separate so
  // the sidebar can stay open while the user clicks around to swap
  // selections without re-pressing `I`.
  const [inspectMode, setInspectMode] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selection, setSelection] = useState<InspectorSelection | null>(null);
  // ── Pending row-click selection (#53) ──────────────────────────────────
  // When the user clicks an override row in the inspector list, we
  // store the override here AND call gotoWithBeacon. After the slide
  // mounts (one rAF later), an effect consumes pendingSelection by
  // running findBySelector against the new slide root — if it matches,
  // we synthesise selection state; if not, we surface a notice.
  const [pendingSelection, setPendingSelection] =
    useState<ElementOverride | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  const closeOverlays = useCallback(() => {
    setOverviewOpen(false);
    setHelpOpen(false);
    setThemeSidebarOpen(false);
    setSlideManagerOpen(false);
    setSettingsOpen(false);
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
    setSettingsOpen(false);
  }, [analytics]);

  const toggleHelp = useCallback(() => {
    setHelpOpen((h) => !h);
    setOverviewOpen(false);
    setThemeSidebarOpen(false);
    setSlideManagerOpen(false);
    setSettingsOpen(false);
  }, []);

  const toggleThemeSidebar = useCallback(() => {
    setThemeSidebarOpen((o) => !o);
    setOverviewOpen(false);
    setHelpOpen(false);
    setSlideManagerOpen(false);
    setSettingsOpen(false);
  }, []);

  const closeThemeSidebar = useCallback(() => {
    setThemeSidebarOpen(false);
  }, []);

  const toggleSlideManager = useCallback(() => {
    setSlideManagerOpen((o) => !o);
    setOverviewOpen(false);
    setHelpOpen(false);
    setThemeSidebarOpen(false);
    setSettingsOpen(false);
  }, []);

  const closeSlideManager = useCallback(() => {
    setSlideManagerOpen(false);
    // Drop any in-flight draft so closing without saving reverts the
    // visible deck to the persisted manifest.
    manifestHook.clearDraft();
  }, [manifestHook]);

  const toggleSettings = useCallback(() => {
    setSettingsOpen((o) => !o);
    setOverviewOpen(false);
    setHelpOpen(false);
    setThemeSidebarOpen(false);
    setSlideManagerOpen(false);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  // ── ToC edge handles (#210) ───────────────────────────────────────────
  // Aggregate the suppression flags for the proximity hook. We INCLUDE
  // `inspectorOpen` (right-side admin sidebar) and `slideManagerOpen`
  // via the dedicated `sidebarOpen` arg — the latter is named
  // explicitly so the hook can document its semantics, even though
  // it's structurally just another "something occupies the edge"
  // flag. `slideManagerOpen` is intentionally NOT folded into
  // `anyModalOpen` here for the same reason.
  const anyModalOpen =
    overviewOpen ||
    helpOpen ||
    settingsOpen ||
    themeSidebarOpen ||
    inspectorOpen;
  const { leftHover, rightHover } = useToCEdgeHover({
    toolActive: activeTool !== null,
    modalOpen: anyModalOpen,
    sidebarOpen: slideManagerOpen,
    fullscreen,
  });

  // Open the sidebar from the matching edge. Anchors `sidebarSide` to
  // the clicked side BEFORE flipping `slideManagerOpen`, so the
  // `<SlideManager>` mounts with the correct positioning on first
  // paint (no left-then-right pop). Other overlays are closed so the
  // sidebar has the edge to itself.
  const openSidebarFromSide = useCallback((side: "left" | "right") => {
    setSidebarSide(side);
    setSlideManagerOpen(true);
    setOverviewOpen(false);
    setHelpOpen(false);
    setThemeSidebarOpen(false);
    setSettingsOpen(false);
  }, []);

  const toggleInspector = useCallback(() => {
    setInspectMode((m) => {
      const next = !m;
      // Opening inspect mode also opens the sidebar (empty state). Closing
      // inspect mode closes the sidebar and discards any in-flight draft.
      if (next) {
        setInspectorOpen(true);
        // Close the other admin overlays so the sidebar has the right edge.
        setOverviewOpen(false);
        setHelpOpen(false);
        setThemeSidebarOpen(false);
        setSlideManagerOpen(false);
        setSettingsOpen(false);
      } else {
        setInspectorOpen(false);
        setSelection(null);
        setPendingSelection(null);
        setSelectionNotice(null);
        elementOverrides.clearDraft();
      }
      return next;
    });
  }, [elementOverrides]);

  const closeInspector = useCallback(() => {
    setInspectMode(false);
    setInspectorOpen(false);
    setSelection(null);
    setPendingSelection(null);
    setSelectionNotice(null);
    elementOverrides.clearDraft();
  }, [elementOverrides]);

  // ── Keyboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore key events while focus sits on an interactive element. This is
      // how `data-interactive` opt-out works for keyboard nav: a focused input
      // / button / select gets to handle its own keys.
      //
      // `e.target` may be `Window` (e.g. for `window.dispatchEvent(new
      // KeyboardEvent(...))` calls). Window has no `.closest()`, so we must
      // narrow with `instanceof Element` before invoking — otherwise the
      // handler throws and silently swallows downstream keys.
      const target = e.target;
      if (
        target instanceof Element &&
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
          // ToC sidebar — opens for BOTH roles (#209). Audience gets a
          // read-only `[NN] [thumb] title` list with Hidden slides
          // filtered out; admin gets the full editing surface. The
          // `<SlideManager>` itself branches on `role` internally.
          e.preventDefault();
          toggleSlideManager();
          break;
        case "i":
        case "I":
          // Element inspector — admin (presenter mode) only.
          if (presenterMode) {
            e.preventDefault();
            toggleInspector();
          }
          break;
        case "s":
        case "S":
          // Settings modal — public + admin both, since settings are
          // per-browser preferences.
          e.preventDefault();
          toggleSettings();
          break;
        case "r":
        case "R":
          // Toggle edit mode — admin deck route only. Slice 6 / #62.
          // Only KV-backed decks can enter edit mode; the route
          // component decides whether `?edit=1` mounts `<EditMode>`
          // or falls through to `<Deck>` (e.g. for build-time decks).
          if (isAdminDeckRoute) {
            e.preventDefault();
            const params = new URLSearchParams(location.search);
            if (params.get("edit") === "1") {
              params.delete("edit");
            } else {
              params.set("edit", "1");
            }
            const qs = params.toString();
            navigate(
              `${location.pathname}${qs ? `?${qs}` : ""}`,
              { replace: false },
            );
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
          if (inspectMode || inspectorOpen) {
            e.preventDefault();
            closeInspector();
          } else if (
            overviewOpen ||
            helpOpen ||
            themeSidebarOpen ||
            slideManagerOpen ||
            settingsOpen
          ) {
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
    toggleSettings,
    toggleInspector,
    closeInspector,
    presenterMode,
    overviewOpen,
    helpOpen,
    themeSidebarOpen,
    slideManagerOpen,
    settingsOpen,
    inspectMode,
    inspectorOpen,
    closeOverlays,
    isAdminDeckRoute,
    location.pathname,
    location.search,
    navigate,
  ]);

  // ── Click-to-advance ────────────────────────────────────────────────────
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const onSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // ── Inspect mode (#45) ─────────────────────────────────────────────
      // In inspect mode every click on the slide subtree selects an
      // element instead of advancing. We branch BEFORE the suppress check
      // so clicks on `<a>` / `<button>` inside slide content are ALSO
      // capturable — those are exactly the kinds of element an author
      // wants to recolor mid-talk.
      if (inspectMode) {
        if (!(e.target instanceof Element)) return;
        // Don't capture clicks on the inspector sidebar itself or any
        // other admin chrome flagged with `data-no-advance` /
        // `data-interactive` OUTSIDE the slide subtree.
        const slideRoot = e.target.closest("[data-slide-index]");
        if (!slideRoot) return;
        // Right-click / middle-click do not select either.
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.target;
        try {
          const sel = computeSelector(el, slideRoot);
          const fp = fingerprint(el);
          const slideId = slide?.id ?? "";
          if (!slideId) return;
          setSelection({
            element: el,
            slideId,
            selector: sel,
            fingerprint: fp,
          });
          // The user manually selected something — any pending
          // row-click navigation is now stale, and any prior
          // notice ("element no longer found") no longer applies.
          setPendingSelection(null);
          setSelectionNotice(null);
          setInspectorOpen(true);
        } catch {
          /* element not under slideRoot — silently ignore */
        }
        return;
      }

      if (
        overviewOpen ||
        helpOpen ||
        themeSidebarOpen ||
        slideManagerOpen ||
        settingsOpen ||
        inspectorOpen
      )
        return;
      if (shouldSuppressAdvance(e.target)) return;
      // Right-click / middle-click should never advance.
      if (e.button !== 0) return;
      next();
    },
    [
      next,
      overviewOpen,
      helpOpen,
      themeSidebarOpen,
      slideManagerOpen,
      settingsOpen,
      inspectMode,
      inspectorOpen,
      slide,
    ],
  );

  // Update document title for each slide; nice to have for tabs.
  useEffect(() => {
    if (typeof document !== "undefined") {
      const slideTitle = slide?.title || slide?.id;
      document.title = slideTitle ? `${title} · ${slideTitle}` : title;
    }
  }, [title, slide]);

  // ── Apply / revert element overrides on diff (#45 + #54) ───────────────
  // Diff-based applier: tracks the previously-applied list in a ref so
  // each `applied` change can compute additions vs removals and only
  // mutate the DOM for the delta.
  //
  // Semantics:
  //   - For overrides newly REMOVED from `applied`: swap each `to` →
  //     `from` on the live element so the live DOM reverts immediately
  //     (#54 — without this the element keeps its swapped class until
  //     the slide remounts).
  //   - For overrides newly ADDED to `applied`: swap each `from` → `to`
  //     so the apply behaviour from slice 3 still holds.
  //   - For overrides present in both: do nothing — already applied.
  //
  // The ref carries overrides for ALL slides, not just the currently-
  // mounted one. When `findBySelector` can't locate an element (because
  // its slide isn't in the DOM right now), `applyOverride` /
  // `revertOverride` simply no-op. That's intentional: when the user
  // navigates to a different slide, the new slide's overrides are NOT
  // in `prev` (assuming this is the first time we've seen them on that
  // slide root) and they get applied via the "newly added" branch.
  //
  // ── Slide-change retry ─────────────────────────────────────────────
  // `<AnimatePresence mode="wait">` runs the OUTGOING slide's exit
  // animation (~350ms) BEFORE mounting the incoming slide. A single
  // `requestAnimationFrame` fires too early — the new slide's DOM
  // doesn't exist yet, so `querySelector` returns null and the
  // applier silently no-ops. To bridge that gap we retry on each
  // animation frame for up to ~30 frames (~500ms; longer than the
  // transition duration) and run the applier as soon as the
  // `[data-slide-index]` for the current cursor appears.
  const prevAppliedRef = useRef<ElementOverride[]>([]);
  useEffect(() => {
    if (!slide) return;
    if (typeof document === "undefined") return;

    let cancelled = false;
    let frameHandle = 0;
    // Bound the retry by elapsed time so frame-rate throttling
    // (background tabs, headless test runners) doesn't curtail the
    // wait below the AnimatePresence exit duration (~350ms).
    const startedAt = performance.now();
    const MAX_WAIT_MS = 1500;

    const tick = () => {
      if (cancelled) return;
      const slideRoot = document.querySelector(
        `[data-slide-index="${cursor.slide}"]`,
      );
      if (!slideRoot) {
        if (performance.now() - startedAt < MAX_WAIT_MS) {
          frameHandle = window.requestAnimationFrame(tick);
        }
        return;
      }
      const prev = prevAppliedRef.current;
      const curr = elementOverrides.applied;

      // Newly REMOVED — revert live class swaps.
      for (const ov of prev) {
        if (!curr.some((c) => sameOverrideKey(c, ov))) {
          revertOverride(slideRoot, ov);
        }
      }
      // Newly ADDED — apply live class swaps.
      for (const ov of curr) {
        if (!prev.some((p) => sameOverrideKey(p, ov))) {
          applyOverride(slideRoot, ov);
        }
      }
      // Slide change: ensure overrides for the newly-mounted slide are
      // applied even if they were already in `prev` (the previous
      // application was against a different slide root and didn't take
      // — `findBySelector` returned null). Idempotent: `applyOverride`
      // is a no-op if the `from` class isn't present and the `to` is.
      for (const ov of curr) {
        if (ov.slideId === slide.id) {
          applyOverride(slideRoot, ov);
        }
      }

      prevAppliedRef.current = curr;
    };

    frameHandle = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameHandle);
    };
  }, [slide, cursor.slide, elementOverrides.applied]);

  // ── Pending row-click selection consumer (#53) ─────────────────────────
  // When inspector dispatches a row-click navigation, we set
  // `pendingSelection` and let `gotoWithBeacon` flip the cursor. Once
  // the new slide is the visible one, defer to a rAF retry loop so
  // AnimatePresence's mode="wait" exit-then-enter has a chance to
  // mount the new slide root, then locate the element via
  // `findBySelector` and synthesise the inspector selection state.
  // Same retry policy as the live applier — see comment there.
  useEffect(() => {
    if (!pendingSelection) return;
    if (!slide) return;
    if (slide.id !== pendingSelection.slideId) return; // wait for the cursor
    if (typeof document === "undefined") return;

    let cancelled = false;
    let frameHandle = 0;
    // Bound by elapsed time — see live-applier comment above.
    const startedAt = performance.now();
    const MAX_WAIT_MS = 1500;

    const tick = () => {
      if (cancelled) return;
      const slideRoot = document.querySelector(
        `[data-slide-index="${cursor.slide}"]`,
      );
      if (!slideRoot) {
        if (performance.now() - startedAt < MAX_WAIT_MS) {
          frameHandle = window.requestAnimationFrame(tick);
          return;
        }
        // Gave up — the new slide never mounted. Drop pending so we
        // don't loop forever, and surface a notice so the user
        // understands the click did something.
        setPendingSelection(null);
        setSelectionNotice(
          "Couldn't find that slide — try reloading and selecting again.",
        );
        return;
      }
      const found = findBySelector(
        slideRoot,
        pendingSelection.selector,
        pendingSelection.fingerprint,
      );
      if (found.status === "matched" && found.el) {
        setSelection({
          element: found.el,
          slideId: pendingSelection.slideId,
          selector: pendingSelection.selector,
          fingerprint: pendingSelection.fingerprint,
        });
        setSelectionNotice(null);
      } else {
        // Orphaned / missing — keep the user on the slide but explain
        // the situation. The notice is cleared on next manual select
        // or close.
        setSelection(null);
        setSelectionNotice(
          "Element no longer found on this slide — review or delete the override.",
        );
      }
      setPendingSelection(null);
    };

    frameHandle = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameHandle);
    };
  }, [pendingSelection, slide, cursor.slide]);

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
      <SettingsProvider>
        <div
          className="flex min-h-screen items-center justify-center bg-cf-bg-100 text-cf-text"
          role="alert"
        >
          <p className="cf-tag">Empty deck</p>
        </div>
      </SettingsProvider>
    );
  }

  // 16:9 viewport. The deck always fills the available height / width and
  // letterboxes if the host is the wrong shape.
  const viewportStyle: CSSProperties = {
    aspectRatio: "16 / 9",
  };

  return (
    <SettingsProvider>
    <div
      ref={surfaceRef}
      data-deck-slug={slug}
      data-inspect-mode={inspectMode ? "true" : undefined}
      onClick={onSurfaceClick}
      className={`relative flex h-screen min-h-screen w-screen items-center justify-center overflow-hidden bg-cf-bg-200 dark:bg-cf-bg-200 ${
        inspectMode ? "cursor-crosshair" : ""
      }`}
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
        <SettingsModal open={settingsOpen} onClose={closeSettings} />
        {presenterMode && (
          <ThemeSidebar
            open={themeSidebarOpen}
            slug={slug}
            theme={themeOverride}
            onClose={closeThemeSidebar}
          />
        )}
        {/* ToC sidebar — mounted for BOTH roles (#209). The component
            branches internally on `role`: admin gets the full editing
            surface from #207/#208 (drag, hide, rename, notes), audience
            gets a read-only `[NN] [thumb] title` list with Hidden slides
            filtered out. */}
        <SlideManager
          open={slideManagerOpen}
          slug={slug}
          sourceSlides={slides}
          manifest={manifestHook}
          onClose={closeSlideManager}
          onNavigateToSlide={gotoEffectiveWithBeacon}
          role={presenterMode ? "admin" : "audience"}
          side={sidebarSide}
        />

        {/* Floating ToC edge handles (#210). Fade in when the cursor
            is within 12 px of the left/right viewport edge AND no
            suppression flag (active tool, modal open, sidebar
            already open, fullscreen-not-at-edge) is set. Clicking
            opens the ToC sidebar from the matching side. */}
        <ToCEdgeHandle
          visible={leftHover}
          side="left"
          onClick={() => openSidebarFromSide("left")}
        />
        <ToCEdgeHandle
          visible={rightHover}
          side="right"
          onClick={() => openSidebarFromSide("right")}
        />

        {presenterMode && (
          <ElementInspector
            open={inspectorOpen}
            slug={slug}
            selection={selection}
            applied={elementOverrides.applied}
            appliedWithStatus={elementOverrides.appliedWithStatus}
            onApplyDraft={elementOverrides.applyDraft}
            onClearDraft={elementOverrides.clearDraft}
            onSave={elementOverrides.save}
            onRemoveOne={elementOverrides.removeOne}
            onClearOrphaned={elementOverrides.clearOrphaned}
            selectionNotice={selectionNotice}
            onNavigate={(override) => {
              // Slice 5 (#47) + #53: clicking an override row in the
              // list view jumps the deck to that slide AND queues an
              // auto-select so the inspector lands with the matching
              // element selected. Resolves slideId → index against the
              // current visible slides; if the slide is hidden by the
              // manifest or removed entirely, the navigate is a no-op
              // (the row stays visible in the list until the user
              // removes it).
              const targetIndex = visibleSlides.findIndex(
                (s) => s.id === override.slideId,
              );
              if (targetIndex === -1) {
                // Slide isn't in the deck right now — surface a notice
                // so the user understands why the click didn't move
                // them anywhere.
                setPendingSelection(null);
                setSelectionNotice(
                  "Slide is hidden or no longer in this deck — review or delete the override.",
                );
                return;
              }
              // Clear any prior selection / notice so the post-mount
              // effect renders a clean state, then queue the pending
              // selection. If we're already on the target slide, the
              // pending-selection effect runs immediately (its
              // dependencies fire on the state change). Otherwise it
              // waits for the cursor to flip.
              setSelection(null);
              setSelectionNotice(null);
              setPendingSelection(override);
              if (targetIndex !== cursor.slide) {
                gotoWithBeacon(targetIndex);
              }
            }}
            onClose={closeInspector}
          />
        )}
        {presenterMode && inspectMode && (
          <SelectionOverlay
            target={selection?.element ?? null}
            label={
              selection
                ? buildSelectionLabel(
                    selection.fingerprint,
                    Array.from(selection.element.classList).find((c) =>
                      c.startsWith("text-cf-"),
                    ) ?? null,
                  )
                : ""
            }
          />
        )}
        <PresenterAffordances />
        {/* Presenter tools (laser / magnifier / marker / auto-hide
            chrome) are audience-side aids — a presenter on the public
            URL needs Q/W/E without an Access session. Mount directly
            (NOT inside <PresenterAffordances>, which is auth-gated)
            so they're available on every deck viewer regardless of
            authentication. 2026-05-11. */}
        <PresenterTools onActiveToolChange={setActiveTool} />
        {/* Item F (#111): on the AUDIENCE-facing deck (i.e. NOT the
            presenter window — distinguished by the `?presenter=1` URL
            param being absent), subscribe to broadcast tool cursors so
            the audience sees the presenter's laser / magnifier / marker
            overlays in real time. `presenterMode` is true for the
            public `/decks/<slug>` route too (decision 2026-05-10 —
            global tool affordances), so we can't use it to gate this. */}
        {location.search.indexOf("presenter=1") === -1 && (
          <AudienceToolMirror slug={slug} />
        )}
      </div>
      <TopToolbar
        slug={slug}
        currentSlide={cursor.slide}
        currentPhase={cursor.phase}
        agentOpen={agentOpen}
        onAgentToggle={() => setAgentOpen((o) => !o)}
      />
      {/* In-Studio AI chat panel (#131 phase 1). Mounted lazily — only
          pays the chat-SDK bundle cost on first open. Always gated by
          `agentOpen`. TopToolbar already hides its agent toggle when
          `presenterMode` is false, so on the public deck route the
          panel is unreachable. */}
      {agentOpen && (
        <Suspense fallback={null}>
          <StudioAgentPanel
            deckSlug={slug}
            onClose={() => setAgentOpen(false)}
          />
        </Suspense>
      )}
    </div>
    </SettingsProvider>
  );
}
