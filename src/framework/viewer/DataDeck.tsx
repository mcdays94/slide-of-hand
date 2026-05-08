/**
 * `<DataDeck>` — adapter that mounts a KV-backed `DataDeck` record on top of
 * the existing imperative `<Deck>` infrastructure.
 *
 * The design choice (per #16 grilling decisions): rather than build a second
 * deck viewer, we WRAP `<Deck>` and convert each `DataSlide` into a
 * `SlideDef` whose `render` callback delegates to `renderDataSlide(slide,
 * phase)` from the templates module. Everything `<Deck>` already does —
 * keyboard nav, presenter mode, theme overrides, manifest reorder, element
 * inspector, analytics — works for free.
 *
 * Phase contract: a `DataSlide`'s phase budget is `max(slot.revealAt ?? 0)`
 * across its slot values. A slide with no phased reveals has `phases = 0`
 * (right-arrow advances directly to the next slide). The renderer wraps each
 * slot in `<Reveal at={revealAt}>` automatically (see
 * `src/framework/templates/render.tsx`), so the SlideDef's `phases` count
 * is the only piece the navigation reducer needs.
 *
 * NOTE: the file consciously stays a thin adapter. Cross-cutting concerns
 * (templates registry, slot rendering, reveal wrapping) all live in Slice 4
 * code; this module just bridges the data shape into the viewer's existing
 * imperative API.
 */

import type { ReactNode } from "react";
import type { DataDeck as DataDeckRecord, DataSlide } from "@/lib/deck-record";
import type { SlideDef } from "./types";
import { Deck } from "./Deck";
import { renderDataSlide } from "@/framework/templates/render";

export interface DataDeckProps {
  deck: DataDeckRecord;
}

/**
 * Convert a single `DataSlide` into a `SlideDef`. Pure function — exported
 * so unit tests can hit it directly without rendering the wrapper.
 *
 * Field lift:
 *   - id, layout, hidden — direct copy when present.
 *   - notes — string in `DataSlide`; lifts to `ReactNode` (a string is a
 *     valid `ReactNode`, so no conversion needed).
 *   - phases — computed from slot `revealAt` values (see top-of-file).
 *   - render — delegates to `renderDataSlide`, which handles template
 *     resolution, slot validation, and `<Reveal>` wrapping.
 */
export function dataSlideToSlideDef(slide: DataSlide): SlideDef {
  // Compute the phase budget. Empty slot maps and slots with no `revealAt`
  // both produce `phases = 0`.
  let maxRevealAt = 0;
  for (const value of Object.values(slide.slots)) {
    const revealAt = value.revealAt ?? 0;
    if (revealAt > maxRevealAt) maxRevealAt = revealAt;
  }

  const def: SlideDef = {
    id: slide.id,
    // Always set `phases` — even at 0 — so the SlideDef shape is uniform
    // across data slides regardless of whether they have phased reveals.
    // The navigation reducer treats both `undefined` and `0` identically
    // (`s.phases ?? 0`); always setting it keeps the conversion contract
    // crisp and matches the issue spec verbatim.
    phases: maxRevealAt,
    render: ({ phase }: { phase: number }): ReactNode =>
      renderDataSlide(slide, phase),
  };

  if (slide.layout) def.layout = slide.layout;
  if (slide.notes !== undefined) def.notes = slide.notes;
  if (slide.hidden !== undefined) def.hidden = slide.hidden;

  return def;
}

/**
 * Mount a KV-backed deck. Just an adapter — `<Deck>` does the heavy lifting.
 */
export function DataDeck({ deck }: DataDeckProps) {
  const slides = deck.slides.map((s) => dataSlideToSlideDef(s));
  return <Deck slug={deck.meta.slug} title={deck.meta.title} slides={slides} />;
}
