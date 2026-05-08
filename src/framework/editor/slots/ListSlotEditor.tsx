/**
 * `<ListSlotEditor>` — vertical list of text inputs, one per item.
 *
 * Edits `{ kind: "list", items: string[], revealAt? }`.
 *
 * Capabilities:
 *   - Edit any item via its inline text input.
 *   - Add a new (empty) item via the "+ Add item" button.
 *   - Remove an item via its delete button.
 *   - Reorder items via @dnd-kit drag handle (mouse) OR the move-up /
 *     move-down buttons (keyboard / a11y / test-friendly).
 *
 * Why both drag and explicit move buttons:
 *   - dnd-kit's pointer drag gives the polished mouse UX (matching the
 *     filmstrip + SlideManager).
 *   - dnd-kit's keyboard sensor is fiddly to drive in happy-dom and
 *     trips on `scrollIntoView` polyfills. The explicit move-up /
 *     move-down buttons give us a deterministic reorder path that
 *     tests can hit with a single `fireEvent.click()` AND give
 *     keyboard users a discoverable affordance.
 *
 * Stable IDs for dnd-kit:
 *   `useSortable` requires unique IDs per row. List items are plain
 *   strings (no inherent id); we maintain a parallel `rowIds: string[]`
 *   in local state, synced to `value.items.length`. Mutations that
 *   reorder go through a single helper that mutates items + ids in
 *   lockstep.
 *
 * Sparse JSON: `revealAt` is preserved across every emission. Items
 * arrays are always emitted (a list can be legitimately empty).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";

export interface ListSlotEditorProps {
  name: string;
  spec: SlotSpec;
  value: Extract<SlotValue, { kind: "list" }>;
  onChange: (next: Extract<SlotValue, { kind: "list" }>) => void;
}

export function ListSlotEditor({
  name,
  spec,
  value,
  onChange,
}: ListSlotEditorProps) {
  // Local stable IDs, synced to items length.
  const idCounter = useRef(0);
  const [rowIds, setRowIds] = useState<string[]>(() =>
    value.items.map((_, i) => `${name}-row-${i}-${idCounter.current++}`),
  );

  // Keep rowIds.length in lockstep with value.items.length. We only
  // grow / shrink — internal reorders happen via the helper below and
  // already keep ids aligned with items.
  useEffect(() => {
    setRowIds((prev) => {
      if (prev.length === value.items.length) return prev;
      if (prev.length < value.items.length) {
        const extras: string[] = [];
        for (let i = prev.length; i < value.items.length; i++) {
          extras.push(`${name}-row-${i}-${idCounter.current++}`);
        }
        return [...prev, ...extras];
      }
      return prev.slice(0, value.items.length);
    });
  }, [value.items.length, name]);

  const emit = useCallback(
    (nextItems: string[]) => {
      const next: Extract<SlotValue, { kind: "list" }> = {
        kind: "list",
        items: nextItems,
      };
      if (value.revealAt !== undefined) next.revealAt = value.revealAt;
      onChange(next);
    },
    [onChange, value.revealAt],
  );

  const editItem = useCallback(
    (index: number, nextValue: string) => {
      const nextItems = value.items.slice();
      nextItems[index] = nextValue;
      emit(nextItems);
    },
    [value.items, emit],
  );

  const addItem = useCallback(() => {
    emit([...value.items, ""]);
  }, [value.items, emit]);

  const removeItem = useCallback(
    (index: number) => {
      const nextItems = value.items.slice();
      nextItems.splice(index, 1);
      // Keep rowIds in sync immediately so the very next render
      // doesn't show a stale row.
      setRowIds((prev) => {
        const next = prev.slice();
        next.splice(index, 1);
        return next;
      });
      emit(nextItems);
    },
    [value.items, emit],
  );

  const reorder = useCallback(
    (from: number, to: number) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= value.items.length ||
        to >= value.items.length
      ) {
        return;
      }
      const nextItems = arrayMove(value.items, from, to);
      setRowIds((prev) => arrayMove(prev, from, to));
      emit(nextItems);
    },
    [value.items, emit],
  );

  // dnd-kit sensors. Same pattern as SlideManager.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rowIds.indexOf(String(active.id));
    const newIndex = rowIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    reorder(oldIndex, newIndex);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label
          className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
        >
          {spec.label}
          {spec.required && (
            <span aria-label="required" className="ml-1 text-cf-orange">
              *
            </span>
          )}
        </label>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-muted">
          {value.items.length} {value.items.length === 1 ? "item" : "items"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 rounded border border-cf-border bg-cf-bg-100 p-2">
        {value.items.length === 0 ? (
          <p
            data-testid={`slot-list-empty-${name}`}
            className="px-1 py-2 text-xs italic text-cf-text-muted"
          >
            No items yet — click &ldquo;+ Add item&rdquo; below.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={rowIds}
              strategy={verticalListSortingStrategy}
            >
              {value.items.map((item, index) => (
                <ListRow
                  key={rowIds[index] ?? `${name}-row-fallback-${index}`}
                  rowId={rowIds[index] ?? `${name}-row-fallback-${index}`}
                  name={name}
                  index={index}
                  item={item}
                  total={value.items.length}
                  onEdit={(next) => editItem(index, next)}
                  onRemove={() => removeItem(index)}
                  onMoveUp={() => reorder(index, index - 1)}
                  onMoveDown={() => reorder(index, index + 1)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        <button
          type="button"
          data-interactive
          data-testid={`slot-list-add-${name}`}
          onClick={addItem}
          className="cf-btn-ghost mt-1 self-start text-xs"
        >
          + Add item
        </button>
      </div>

      {spec.description && (
        <p className="text-xs text-cf-text-muted">{spec.description}</p>
      )}
    </div>
  );
}

interface ListRowProps {
  rowId: string;
  name: string;
  index: number;
  item: string;
  total: number;
  onEdit: (next: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function ListRow({
  rowId,
  name,
  index,
  item,
  total,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ListRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rowId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : "auto",
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`slot-list-row-${name}-${index}`}
      className="flex items-center gap-1.5"
    >
      {/* Drag handle (pointer / mouse drag). */}
      <button
        type="button"
        data-interactive
        data-testid={`slot-list-drag-${name}-${index}`}
        aria-label={`Drag item ${index + 1}`}
        {...attributes}
        {...listeners}
        className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-cf-text-subtle hover:text-cf-text active:cursor-grabbing"
      >
        <svg
          viewBox="0 0 12 16"
          aria-hidden="true"
          className="h-4 w-3 fill-current"
        >
          <circle cx="3" cy="3" r="1.2" />
          <circle cx="9" cy="3" r="1.2" />
          <circle cx="3" cy="8" r="1.2" />
          <circle cx="9" cy="8" r="1.2" />
          <circle cx="3" cy="13" r="1.2" />
          <circle cx="9" cy="13" r="1.2" />
        </svg>
      </button>

      {/* Item text. */}
      <input
        type="text"
        data-interactive
        data-testid={`slot-list-item-${name}-${index}`}
        aria-label={`Item ${index + 1}`}
        value={item}
        onChange={(e) => onEdit(e.target.value)}
        className="flex-1 rounded border border-cf-border bg-cf-bg-100 px-2 py-1.5 text-sm text-cf-text outline-none focus:border-cf-orange"
      />

      {/* Move-up / move-down (a11y + test-friendly reorder path). */}
      <button
        type="button"
        data-interactive
        data-testid={`slot-list-move-up-${name}-${index}`}
        aria-label={`Move item ${index + 1} up`}
        disabled={index === 0}
        onClick={onMoveUp}
        className="cf-btn-ghost h-7 w-7 p-0 text-xs disabled:cursor-not-allowed disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        data-interactive
        data-testid={`slot-list-move-down-${name}-${index}`}
        aria-label={`Move item ${index + 1} down`}
        disabled={index === total - 1}
        onClick={onMoveDown}
        className="cf-btn-ghost h-7 w-7 p-0 text-xs disabled:cursor-not-allowed disabled:opacity-30"
      >
        ↓
      </button>

      {/* Delete. */}
      <button
        type="button"
        data-interactive
        data-testid={`slot-list-remove-${name}-${index}`}
        aria-label={`Remove item ${index + 1}`}
        onClick={onRemove}
        className="cf-btn-ghost h-7 w-7 p-0 text-xs"
      >
        ×
      </button>
    </div>
  );
}
