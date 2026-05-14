/**
 * Tests for the pure `findNextNonHiddenSlide` helper.
 *
 * Sequential nav (per the CONTEXT.md glossary) must skip Hidden slides for
 * everyone — both audience and admin. The helper encapsulates that scan so
 * `deckReducer`'s `next` / `prev` cases stay declarative.
 */

import { describe, expect, it } from "vitest";
import { findNextNonHiddenSlide } from "./findNextNonHiddenSlide";

describe("findNextNonHiddenSlide", () => {
  it("advances by 1 when all slides are visible", () => {
    const slides = [{}, {}, {}];
    expect(findNextNonHiddenSlide(slides, 0, 1)).toBe(1);
    expect(findNextNonHiddenSlide(slides, 1, 1)).toBe(2);
  });

  it("recedes by 1 when all slides are visible", () => {
    const slides = [{}, {}, {}];
    expect(findNextNonHiddenSlide(slides, 2, -1)).toBe(1);
    expect(findNextNonHiddenSlide(slides, 1, -1)).toBe(0);
  });

  it("skips a single hidden slide mid-deck when scanning forward", () => {
    const slides = [{}, { hidden: true }, {}];
    expect(findNextNonHiddenSlide(slides, 0, 1)).toBe(2);
  });

  it("skips a single hidden slide mid-deck when scanning backward", () => {
    const slides = [{}, { hidden: true }, {}];
    expect(findNextNonHiddenSlide(slides, 2, -1)).toBe(0);
  });

  it("skips a run of hidden slides", () => {
    const slides = [{}, { hidden: true }, { hidden: true }, { hidden: true }, {}];
    expect(findNextNonHiddenSlide(slides, 0, 1)).toBe(4);
    expect(findNextNonHiddenSlide(slides, 4, -1)).toBe(0);
  });

  it("returns null when no non-hidden slide exists ahead", () => {
    const slides = [{}, { hidden: true }, { hidden: true }];
    expect(findNextNonHiddenSlide(slides, 0, 1)).toBeNull();
  });

  it("returns null when no non-hidden slide exists behind", () => {
    const slides = [{ hidden: true }, { hidden: true }, {}];
    expect(findNextNonHiddenSlide(slides, 2, -1)).toBeNull();
  });

  it("returns null when scanning forward off the end", () => {
    const slides = [{}, {}, {}];
    expect(findNextNonHiddenSlide(slides, 2, 1)).toBeNull();
  });

  it("returns null when scanning backward off the front", () => {
    const slides = [{}, {}, {}];
    expect(findNextNonHiddenSlide(slides, 0, -1)).toBeNull();
  });

  it("handles a single-slide deck (no neighbour either way)", () => {
    const slides = [{}];
    expect(findNextNonHiddenSlide(slides, 0, 1)).toBeNull();
    expect(findNextNonHiddenSlide(slides, 0, -1)).toBeNull();
  });

  it("handles a single hidden slide deck (no neighbour at all)", () => {
    const slides = [{ hidden: true }];
    expect(findNextNonHiddenSlide(slides, 0, 1)).toBeNull();
    expect(findNextNonHiddenSlide(slides, 0, -1)).toBeNull();
  });

  it("handles hidden slides at the leading boundary when scanning forward from inside", () => {
    // fromIndex itself is never returned — scan starts at fromIndex + direction.
    const slides = [{ hidden: true }, {}, {}];
    expect(findNextNonHiddenSlide(slides, 1, 1)).toBe(2);
  });

  it("handles hidden slides at the trailing boundary when scanning backward from inside", () => {
    const slides = [{}, {}, { hidden: true }];
    expect(findNextNonHiddenSlide(slides, 1, -1)).toBe(0);
  });

  it("treats fromIndex's own hidden flag as irrelevant — the scan starts at fromIndex + direction", () => {
    // i.e. you may be parked on a hidden slide (via ToC nav as admin) and
    // press → / ← — sequential nav still has to land on the next/prev
    // non-hidden neighbour.
    const slides = [{}, { hidden: true }, {}];
    expect(findNextNonHiddenSlide(slides, 1, 1)).toBe(2);
    expect(findNextNonHiddenSlide(slides, 1, -1)).toBe(0);
  });

  it("returns null for an empty slide list", () => {
    expect(findNextNonHiddenSlide([], 0, 1)).toBeNull();
    expect(findNextNonHiddenSlide([], 0, -1)).toBeNull();
  });
});
