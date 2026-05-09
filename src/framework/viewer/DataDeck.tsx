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
import type { Deck as FrameworkDeck, DeckMeta, SlideDef } from "./types";
import { Deck } from "./Deck";
import { renderDataSlide } from "@/framework/templates/render";
import {
  templateRegistry as defaultTemplateRegistry,
  type TemplateRegistry,
} from "@/framework/templates/registry";

/** Soft cap on synthesized overview-tile titles, measured in code points. */
const TITLE_MAX_CODEPOINTS = 40;

/**
 * Strip simple markdown delimiters from `value` so a leading `richtext`
 * slot still produces a readable overview-tile label.
 *
 * Deliberately minimal: we are NOT parsing markdown — just smoothing over
 * the inline characters that would otherwise show up as visual noise on a
 * 200-px-wide tile (`**bold**` → `bold`, `## heading` → `heading`, etc.).
 * If the user wants rich rendering they get it on the slide itself; the
 * tile only needs a quick visual cue.
 */
function stripSimpleMarkdown(value: string): string {
  return (
    value
      // Trim whitespace + leading list/heading markers (`- `, `## `).
      .replace(/^\s+/, "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*]\s+/, "")
      // Inline markers — bold/italic asterisks + underscores, inline code.
      // Replace each marker character with empty; keeping the inner text
      // intact gives us "Bold italic" out of "**Bold** _italic_".
      .replace(/\*+/g, "")
      .replace(/_+/g, "")
      .replace(/`+/g, "")
      // Collapse any whitespace runs we may have created.
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Truncate `value` to at most `TITLE_MAX_CODEPOINTS` Unicode code points,
 * appending an ellipsis (`…`) when truncation occurs. We iterate over code
 * points (`[...value]`) rather than `string.slice()` so that astral-plane
 * characters (emoji, ideographs) aren't bisected into lone surrogates.
 */
function truncateForTile(value: string): string {
  const codepoints = [...value];
  if (codepoints.length <= TITLE_MAX_CODEPOINTS) return value;
  return `${codepoints.slice(0, TITLE_MAX_CODEPOINTS).join("")}…`;
}

/**
 * Compute a sensible overview-tile label for a `DataSlide`. Returns
 * `undefined` when nothing useful can be derived — callers fall through
 * to `slide.id`.
 *
 * Priority (per #82):
 *   1. (Future) explicit `slide.title` if the type ever gains one. Today
 *      `DataSlide` has no `title` field; left as a clear extension point
 *      for Slice 11+. We DO read it via a defensive cast so that adding
 *      the field later "just works" without revisiting this helper.
 *   2. First slot whose `kind === "text"` — its `value`, truncated.
 *   3. First slot whose `kind === "richtext"` — markdown delimiters
 *      stripped, then truncated.
 *   4. The template's `label` from the registry (e.g. "Big stat").
 *   5. `undefined` (caller falls back to the slide id).
 *
 * Pure + synchronous — directly testable without rendering or registry
 * I/O. The `registry` parameter is injectable so unit tests can stub it
 * without pulling the auto-discovered Vite glob.
 */
export function synthesizeSlideTitle(
  slide: DataSlide,
  registry: TemplateRegistry = defaultTemplateRegistry,
): string | undefined {
  // (1) Future explicit `title` field. Defensive cast — `DataSlide`
  // does not declare it today, but if a future schema bump adds one
  // this path keeps the helper future-proof.
  const explicit = (slide as DataSlide & { title?: unknown }).title;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return truncateForTile(explicit.trim());
  }

  // (2)/(3) Walk slot insertion order, stopping on the first text-ish
  // slot with a non-empty value.
  for (const value of Object.values(slide.slots)) {
    if (value.kind === "text") {
      const trimmed = value.value.trim();
      if (trimmed.length > 0) return truncateForTile(trimmed);
    } else if (value.kind === "richtext") {
      const stripped = stripSimpleMarkdown(value.value);
      if (stripped.length > 0) return truncateForTile(stripped);
    }
  }

  // (4) Template label fallback.
  const template = registry.getById(slide.template);
  if (template && typeof template.label === "string" && template.label.length > 0) {
    return truncateForTile(template.label);
  }

  // (5) Nothing useful — caller's existing `slide.id` fallback applies.
  return undefined;
}

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
export function dataSlideToSlideDef(
  slide: DataSlide,
  registry: TemplateRegistry = defaultTemplateRegistry,
): SlideDef {
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

  // Synthesize a human-readable title for the overview-tile label (#82).
  // Without this, the overview grid renders the auto-generated slide id
  // (`slide-1`, `slide-2`, ...), which is useless for navigation.
  const synthesizedTitle = synthesizeSlideTitle(slide, registry);
  if (synthesizedTitle !== undefined) def.title = synthesizedTitle;

  if (slide.layout) def.layout = slide.layout;
  if (slide.notes !== undefined) def.notes = slide.notes;
  if (slide.hidden !== undefined) def.hidden = slide.hidden;

  return def;
}

/**
 * Convert a `DataDeckRecord` (the KV-backed JSON shape) into the framework
 * `Deck` shape (`{ meta, slides }`). Used by:
 *
 *   - `<DataDeck>` itself, internally — but we don't need the full
 *     `Deck` shape there, just the slide list. Kept as a separate helper
 *     so callers that DO need the framework `Deck` (notably the
 *     presenter window) can build it without re-implementing the
 *     conversion.
 *   - The `?presenter=1` branch on the deck route (Slice 5 / #61
 *     follow-up): `<PresenterWindow>` takes a framework `Deck`, so
 *     KV-backed decks need this conversion to support presenter mode.
 *
 * The framework `DeckMeta` shape requires a `description` field; the
 * KV `DataDeckMeta` shape allows it to be missing. We coalesce to ""
 * to keep the framework type satisfied (the presenter window's header
 * doesn't surface description, and the public landing page renders
 * data-decks via a different code path).
 */
export function dataDeckToDeck(
  deck: DataDeckRecord,
  registry: TemplateRegistry = defaultTemplateRegistry,
): FrameworkDeck {
  const meta: DeckMeta = {
    slug: deck.meta.slug,
    title: deck.meta.title,
    description: deck.meta.description ?? "",
    date: deck.meta.date,
  };
  if (deck.meta.author !== undefined) meta.author = deck.meta.author;
  if (deck.meta.event !== undefined) meta.event = deck.meta.event;
  if (deck.meta.cover !== undefined) meta.cover = deck.meta.cover;
  if (deck.meta.runtimeMinutes !== undefined) {
    meta.runtimeMinutes = deck.meta.runtimeMinutes;
  }
  return {
    meta,
    slides: deck.slides.map((s) => dataSlideToSlideDef(s, registry)),
  };
}

/**
 * Mount a KV-backed deck. Just an adapter — `<Deck>` does the heavy lifting.
 */
export function DataDeck({ deck }: DataDeckProps) {
  const slides = deck.slides.map((s) => dataSlideToSlideDef(s));
  return <Deck slug={deck.meta.slug} title={deck.meta.title} slides={slides} />;
}


