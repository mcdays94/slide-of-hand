/**
 * `<SlotEditor>` — kind-dispatched editor for a single slot.
 *
 * THE SEAM. New slot kinds ship by adding a file under
 * `slots/<Kind>SlotEditor.tsx` and registering it here. We keep the
 * dispatch explicit (a `switch` on `spec.kind`) rather than
 * `import.meta.glob` so:
 *
 *   - The set of supported kinds is static + grep-able from one file.
 *   - Adding a kind requires touching this dispatcher AND adding the
 *     editor — that's the right pairing: a kind without an editor in
 *     the dispatcher is a placeholder; a kind without a file is a
 *     compile error.
 *
 * As of the Wave D pre-orchestrator commit (#16 / 2026-05-08), all
 * 6 slot kinds dispatch to a per-kind editor file. The 4 newer kinds
 * (image, code, list, stat) ship as STUBS rendering the v0.1 not-yet-
 * supported placeholder; their bodies are replaced by Slice 7 (#63 —
 * image) and Slice 8 (#64 — code, list, stat). This pre-wiring is
 * deliberate: it lets #63 and #64 dispatch in parallel WITHOUT having
 * to modify this file, eliminating the merge conflict that would
 * otherwise occur on the dispatch switch.
 *
 * Public contract:
 *
 *   <SlotEditor name="title" spec={spec} value={slotValue} onChange={...} />
 *
 * The `value`'s `kind` MUST match `spec.kind`. The dispatcher trusts
 * the caller (the editor component) to keep them in sync.
 */

import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";
import { TextSlotEditor } from "./slots/TextSlotEditor";
import { RichTextSlotEditor } from "./slots/RichTextSlotEditor";
import { ImageSlotEditor } from "./slots/ImageSlotEditor";
import { CodeSlotEditor } from "./slots/CodeSlotEditor";
import { ListSlotEditor } from "./slots/ListSlotEditor";
import { StatSlotEditor } from "./slots/StatSlotEditor";

export interface SlotEditorProps {
  /** Slot name within the slide's slot map. Used as a stable input id. */
  name: string;
  spec: SlotSpec;
  value: SlotValue;
  /** Receives a SlotValue whose `kind` matches `spec.kind`. */
  onChange: (next: SlotValue) => void;
}

/**
 * Maximum phase index exposed in the per-slot reveal dropdown. Slide of
 * Hand's framework supports arbitrary phase counts at the type level,
 * but author UX wants a small fixed set — five options (0-4) covers
 * every reveal pattern the author is likely to need without turning
 * the dropdown into a long scroll.
 */
const REVEAL_AT_OPTIONS = [0, 1, 2, 3, 4] as const;

export function SlotEditor({ name, spec, value, onChange }: SlotEditorProps) {
  // If the runtime kind has drifted from the spec, render an alert. This
  // shouldn't happen — `addSlide` populates from the template and the
  // editor never crosses kinds — but we surface it loudly if it does.
  if (value.kind !== spec.kind) {
    return (
      <div role="alert" data-testid={`slot-error-${name}`} className="text-xs text-cf-orange">
        Slot &ldquo;{name}&rdquo;: spec.kind={spec.kind} but value.kind={value.kind}.
      </div>
    );
  }

  // Wrap the kind-dispatched editor with a revealAt control. We render
  // the revealAt section AFTER the kind-specific UI so authors see the
  // primary editor first and only think about phase reveals as a
  // refinement step.
  return (
    <div className="flex flex-col gap-3">
      {renderKindEditor(name, spec, value, onChange)}
      <RevealAtControl name={name} value={value} onChange={onChange} />
    </div>
  );
}

function renderKindEditor(
  name: string,
  spec: SlotSpec,
  value: SlotValue,
  onChange: (next: SlotValue) => void,
) {
  switch (spec.kind) {
    case "text":
      return (
        <TextSlotEditor
          name={name}
          spec={spec}
          value={value as Extract<SlotValue, { kind: "text" }>}
          onChange={onChange}
        />
      );
    case "richtext":
      return (
        <RichTextSlotEditor
          name={name}
          spec={spec}
          value={value as Extract<SlotValue, { kind: "richtext" }>}
          onChange={onChange}
        />
      );
    case "image":
      return (
        <ImageSlotEditor
          name={name}
          spec={spec}
          value={value as Extract<SlotValue, { kind: "image" }>}
          onChange={onChange as (next: Extract<SlotValue, { kind: "image" }>) => void}
        />
      );
    case "code":
      return (
        <CodeSlotEditor
          name={name}
          spec={spec}
          value={value as Extract<SlotValue, { kind: "code" }>}
          onChange={onChange as (next: Extract<SlotValue, { kind: "code" }>) => void}
        />
      );
    case "list":
      return (
        <ListSlotEditor
          name={name}
          spec={spec}
          value={value as Extract<SlotValue, { kind: "list" }>}
          onChange={onChange as (next: Extract<SlotValue, { kind: "list" }>) => void}
        />
      );
    case "stat":
      return (
        <StatSlotEditor
          name={name}
          spec={spec}
          value={value as Extract<SlotValue, { kind: "stat" }>}
          onChange={onChange as (next: Extract<SlotValue, { kind: "stat" }>) => void}
        />
      );
  }
}

interface RevealAtControlProps {
  name: string;
  value: SlotValue;
  onChange: (next: SlotValue) => void;
}

/**
 * Per-slot phase-reveal selector. Storing `revealAt: 0` is *equivalent*
 * to omitting it (the renderer treats `?? 0` the same), but we strip the
 * field when the user selects 0 so the persisted JSON stays sparse and
 * round-trips cleanly through `validateSlotValue`'s `copyOptionalRevealAt`.
 */
function RevealAtControl({ name, value, onChange }: RevealAtControlProps) {
  const current = value.revealAt ?? 0;
  const selectId = `slot-revealat-${name}`;
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={selectId}
        className="font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle"
      >
        Reveal on phase
      </label>
      <select
        id={selectId}
        data-interactive
        data-testid={`slot-revealat-${name}`}
        value={String(current)}
        onChange={(e) => {
          const next = Number.parseInt(e.target.value, 10);
          // Strip `revealAt` when setting back to 0 so the persisted
          // JSON stays sparse. The validator treats both shapes the same.
          if (next === 0) {
            const { revealAt: _drop, ...rest } = value;
            void _drop;
            onChange(rest as SlotValue);
            return;
          }
          onChange({ ...value, revealAt: next } as SlotValue);
        }}
        className="rounded border border-cf-border bg-cf-bg-100 px-2 py-1 font-mono text-xs text-cf-text"
      >
        {REVEAL_AT_OPTIONS.map((n) => (
          <option key={n} value={String(n)}>
            {n === 0 ? "0 (always visible)" : String(n)}
          </option>
        ))}
      </select>
    </div>
  );
}
