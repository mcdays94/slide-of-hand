/**
 * Deck navigation state.
 *
 * Per ADR 0003, the cursor is keyed on **effective slides** (the result of
 * `mergeSlides(sourceSlides, manifestOverrides)` — Hidden slides included),
 * NOT the audience-facing **visible slides** filter. This lets Sequential
 * nav skip Hidden slides while ToC nav (admin) can still `goto(N)` a hidden
 * slide without un-hiding it.
 *
 * Phase advances first, then slide. `prev` walks back through phases on the
 * current slide before stepping to the previous non-hidden slide (landing on
 * its final phase, so audiences see the full context if you backtrack).
 * `next` and `prev` skip Hidden slides via `findNextNonHiddenSlide`. `goto`
 * does NOT filter — it lands on whatever slide is at `effectiveSlides[N]`.
 *
 * The reducer is exported separately from the hook so it can be unit-tested
 * without React. The hook layers on `?slide=N` URL parsing (mount-time only)
 * and per-deck `sessionStorage` persistence so a full reload lands the
 * presenter back on the same slide.
 */

import { useEffect, useMemo, useReducer } from "react";
import { findNextNonHiddenSlide } from "./findNextNonHiddenSlide";

export interface DeckCursor {
  slide: number;
  phase: number;
}

/**
 * The shape `useDeckState` consumes. Each entry describes one slide in
 * the **effective slides** array (post `mergeSlides`):
 *   - `phases` — additional reveals before `next` advances off the slide.
 *   - `hidden` — when true, Sequential nav skips this slide (ToC nav and
 *     `goto(N)` still land on it).
 */
export interface DeckSlideShape {
  phases: number;
  hidden?: boolean;
}

export interface DeckShape {
  slug: string;
  /**
   * Effective-slides list (full, ordered, hidden included). The cursor's
   * `slide` field indexes into this array.
   */
  slides: DeckSlideShape[];
}

export type DeckAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "first" }
  | { type: "last" }
  | { type: "goto"; slide: number; phase?: number }
  | { type: "set-phase"; phase: number };

const lastSlideIndex = (deck: DeckShape) =>
  Math.max(0, deck.slides.length - 1);

const phasesOnSlide = (deck: DeckShape, i: number) =>
  deck.slides[i]?.phases ?? 0;

/**
 * Find the first non-hidden slide scanning forward from -1 (i.e. the
 * very first non-hidden slide). Returns 0 when the deck has no slides at
 * all (defensive — the cursor still needs a well-defined integer).
 */
const firstNonHiddenIndex = (deck: DeckShape): number => {
  if (deck.slides.length === 0) return 0;
  if (!deck.slides[0]?.hidden) return 0;
  return findNextNonHiddenSlide(deck.slides, 0, 1) ?? 0;
};

/**
 * Find the last non-hidden slide scanning backward from `length`. Returns
 * the trailing index when no non-hidden slide exists (defensive).
 */
const lastNonHiddenIndex = (deck: DeckShape): number => {
  const last = lastSlideIndex(deck);
  if (deck.slides.length === 0) return 0;
  if (!deck.slides[last]?.hidden) return last;
  return findNextNonHiddenSlide(deck.slides, last, -1) ?? last;
};

/**
 * Pure reducer. Tested in isolation in `useDeckState.test.ts`.
 *
 * Invariants:
 *   - `slide` is clamped to `[0, slides.length - 1]`.
 *   - `phase` is clamped to `[0, slides[slide].phases]`.
 *   - `next` advances phase before slide; when at the last phase of the
 *     current slide, it skips Hidden slides to the next non-hidden one.
 *     At the last phase of the last non-hidden slide, it becomes a no-op.
 *   - `prev` walks back through phases on the current slide; at phase 0
 *     it steps to the previous non-hidden slide's final phase.
 *   - `goto(N)` does NOT skip hidden — it lands on `slides[N]` directly
 *     (subject to the [0, last] clamp). This is the ToC-nav entrypoint
 *     admins use to navigate to a Hidden slide without un-hiding it.
 */
export function deckReducer(
  state: DeckCursor,
  action: DeckAction,
  deck: DeckShape,
): DeckCursor {
  const last = lastSlideIndex(deck);

  // When the cursor is parked on a Hidden slide (admin landed via ToC
  // nav), Sequential nav skips out of it directly — its phase reveals
  // never render to anyone, so crawling them on the way out would be
  // meaningless. For non-Hidden current slides the usual
  // "phase-before-slide" walk applies.
  const onHidden = deck.slides[state.slide]?.hidden === true;

  switch (action.type) {
    case "next": {
      const max = phasesOnSlide(deck, state.slide);
      if (!onHidden && state.phase < max) {
        return { slide: state.slide, phase: state.phase + 1 };
      }
      const target = findNextNonHiddenSlide(deck.slides, state.slide, 1);
      if (target !== null) {
        return { slide: target, phase: 0 };
      }
      return state;
    }
    case "prev": {
      if (!onHidden && state.phase > 0) {
        return { slide: state.slide, phase: state.phase - 1 };
      }
      const target = findNextNonHiddenSlide(deck.slides, state.slide, -1);
      if (target !== null) {
        return { slide: target, phase: phasesOnSlide(deck, target) };
      }
      return state;
    }
    case "first": {
      const target = firstNonHiddenIndex(deck);
      return { slide: target, phase: 0 };
    }
    case "last": {
      const target = lastNonHiddenIndex(deck);
      return { slide: target, phase: phasesOnSlide(deck, target) };
    }
    case "goto": {
      // Deliberately does NOT skip Hidden — ToC nav (admin) lands here.
      const slide = Math.max(0, Math.min(action.slide, last));
      const max = phasesOnSlide(deck, slide);
      const phase = Math.max(0, Math.min(action.phase ?? 0, max));
      return { slide, phase };
    }
    case "set-phase": {
      const max = phasesOnSlide(deck, state.slide);
      return {
        slide: state.slide,
        phase: Math.max(0, Math.min(action.phase, max)),
      };
    }
    default:
      return state;
  }
}

// v2: the cursor index now refers to **effective slides** rather than
// **visible slides** (ADR 0003). The version bump quietly drops stale
// v1 entries so reloaded decks fall back to defaults instead of being
// misinterpreted against the new index.
const STORAGE_PREFIX = "slide-of-hand-deck-cursor-v2:";

interface ParsedUrlCursor {
  slide?: number;
  phase?: number;
}

/**
 * Parse `?slide=N&phase=K` from a URL search string. Both numeric, both
 * optional, both must be non-negative integers to count. Post ADR 0003
 * the numbers index into **effective slides**.
 */
export function parseUrlCursor(search: string): ParsedUrlCursor {
  if (!search) return {};
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const out: ParsedUrlCursor = {};
  const rawSlide = params.get("slide");
  if (rawSlide !== null) {
    const n = Number(rawSlide);
    if (Number.isInteger(n) && n >= 0) out.slide = n;
  }
  const rawPhase = params.get("phase");
  if (rawPhase !== null) {
    const n = Number(rawPhase);
    if (Number.isInteger(n) && n >= 0) out.phase = n;
  }
  return out;
}

/**
 * Resolve the initial cursor on first mount.
 *
 * Priority: `?slide=N` URL > sessionStorage > {0,0}. URL wins over storage so
 * an explicit deep link always trumps a stale stored position.
 *
 * Both `?slide=N` and the stored cursor are interpreted as **effective
 * slides** indices (ADR 0003). The clamp does NOT skip Hidden — a deep
 * link to a Hidden slide lands on it as-is. Audience-side handling of
 * that case (clamp + console warning) is the responsibility of a later
 * slice in #196.
 */
export function resolveInitialCursor(
  deck: DeckShape,
  options: {
    search?: string;
    storage?: Pick<Storage, "getItem">;
  } = {},
): DeckCursor {
  const last = lastSlideIndex(deck);
  const clamp = (slide: number, phase: number): DeckCursor => {
    const s = Math.max(0, Math.min(slide, last));
    const p = Math.max(0, Math.min(phase, phasesOnSlide(deck, s)));
    return { slide: s, phase: p };
  };

  const url = parseUrlCursor(options.search ?? "");
  if (url.slide !== undefined) {
    return clamp(url.slide, url.phase ?? 0);
  }

  const raw = options.storage?.getItem(STORAGE_PREFIX + deck.slug);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<DeckCursor>;
      if (
        typeof parsed?.slide === "number" &&
        typeof parsed?.phase === "number"
      ) {
        return clamp(parsed.slide, parsed.phase);
      }
    } catch {
      /* fall through */
    }
  }

  return { slide: 0, phase: 0 };
}

export interface UseDeckStateResult {
  cursor: DeckCursor;
  total: number;
  next: () => void;
  prev: () => void;
  first: () => void;
  last: () => void;
  goto: (slide: number, phase?: number) => void;
}

/**
 * React hook wrapping the reducer. Mount-time URL parsing + sessionStorage
 * persistence on cursor change.
 */
export function useDeckState(deck: DeckShape): UseDeckStateResult {
  const initial = useMemo(
    () =>
      resolveInitialCursor(deck, {
        search: typeof window !== "undefined" ? window.location.search : "",
        storage:
          typeof window !== "undefined" ? window.sessionStorage : undefined,
      }),
    // Initial cursor is locked to first mount per AGENTS.md "URL on mount only".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deck.slug],
  );

  const [cursor, dispatch] = useReducer(
    (state: DeckCursor, action: DeckAction) => deckReducer(state, action, deck),
    initial,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        STORAGE_PREFIX + deck.slug,
        JSON.stringify(cursor),
      );
    } catch {
      /* storage may be disabled (private mode quotas, etc.); silently ignore */
    }
  }, [cursor, deck.slug]);

  // Mirror the current cursor into the URL as `?slide=N&phase=K` so the
  // current slide is shareable as a deep link. We use `history.replaceState`
  // (NOT `pushState`) so each navigation does NOT add a back-button entry —
  // browser Back continues to mean "leave the deck", not "step backwards
  // through phase reveals." Other query params (e.g. `?presenter-mode=1`)
  // are preserved.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("slide", String(cursor.slide));
      url.searchParams.set("phase", String(cursor.phase));
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* URL writes can fail (sandboxed iframe, etc.); silently ignore */
    }
  }, [cursor.slide, cursor.phase]);

  return {
    cursor,
    total: deck.slides.length,
    next: () => dispatch({ type: "next" }),
    prev: () => dispatch({ type: "prev" }),
    first: () => dispatch({ type: "first" }),
    last: () => dispatch({ type: "last" }),
    goto: (slide: number, phase?: number) =>
      dispatch({ type: "goto", slide, phase }),
  };
}
