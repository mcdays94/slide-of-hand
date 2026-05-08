/**
 * `<TextSlotEditor>` — single-line input for `text` slots.
 *
 * Behaviour:
 *   - The visible label / description / required indicator come from the
 *     template `SlotSpec`.
 *   - Input is hard-capped at the spec's `maxLength` (the `<input>`
 *     element's `maxLength` attribute does the enforcement).
 *   - Any change emits a fresh `SlotValue` via `onChange`. We preserve
 *     the existing `revealAt` (Slice 6 doesn't expose phase editing yet
 *     — Slice 9's filmstrip will).
 */

import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";

export interface TextSlotEditorProps {
  /** Slot id (used to associate the label + input). */
  name: string;
  spec: SlotSpec;
  /** Current value. We accept the broad `SlotValue` and narrow inside. */
  value: Extract<SlotValue, { kind: "text" }>;
  onChange: (next: Extract<SlotValue, { kind: "text" }>) => void;
}

export function TextSlotEditor({
  name,
  spec,
  value,
  onChange,
}: TextSlotEditorProps) {
  const inputId = `slot-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
      >
        {spec.label}
        {spec.required && (
          <span aria-label="required" className="ml-1 text-cf-orange">
            *
          </span>
        )}
      </label>
      <input
        id={inputId}
        type="text"
        data-interactive
        data-testid={`slot-input-${name}`}
        value={value.value}
        placeholder={spec.placeholder}
        maxLength={spec.maxLength}
        onChange={(e) => {
          const next: Extract<SlotValue, { kind: "text" }> = {
            kind: "text",
            value: e.target.value,
          };
          if (value.revealAt !== undefined) next.revealAt = value.revealAt;
          onChange(next);
        }}
        className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
      />
      {spec.description && (
        <p className="text-xs text-cf-text-muted">{spec.description}</p>
      )}
    </div>
  );
}
