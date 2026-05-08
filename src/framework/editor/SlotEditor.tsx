/**
 * `<SlotEditor>` — kind-dispatched editor for a single slot.
 *
 * THE SEAM. New slot kinds (image / code / list / stat) ship by adding a
 * file under `slots/<Kind>SlotEditor.tsx` and registering it here. We
 * keep the dispatch explicit (a `switch` on `spec.kind`) rather than
 * `import.meta.glob` so:
 *
 *   - The set of supported kinds is static + grep-able from one file.
 *   - Adding a kind requires touching this dispatcher AND adding the
 *     editor — that's the right pairing: a kind without an editor in
 *     the dispatcher is a placeholder; a kind without a file is a
 *     compile error.
 *
 * The fallback (placeholder div) is intentional. Slice 7 (image) and
 * Slice 8 (code/list/stat) replace these branches by importing their
 * editor at the top and adding a case here. Until then, the editor
 * shows a clear "not yet supported" notice instead of crashing or
 * silently dropping the slot.
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
    case "code":
    case "list":
    case "stat":
      return (
        <div
          role="note"
          data-testid={`slot-placeholder-${name}`}
          className="rounded border border-dashed border-cf-border bg-cf-bg-200 px-3 py-2 text-xs text-cf-text-muted"
        >
          <span className="font-medium uppercase tracking-[0.15em]">
            {spec.label}
          </span>
          <span className="ml-2">
            Slot kind &ldquo;{spec.kind}&rdquo; not yet supported in v0.1.
          </span>
        </div>
      );
  }
}
