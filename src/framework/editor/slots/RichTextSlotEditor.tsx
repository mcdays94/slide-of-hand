/**
 * `<RichTextSlotEditor>` — markdown textarea + live-rendered preview.
 *
 * Layout: split horizontally (textarea on the left, rendered preview on
 * the right) inside the slot editor area.
 *
 * Both this preview pane and the deck-viewer's `renderSlot()` share the
 * same `<RichTextRender>` component (see
 * `src/framework/templates/RichTextRender.tsx`), so what the author sees
 * while typing matches what the audience sees on the slide. Issue #81
 * fixed the prior drift where the renderer leaked raw `**bold**`
 * literals onto the slide.
 */

import { RichTextRender } from "@/framework/templates/RichTextRender";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";

export interface RichTextSlotEditorProps {
  name: string;
  spec: SlotSpec;
  value: Extract<SlotValue, { kind: "richtext" }>;
  onChange: (next: Extract<SlotValue, { kind: "richtext" }>) => void;
}

export function RichTextSlotEditor({
  name,
  spec,
  value,
  onChange,
}: RichTextSlotEditorProps) {
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <textarea
          id={inputId}
          data-interactive
          data-testid={`slot-textarea-${name}`}
          value={value.value}
          placeholder={spec.placeholder}
          maxLength={spec.maxLength}
          rows={6}
          onChange={(e) => {
            const next: Extract<SlotValue, { kind: "richtext" }> = {
              kind: "richtext",
              value: e.target.value,
            };
            if (value.revealAt !== undefined) next.revealAt = value.revealAt;
            onChange(next);
          }}
          className="resize-y rounded border border-cf-border bg-cf-bg-100 px-3 py-2 font-mono text-xs text-cf-text outline-none focus:border-cf-orange"
        />
        <div
          data-testid={`slot-preview-${name}`}
          className="prose prose-sm max-w-none rounded border border-dashed border-cf-border bg-cf-bg-200 px-3 py-2 text-sm text-cf-text"
        >
          {value.value.length > 0 ? (
            <RichTextRender source={value.value} />
          ) : (
            <p className="text-cf-text-muted italic">Preview…</p>
          )}
        </div>
      </div>
      {spec.description && (
        <p className="text-xs text-cf-text-muted">{spec.description}</p>
      )}
    </div>
  );
}
