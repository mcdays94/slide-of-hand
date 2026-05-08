/**
 * `<ImageSlotEditor>` — image slot editor.
 *
 * STUB shipped via the pre-orchestrator commit pattern (see #16
 * grilling decisions + observation #13 in skill-observations/log.md).
 * Renders the existing placeholder div so the SlotEditor dispatcher
 * can call it unconditionally. The Slice 7 (#63) worker will REPLACE
 * this file's body with the real drag-drop + R2 upload + library-picker
 * UI, while preserving the exported `ImageSlotEditor` component name
 * and `ImageSlotEditorProps` interface (so SlotEditor.tsx stays
 * untouched during parallel dispatch).
 *
 * Future implementation reference: issue #63 body.
 */

import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";

export interface ImageSlotEditorProps {
  name: string;
  spec: SlotSpec;
  value: Extract<SlotValue, { kind: "image" }>;
  onChange: (next: Extract<SlotValue, { kind: "image" }>) => void;
}

export function ImageSlotEditor({ name, spec }: ImageSlotEditorProps) {
  // Stub: shows the v0.1-not-supported placeholder. Worker for #63 replaces.
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
        Slot kind &ldquo;image&rdquo; not yet supported in v0.1 (Slice 7).
      </span>
    </div>
  );
}
