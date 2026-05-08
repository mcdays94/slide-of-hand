/**
 * `<StatSlotEditor>` — value + caption inputs with a live preview.
 *
 * Edits `{ kind: "stat", value, caption?, revealAt? }`.
 *
 * Layout:
 *   - Big text input for the stat value (e.g. "42", "1.2M").
 *   - Smaller text input for the optional caption.
 *   - Live preview below: stylistically mirrors `renderSlot()` in
 *     `src/framework/templates/render.tsx` — the deck renderer puts a
 *     `<strong>` value above an optional `<span>` caption inside a
 *     `.cf-stat` container. The editor's preview applies template-scale
 *     typography so authors see how the stat reads in a slide.
 *
 * Sparse JSON: when the caption input is empty, we OMIT the `caption`
 * field from the emitted SlotValue rather than emitting `caption: ""`.
 * Matches the pattern in `slot-types.ts` (`copyOptionalRevealAt`) — the
 * persisted JSON should be minimal.
 *
 * Preserves `revealAt` across all changes so the Slice 9 filmstrip can
 * write it back without us clobbering it here.
 */

import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";

export interface StatSlotEditorProps {
  name: string;
  spec: SlotSpec;
  value: Extract<SlotValue, { kind: "stat" }>;
  onChange: (next: Extract<SlotValue, { kind: "stat" }>) => void;
}

export function StatSlotEditor({
  name,
  spec,
  value,
  onChange,
}: StatSlotEditorProps) {
  const valueId = `slot-${name}-value`;
  const captionId = `slot-${name}-caption`;

  const emit = (nextValue: string, nextCaption: string) => {
    const trimmedCaption = nextCaption;
    const next: Extract<SlotValue, { kind: "stat" }> =
      trimmedCaption.length > 0
        ? { kind: "stat", value: nextValue, caption: trimmedCaption }
        : { kind: "stat", value: nextValue };
    if (value.revealAt !== undefined) next.revealAt = value.revealAt;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={valueId}
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
        <div className="flex flex-col gap-2">
          <input
            id={valueId}
            type="text"
            data-interactive
            data-testid={`slot-stat-value-${name}`}
            aria-label={`${spec.label} — value`}
            value={value.value}
            placeholder={spec.placeholder ?? "42"}
            maxLength={spec.maxLength}
            onChange={(e) => emit(e.target.value, value.caption ?? "")}
            className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-3xl font-medium tracking-[-0.03em] text-cf-text outline-none focus:border-cf-orange"
          />
          <input
            id={captionId}
            type="text"
            data-interactive
            data-testid={`slot-stat-caption-${name}`}
            aria-label={`${spec.label} — caption (optional)`}
            value={value.caption ?? ""}
            placeholder="caption (optional)"
            onChange={(e) => emit(value.value, e.target.value)}
            className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
          />
        </div>
        <div
          data-testid={`slot-stat-preview-${name}`}
          className="flex flex-col items-start justify-center rounded border border-dashed border-cf-border bg-cf-bg-200 px-4 py-3"
        >
          {value.value.length > 0 ? (
            <>
              <strong className="text-5xl font-medium tracking-[-0.04em] text-cf-text">
                {value.value}
              </strong>
              {value.caption !== undefined && value.caption.length > 0 && (
                <span className="mt-1 text-xs uppercase tracking-[0.15em] text-cf-text-muted">
                  {value.caption}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm italic text-cf-text-muted">Preview…</span>
          )}
        </div>
      </div>
      {spec.description && (
        <p className="text-xs text-cf-text-muted">{spec.description}</p>
      )}
    </div>
  );
}
