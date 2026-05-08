/**
 * `<ListSlotEditor>` — list slot editor.
 *
 * STUB shipped via the pre-orchestrator commit pattern (see #16
 * grilling decisions + observation #13 in skill-observations/log.md).
 * Renders the existing placeholder div so the SlotEditor dispatcher
 * can call it unconditionally. The Slice 8 (#64) worker will REPLACE
 * this file's body with the real per-item input stack + drag-reorder
 * (@dnd-kit), while preserving the exported `ListSlotEditor` component
 * name and `ListSlotEditorProps` interface (so SlotEditor.tsx stays
 * untouched during parallel dispatch).
 *
 * Future implementation reference: issue #64 body. @dnd-kit is already
 * a dependency (used in the existing SlideManager + planned Slice 9
 * filmstrip).
 */

import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";

export interface ListSlotEditorProps {
  name: string;
  spec: SlotSpec;
  value: Extract<SlotValue, { kind: "list" }>;
  onChange: (next: Extract<SlotValue, { kind: "list" }>) => void;
}

export function ListSlotEditor({ name, spec }: ListSlotEditorProps) {
  // Stub: shows the v0.1-not-supported placeholder. Worker for #64 replaces.
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
        Slot kind &ldquo;list&rdquo; not yet supported in v0.1 (Slice 8).
      </span>
    </div>
  );
}
