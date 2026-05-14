/**
 * Tests for `getRowsForRole` — the pure helper that maps the
 * effective slides list to the per-role row list rendered by
 * `<SlideManager>`'s ToC sidebar.
 *
 * Per CONTEXT.md:
 *   - Admin sees ALL effective slides (Hidden ones muted in the row).
 *   - Audience sees only non-Hidden effective slides.
 * Per ADR 0003:
 *   - Each row carries its `effectiveIndex` — i.e. its position in the
 *     unfiltered `effectiveSlides` array — so a row click on the
 *     audience side still navigates via `gotoEffectiveWithBeacon(N)`.
 */

import { describe, expect, it } from "vitest";
import { getRowsForRole } from "./getRowsForRole";
import type { SlideDef } from "./types";

function s(id: string, hidden?: boolean): SlideDef {
  return { id, title: id, render: () => null, hidden };
}

describe("getRowsForRole", () => {
  it("returns an empty list when given an empty list (admin)", () => {
    expect(getRowsForRole([], "admin")).toEqual([]);
  });

  it("returns an empty list when given an empty list (audience)", () => {
    expect(getRowsForRole([], "audience")).toEqual([]);
  });

  it("admin gets every slide, hidden flag preserved on each row", () => {
    const slides: SlideDef[] = [
      s("a"),
      s("b", true),
      s("c"),
      s("d", true),
    ];
    const rows = getRowsForRole(slides, "admin");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.slide.id)).toEqual(["a", "b", "c", "d"]);
    expect(rows.map((r) => r.effectiveIndex)).toEqual([0, 1, 2, 3]);
    expect(rows[0].slide.hidden).toBeUndefined();
    expect(rows[1].slide.hidden).toBe(true);
    expect(rows[2].slide.hidden).toBeUndefined();
    expect(rows[3].slide.hidden).toBe(true);
  });

  it("audience filters out hidden slides, preserving the effectiveIndex of survivors", () => {
    const slides: SlideDef[] = [
      s("a"),
      s("b", true),
      s("c"),
      s("d", true),
      s("e"),
    ];
    const rows = getRowsForRole(slides, "audience");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.slide.id)).toEqual(["a", "c", "e"]);
    // effectiveIndex must match the slide's position in the UNFILTERED list.
    expect(rows.map((r) => r.effectiveIndex)).toEqual([0, 2, 4]);
    // Confirmed no hidden slide leaked in.
    expect(rows.every((r) => r.slide.hidden !== true)).toBe(true);
  });

  it("audience returns all slides when none are hidden", () => {
    const slides: SlideDef[] = [s("a"), s("b"), s("c")];
    const rows = getRowsForRole(slides, "audience");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.slide.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.effectiveIndex)).toEqual([0, 1, 2]);
  });

  it("admin returns all slides when none are hidden (identical to audience in that case)", () => {
    const slides: SlideDef[] = [s("a"), s("b"), s("c")];
    expect(getRowsForRole(slides, "admin")).toEqual(
      getRowsForRole(slides, "audience"),
    );
  });

  it("audience returns an empty list when every slide is hidden", () => {
    const slides: SlideDef[] = [s("a", true), s("b", true)];
    expect(getRowsForRole(slides, "audience")).toEqual([]);
    // Admin still sees both.
    expect(getRowsForRole(slides, "admin")).toHaveLength(2);
  });

  it("does not mutate the input slide list", () => {
    const slides: SlideDef[] = [s("a"), s("b", true), s("c")];
    const before = slides.map((s) => ({ ...s }));
    getRowsForRole(slides, "audience");
    getRowsForRole(slides, "admin");
    expect(slides.map((s) => ({ ...s }))).toEqual(before);
  });

  it("returns row objects whose `slide` is the same reference as the input slide", () => {
    // Audience row click navigates via `effectiveIndex`, but downstream
    // components (thumbnails, title display) want the actual SlideDef
    // — preserve referential identity so React reconciliation is happy.
    const slides: SlideDef[] = [s("a"), s("b", true), s("c")];
    const rows = getRowsForRole(slides, "admin");
    expect(rows[0].slide).toBe(slides[0]);
    expect(rows[1].slide).toBe(slides[1]);
    expect(rows[2].slide).toBe(slides[2]);
  });
});
