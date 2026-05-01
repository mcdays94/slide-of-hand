/**
 * Tests for the deck navigation reducer + URL parser + initial-cursor
 * resolver. The reducer is pure so it can be exercised without React.
 */

import { describe, expect, it } from "vitest";
import {
  deckReducer,
  parseUrlCursor,
  resolveInitialCursor,
  type DeckCursor,
  type DeckShape,
} from "./useDeckState";

const makeDeck = (phases: number[]): DeckShape => ({
  slug: "test",
  phases,
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
});
