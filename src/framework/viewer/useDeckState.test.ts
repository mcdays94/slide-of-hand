/**
 * Tests for the deck navigation reducer + URL parser + initial-cursor
 * resolver.
 *
 * Post ADR 0003, the cursor is keyed on **effective slides** (Hidden
 * included). Sequential nav (`next`/`prev`) skips Hidden via
 * `findNextNonHiddenSlide`; `goto` deliberately does not so admin ToC nav
 * can land on a Hidden slide without un-hiding it. `first`/`last` skip
 * leading/trailing Hidden.
 *
 * The reducer is pure so it can be exercised without React.
 */

import { describe, expect, it } from "vitest";
import {
  deckReducer,
  parseUrlCursor,
  resolveInitialCursor,
  type DeckCursor,
  type DeckShape,
  type DeckSlideShape,
} from "./useDeckState";

/**
 * Construct a fixture DeckShape from a phases array. Existing tests
 * predating ADR 0003 default every slide to non-hidden, exactly
 * matching the v1 semantics so they keep passing unchanged.
 */
const makeDeck = (phases: number[]): DeckShape => ({
  slug: "test",
  slides: phases.map((p): DeckSlideShape => ({ phases: p })),
});

/**
 * Construct a fixture DeckShape with explicit per-slide hidden flags.
 * Used by the ADR-0003 tests that exercise Sequential nav's
 * skip-Hidden behaviour.
 */
const makeDeckWithHidden = (
  entries: { phases: number; hidden?: boolean }[],
): DeckShape => ({
  slug: "test",
  slides: entries,
});

const start: DeckCursor = { slide: 0, phase: 0 };

describe("deckReducer", () => {
  it("advances phase before slide on next", () => {
    const deck = makeDeck([2, 1]);
    let s = start;
    s = deckReducer(s, { type: "next" }, deck);
    expect(s).toEqual({ slide: 0, phase: 1 });
    s = deckReducer(s, { type: "next" }, deck);
    expect(s).toEqual({ slide: 0, phase: 2 });
    s = deckReducer(s, { type: "next" }, deck);
    expect(s).toEqual({ slide: 1, phase: 0 });
  });

  it("clamps next at the last phase of the last slide", () => {
    const deck = makeDeck([0, 1]);
    const end: DeckCursor = { slide: 1, phase: 1 };
    expect(deckReducer(end, { type: "next" }, deck)).toEqual(end);
  });

  it("walks back through phases on prev, then drops to previous slide's last phase", () => {
    const deck = makeDeck([2, 1]);
    let s: DeckCursor = { slide: 1, phase: 1 };
    s = deckReducer(s, { type: "prev" }, deck);
    expect(s).toEqual({ slide: 1, phase: 0 });
    s = deckReducer(s, { type: "prev" }, deck);
    expect(s).toEqual({ slide: 0, phase: 2 });
    s = deckReducer(s, { type: "prev" }, deck);
    expect(s).toEqual({ slide: 0, phase: 1 });
  });

  it("clamps prev at slide 0 phase 0", () => {
    const deck = makeDeck([1, 1]);
    expect(deckReducer(start, { type: "prev" }, deck)).toEqual(start);
  });

  it("Home jumps to first; End jumps to last slide's final phase", () => {
    const deck = makeDeck([0, 0, 2]);
    expect(
      deckReducer({ slide: 1, phase: 0 }, { type: "first" }, deck),
    ).toEqual({ slide: 0, phase: 0 });
    expect(deckReducer(start, { type: "last" }, deck)).toEqual({
      slide: 2,
      phase: 2,
    });
  });

  it("goto clamps slide and phase", () => {
    const deck = makeDeck([1, 1, 0]);
    expect(deckReducer(start, { type: "goto", slide: 99 }, deck)).toEqual({
      slide: 2,
      phase: 0,
    });
    expect(deckReducer(start, { type: "goto", slide: -3 }, deck)).toEqual({
      slide: 0,
      phase: 0,
    });
    expect(
      deckReducer(start, { type: "goto", slide: 1, phase: 99 }, deck),
    ).toEqual({ slide: 1, phase: 1 });
  });

  it("set-phase clamps within the current slide's phase max", () => {
    const deck = makeDeck([2, 1]);
    expect(
      deckReducer({ slide: 0, phase: 0 }, { type: "set-phase", phase: 99 }, deck),
    ).toEqual({ slide: 0, phase: 2 });
    expect(
      deckReducer({ slide: 0, phase: 1 }, { type: "set-phase", phase: -3 }, deck),
    ).toEqual({ slide: 0, phase: 0 });
  });
});

describe("deckReducer with Hidden slides (ADR 0003)", () => {
  it("next skips a Hidden slide mid-deck", () => {
    // Effective slides: [A, H, B]. From A phase 0 (no reveals), next must
    // land on B (effective index 2), skipping the Hidden one.
    const deck = makeDeckWithHidden([
      { phases: 0 },
      { phases: 0, hidden: true },
      { phases: 0 },
    ]);
    expect(
      deckReducer({ slide: 0, phase: 0 }, { type: "next" }, deck),
    ).toEqual({ slide: 2, phase: 0 });
  });

  it("next exhausts phases on the current slide before skipping Hidden", () => {
    // From A (2 phases) phase 0, next walks through phase 1 then phase 2
    // before jumping over the Hidden middle slide to land on B.
    const deck = makeDeckWithHidden([
      { phases: 2 },
      { phases: 0, hidden: true },
      { phases: 0 },
    ]);
    let s: DeckCursor = { slide: 0, phase: 0 };
    s = deckReducer(s, { type: "next" }, deck);
    expect(s).toEqual({ slide: 0, phase: 1 });
    s = deckReducer(s, { type: "next" }, deck);
    expect(s).toEqual({ slide: 0, phase: 2 });
    s = deckReducer(s, { type: "next" }, deck);
    expect(s).toEqual({ slide: 2, phase: 0 });
  });

  it("next is a no-op when only Hidden slides remain ahead", () => {
    const deck = makeDeckWithHidden([
      { phases: 0 },
      { phases: 0, hidden: true },
      { phases: 0, hidden: true },
    ]);
    const at: DeckCursor = { slide: 0, phase: 0 };
    expect(deckReducer(at, { type: "next" }, deck)).toEqual(at);
  });

  it("prev skips a Hidden slide and lands on the prior slide's final phase", () => {
    // Effective slides: [A (phases:2), H, B (phases:0)]. From B phase 0,
    // prev jumps over H to land on A at its final phase (2).
    const deck = makeDeckWithHidden([
      { phases: 2 },
      { phases: 0, hidden: true },
      { phases: 0 },
    ]);
    expect(
      deckReducer({ slide: 2, phase: 0 }, { type: "prev" }, deck),
    ).toEqual({ slide: 0, phase: 2 });
  });

  it("prev is a no-op when only Hidden slides remain behind", () => {
    const deck = makeDeckWithHidden([
      { phases: 0, hidden: true },
      { phases: 0, hidden: true },
      { phases: 0 },
    ]);
    const at: DeckCursor = { slide: 2, phase: 0 };
    expect(deckReducer(at, { type: "prev" }, deck)).toEqual(at);
  });

  it("next skips a run of consecutive Hidden slides", () => {
    const deck = makeDeckWithHidden([
      { phases: 0 },
      { phases: 1, hidden: true },
      { phases: 0, hidden: true },
      { phases: 2, hidden: true },
      { phases: 0 },
    ]);
    expect(
      deckReducer({ slide: 0, phase: 0 }, { type: "next" }, deck),
    ).toEqual({ slide: 4, phase: 0 });
  });

  it("goto lands on a Hidden slide as-is (ToC nav entrypoint)", () => {
    // The whole point of ADR 0003: admin must be able to navigate to a
    // Hidden slide without un-hiding it. `goto` deliberately bypasses
    // the skip-Hidden filter.
    const deck = makeDeckWithHidden([
      { phases: 0 },
      { phases: 1, hidden: true },
      { phases: 0 },
    ]);
    expect(
      deckReducer(start, { type: "goto", slide: 1 }, deck),
    ).toEqual({ slide: 1, phase: 0 });
    expect(
      deckReducer(start, { type: "goto", slide: 1, phase: 1 }, deck),
    ).toEqual({ slide: 1, phase: 1 });
  });

  it("first skips leading Hidden slides", () => {
    const deck = makeDeckWithHidden([
      { phases: 0, hidden: true },
      { phases: 0, hidden: true },
      { phases: 0 },
      { phases: 0 },
    ]);
    expect(
      deckReducer({ slide: 3, phase: 0 }, { type: "first" }, deck),
    ).toEqual({ slide: 2, phase: 0 });
  });

  it("last skips trailing Hidden slides", () => {
    const deck = makeDeckWithHidden([
      { phases: 0 },
      { phases: 2 },
      { phases: 0, hidden: true },
      { phases: 1, hidden: true },
    ]);
    // Last non-hidden is index 1 with phases=2 → land on its final phase.
    expect(deckReducer(start, { type: "last" }, deck)).toEqual({
      slide: 1,
      phase: 2,
    });
  });

  it("first / last gracefully no-op on an all-Hidden deck (defensive clamp to 0)", () => {
    const deck = makeDeckWithHidden([
      { phases: 0, hidden: true },
      { phases: 0, hidden: true },
    ]);
    expect(deckReducer(start, { type: "first" }, deck)).toEqual({
      slide: 0,
      phase: 0,
    });
    expect(deckReducer(start, { type: "last" }, deck)).toEqual({
      slide: 1,
      phase: 0,
    });
  });

  it("next from a Hidden slide (admin parked via ToC nav) still finds the next non-hidden", () => {
    // Admin lands on a Hidden slide via `goto` → presses → → Sequential
    // nav skips ahead to the next non-hidden.
    const deck = makeDeckWithHidden([
      { phases: 0 },
      { phases: 1, hidden: true },
      { phases: 0 },
    ]);
    expect(
      deckReducer({ slide: 1, phase: 0 }, { type: "next" }, deck),
    ).toEqual({ slide: 2, phase: 0 });
  });

  it("prev from a Hidden slide (admin parked via ToC nav) still finds the previous non-hidden", () => {
    const deck = makeDeckWithHidden([
      { phases: 1 },
      { phases: 1, hidden: true },
      { phases: 0 },
    ]);
    expect(
      deckReducer({ slide: 1, phase: 0 }, { type: "prev" }, deck),
    ).toEqual({ slide: 0, phase: 1 });
  });
});

describe("parseUrlCursor", () => {
  it("parses ?slide=N&phase=K", () => {
    expect(parseUrlCursor("?slide=2&phase=1")).toEqual({ slide: 2, phase: 1 });
  });

  it("accepts no leading ?", () => {
    expect(parseUrlCursor("slide=3")).toEqual({ slide: 3 });
  });

  it("ignores non-integers and negatives", () => {
    expect(parseUrlCursor("?slide=abc&phase=-1")).toEqual({});
    expect(parseUrlCursor("?slide=1.5")).toEqual({});
  });

  it("returns empty for empty input", () => {
    expect(parseUrlCursor("")).toEqual({});
  });
});

describe("resolveInitialCursor", () => {
  it("URL ?slide=N wins over storage", () => {
    const storage = {
      getItem: () => JSON.stringify({ slide: 0, phase: 0 }),
    };
    expect(
      resolveInitialCursor(makeDeck([0, 0, 0]), {
        search: "?slide=2",
        storage,
      }),
    ).toEqual({ slide: 2, phase: 0 });
  });

  it("storage wins over default when URL is absent", () => {
    const storage = {
      getItem: () => JSON.stringify({ slide: 1, phase: 1 }),
    };
    expect(
      resolveInitialCursor(makeDeck([2, 2]), { storage }),
    ).toEqual({ slide: 1, phase: 1 });
  });

  it("falls back to {0,0} when nothing is set", () => {
    expect(resolveInitialCursor(makeDeck([0, 0]))).toEqual({
      slide: 0,
      phase: 0,
    });
  });

  it("clamps URL values to valid range", () => {
    expect(
      resolveInitialCursor(makeDeck([0, 1]), { search: "?slide=99&phase=99" }),
    ).toEqual({ slide: 1, phase: 1 });
  });

  it("ignores corrupt storage payloads", () => {
    const storage = { getItem: () => "{not json" };
    expect(
      resolveInitialCursor(makeDeck([0, 0]), { storage }),
    ).toEqual({ slide: 0, phase: 0 });
  });

  it("storage is read from the v2 key, not the legacy v1 key", () => {
    // ADR 0003 changes the meaning of `slide=N` (effective vs visible).
    // The v1 prefix is treated as orphaned data: the resolver only
    // consults the v2 prefix and falls back to defaults otherwise.
    const v1Hits: string[] = [];
    const v2Hits: string[] = [];
    const storage = {
      getItem: (key: string) => {
        if (key.startsWith("slide-of-hand-deck-cursor:")) {
          v1Hits.push(key);
          return JSON.stringify({ slide: 1, phase: 1 });
        }
        if (key.startsWith("slide-of-hand-deck-cursor-v2:")) {
          v2Hits.push(key);
          return null;
        }
        return null;
      },
    };
    expect(
      resolveInitialCursor(makeDeck([1, 1]), { storage }),
    ).toEqual({ slide: 0, phase: 0 });
    expect(v1Hits).toEqual([]);
    expect(v2Hits).toEqual(["slide-of-hand-deck-cursor-v2:test"]);
  });

  it("URL ?slide=N targeting a Hidden slide lands on it as-is (audience clamp is the viewer's job)", () => {
    // ADR 0003 spec: `goto(N)` and the equivalent URL deep link bypass
    // the skip-Hidden filter; clamping is to [0, last], not to
    // [0, lastVisible]. Audience-side handling (clamp + warn) lives
    // outside this reducer.
    const deck: DeckShape = {
      slug: "deep-link-hidden",
      slides: [
        { phases: 0 },
        { phases: 0, hidden: true },
        { phases: 0 },
      ],
    };
    expect(resolveInitialCursor(deck, { search: "?slide=1" })).toEqual({
      slide: 1,
      phase: 0,
    });
  });
});
