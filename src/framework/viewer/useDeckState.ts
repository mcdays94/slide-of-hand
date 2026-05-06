/**
 * Deck navigation state.
 *
 * Phase advances first, then slide. `prev` walks back through phases on the
 * current slide before stepping to the previous slide (landing on its final
 * phase, so audiences see the full context if you backtrack).
 *
 * The reducer is exported separately from the hook so it can be unit-tested
 * without React. The hook layers on `?slide=N` URL parsing (mount-time only)
 * and per-deck `sessionStorage` persistence so a full reload lands the
 * presenter back on the same slide.
 */

import { useEffect, useMemo, useReducer } from "react";

export interface DeckCursor {
  slide: number;
  phase: number;
}

export interface DeckShape {
  slug: string;
  /** Per-slide phase counts. `phases[i]` = additional reveals before next slide. */
  phases: number[];
}

export type DeckAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "first" }
  | { type: "last" }
  | { type: "goto"; slide: number; phase?: number }
  | { type: "set-phase"; phase: number };

const lastSlideIndex = (deck: DeckShape) => Math.max(0, deck.phases.length - 1);

/**
 * Pure reducer. Tested in isolation in `useDeckState.test.ts`.
 *
 * Invariants:
 *   - `slide` is clamped to `[0, slides.length - 1]`.
 *   - `phase` is clamped to `[0, slides[slide].phases]`.
 *   - `next` advances phase before slide; at last phase of last slide, it
 *      becomes a no-op.
 *   - `prev` walks back through phases on the current slide; at phase 0 it
 *      steps to `slide - 1` and lands on that slide's final phase.
 */
export function deckReducer(
  state: DeckCursor,
  action: DeckAction,
  deck: DeckShape,
): DeckCursor {
  const last = lastSlideIndex(deck);
  const phasesOnSlide = (i: number) => deck.phases[i] ?? 0;

  switch (action.type) {
    case "next": {
      const max = phasesOnSlide(state.slide);
      if (state.phase < max) {
        return { slide: state.slide, phase: state.phase + 1 };
      }
      if (state.slide < last) {
        return { slide: state.slide + 1, phase: 0 };
      }
      return state;
    }
    case "prev": {
      if (state.phase > 0) {
        return { slide: state.slide, phase: state.phase - 1 };
      }
      if (state.slide > 0) {
        const target = state.slide - 1;
        return { slide: target, phase: phasesOnSlide(target) };
      }
      return state;
    }
    case "first":
      return { slide: 0, phase: 0 };
    case "last":
      return { slide: last, phase: phasesOnSlide(last) };
    case "goto": {
      const slide = Math.max(0, Math.min(action.slide, last));
      const max = phasesOnSlide(slide);
      const phase = Math.max(0, Math.min(action.phase ?? 0, max));
      return { slide, phase };
    }
    case "set-phase": {
      const max = phasesOnSlide(state.slide);
      return {
        slide: state.slide,
        phase: Math.max(0, Math.min(action.phase, max)),
      };
    }
    default:
      return state;
  }
}

const STORAGE_PREFIX = "slide-of-hand-deck-cursor:";

interface ParsedUrlCursor {
  slide?: number;
  phase?: number;
}

/**
 * Parse `?slide=N&phase=K` from a URL search string. Both numeric, both
 * optional, both must be non-negative integers to count.
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
 */
export function resolveInitialCursor(
  deck: DeckShape,
  options: {
    search?: string;
    storage?: Pick<Storage, "getItem">;
  } = {},
): DeckCursor {
  const last = lastSlideIndex(deck);
  const phasesOnSlide = (i: number) => deck.phases[i] ?? 0;
  const clamp = (slide: number, phase: number): DeckCursor => {
    const s = Math.max(0, Math.min(slide, last));
    const p = Math.max(0, Math.min(phase, phasesOnSlide(s)));
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
    total: deck.phases.length,
    next: () => dispatch({ type: "next" }),
    prev: () => dispatch({ type: "prev" }),
    first: () => dispatch({ type: "first" }),
    last: () => dispatch({ type: "last" }),
    goto: (slide: number, phase?: number) =>
      dispatch({ type: "goto", slide, phase }),
  };
}
