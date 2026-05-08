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
