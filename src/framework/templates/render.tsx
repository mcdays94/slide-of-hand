/**
 * Data-driven slide renderer.
 *
 * Translates a `DataSlide` (the persisted JSON shape from `/api/decks/<slug>`)
 * into a renderable `ReactNode` by:
 *
 *   1. Resolving the template via `templateRegistry.getById(slide.template)`.
 *   2. Validating the slot map against the template's slot specs.
 *   3. Wrapping each slot's content in `<Reveal at={slot.revealAt ?? 0}>`
 *      so phase reveals work without each template having to know about
 *      phases (the `<PhaseProvider>` is mounted here for self-contained
 *      rendering — at deck level the viewer also mounts a provider, and
 *      a nested provider just shadows the outer one with the same value).
 *   4. Calling `template.render({ slots })` with the wrapped content.
 *
 * On any failure (unknown template, invalid slots) the renderer returns a
 * fallback `role="alert"` UI rather than throwing — the deck viewer should
 * never crash because one slide's data is malformed.
 *
 * ── Type-runtime contract ────────────────────────────────────────────────
 * `SlideTemplate`'s type-level `ResolvedSlots<TSlots>` declares each slot
 * as a full `SlotValue` object. At runtime we pass pre-rendered React
 * nodes (`<Reveal>...</Reveal>`) instead. Each template's render function
 * therefore treats `slots[k]` as a `ReactNode` it can drop into the JSX
 * tree — see the seed templates under `src/templates/*` for the pattern.
 *
 * This trade-off is deliberate: pushing `<Reveal>` into the renderer keeps
 * each template a pure layout component, free of phase-awareness logic.
 * If a future slot kind needs richer access to the underlying value (say,
 * an image slot that wants to read `alt` independently) we can revisit
 * by passing `{ value: SlotValue; node: ReactNode }` instead.
 */

import type { ReactNode } from "react";
import type { DataSlide } from "@/lib/deck-record";
import type { SlotValue } from "@/lib/slot-types";
import { validateSlotsAgainstTemplate } from "@/lib/template-types";
import { Reveal } from "@/framework/viewer/Reveal";
import { PhaseProvider } from "@/framework/viewer/PhaseContext";
import {
  templateRegistry as defaultRegistry,
  type TemplateRegistry,
} from "./registry";

/**
 * Render a `DataSlide` to a `ReactNode`.
 *
 * `phase` is the active phase index (0 = first reveal not yet triggered).
 * `registry` is injectable for testing — production callers omit it and
 * get the auto-discovered `templateRegistry`.
 */
export function renderDataSlide(
  slide: DataSlide,
  phase: number,
  registry: TemplateRegistry = defaultRegistry,
): ReactNode {
  const template = registry.getById(slide.template);
  if (!template) {
    return (
      <div role="alert" className="cf-data-slide-error">
        <p>
          Unknown template: <code>{slide.template}</code>
        </p>
      </div>
    );
  }

  const validation = validateSlotsAgainstTemplate(slide.slots, template);
  if (!validation.ok) {
    return (
      <div role="alert" className="cf-data-slide-error">
        <p>
          Invalid slots for template <code>{template.id}</code>:
        </p>
        <ul>
          {validation.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      </div>
    );
  }

  // Build the resolved-slots map: each slot's *content* wrapped in a
  // <Reveal> when it has a non-zero revealAt. We deliberately skip the
  // wrapper for revealAt 0 (or unset) because <Reveal> emits a <div>;
  // a slot rendered inside an <h1> or <p> in the template would produce
  // invalid HTML (`<h1><div>…</div></h1>`). When revealAt is 0 the wrapper
  // is a no-op anyway (the content is always visible at phase 0+), so we
  // get the same behaviour with cleaner markup.
  //
  // Optional slots that are absent from `slide.slots` map to `undefined`
  // (templates gate on truthy before rendering — same as the existing
  // imperative SlideDef pattern).
  const resolvedSlots: Record<string, ReactNode> = {};
  for (const [name, value] of Object.entries(slide.slots)) {
    const content = renderSlot(value);
    const revealAt = value.revealAt ?? 0;
    resolvedSlots[name] =
      revealAt > 0 ? <Reveal at={revealAt}>{content}</Reveal> : content;
  }

  // The template's `render` is typed as receiving `ResolvedSlots<TSlots>`
  // (a per-key SlotValue map). At runtime each entry is a ReactNode — see
  // the doc-block at the top of this file. We cast through `unknown` so
  // TypeScript doesn't conflate the two non-overlapping types; the cast
  // is local to this call site so the rest of the framework keeps the
  // static type guarantee.
  const RenderedTemplate = template.render as unknown as (props: {
    slots: Record<string, ReactNode>;
  }) => ReactNode;

  return (
    <PhaseProvider phase={phase}>
      {RenderedTemplate({ slots: resolvedSlots })}
    </PhaseProvider>
  );
}

/**
 * Render a single `SlotValue` to a `ReactNode`. Kept simple — Slice 7
 * (image slot editor) and Slice 8 (code/list/stat editors) will refine
 * the visual treatment.
 *
 * TODO(slice-6): wire `richtext` through a markdown renderer (e.g.
 * `react-markdown`). Today it's plain-text identical to `text`.
 */
export function renderSlot(value: SlotValue): ReactNode {
  switch (value.kind) {
    case "text":
      return value.value;
    case "richtext":
      // TODO(slice-6): swap this for a sanitized markdown renderer.
      return value.value;
    case "image":
      return <img src={value.src} alt={value.alt} />;
    case "code":
      return (
        <pre>
          <code className={`language-${value.lang}`}>{value.value}</code>
        </pre>
      );
    case "list":
      return (
        <ul>
          {value.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "stat":
      return (
        <div className="cf-stat">
          <strong>{value.value}</strong>
          {value.caption !== undefined && <span>{value.caption}</span>}
        </div>
      );
  }
}
