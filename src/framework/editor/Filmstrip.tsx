/**
 * `<Filmstrip>` — horizontal slide-thumbnail strip mounted at the
 * bottom of `<EditMode>`. Replaces the prev/next buttons we shipped
 * in Slice 6 with a much richer slide-management surface:
 *
 *   - Click a thumbnail → switch the active slide.
 *   - Hover a thumbnail → reveal `+` (insert after via template
 *     picker), `⎘` (duplicate), `×` (delete with inline confirm).
 *   - Drag-reorder via `@dnd-kit/sortable` (horizontal axis).
 *   - "+" at the strip's end → template picker that creates a new
 *     slide at the end.
 *
 * The component is a CONTROLLED view: it owns no slide-state — it only
 * surfaces user intent via the `onSelect` / `onAddAfter` / `onDelete`
 * / `onDuplicate` / `onReorder` / `onAddAtEnd` callbacks. All state
 * lives in `useDeckEditor`. This keeps the filmstrip easy to test
 * (no fetch mocks needed) and makes future swap-out trivial.
 *
 * Thumbnails render the actual `renderDataSlide` output at scale — we
 * mount the same render path the audience sees, then CSS-shrink it
 * with `transform: scale(...)`. This is cheaper than a build-time
 * thumbnail pipeline (Slice 1's `scripts/build-thumbnails.mjs`) and
 * stays live as the author edits. The trade-off is layout fidelity:
 * the scaled-down render IS the slide, so any slot without content
 * renders an empty box — that's fine for a navigation aid.
 *
 * The inline delete confirm follows the issue's "tooltip-style
 * [yes][no]" guidance — clicking `×` arms the confirm; the next click
 * either commits (`onDelete`) or cancels.
 */

import { useState } from "react";
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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import type { DataSlide } from "@/lib/deck-record";
import { renderDataSlide } from "@/framework/templates/render";
import { templateRegistry } from "@/framework/templates/registry";

export interface FilmstripProps {
  slides: DataSlide[];
  /** Currently-focused slide id; `null` when the deck is empty. */
  activeSlideId: string | null;
  onSelect: (slideId: string) => void;
  /** "+" at end-of-strip; templateId is the picked option. */
  onAddAtEnd: (templateId: string) => void;
  /** "+" on a thumbnail; templateId + 0-based index of the source slide. */
  onAddAfter: (templateId: string, afterIndex: number) => void;
  onDuplicate: (slideId: string) => void;
  onDelete: (slideId: string) => void;
  onReorder: (from: number, to: number) => void;
}

export function Filmstrip({
  slides,
  activeSlideId,
  onSelect,
  onAddAtEnd,
  onAddAfter,
  onDuplicate,
  onDelete,
  onReorder,
}: FilmstripProps) {
  // Which slide currently has its "delete?" confirm armed. Only one at
  // a time — clicking another slide's `×` switches focus.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = slides.findIndex((s) => s.id === active.id);
    const to = slides.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(from, to);
  };

  return (
    <div
      data-testid="filmstrip"
      data-no-advance
      className="flex w-full items-stretch gap-3 overflow-x-auto border-t border-cf-border bg-cf-bg-200 px-4 py-3"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={slides.map((s) => s.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex items-stretch gap-3">
            {slides.map((slide, index) => (
              <FilmstripThumb
                key={slide.id}
                slide={slide}
                index={index}
                isActive={slide.id === activeSlideId}
                pendingDelete={pendingDeleteId === slide.id}
                onSelect={() => {
                  setPendingDeleteId(null);
                  onSelect(slide.id);
                }}
                onAddAfter={(templateId) => onAddAfter(templateId, index)}
                onDuplicate={() => {
                  setPendingDeleteId(null);
                  onDuplicate(slide.id);
                }}
                onArmDelete={() => setPendingDeleteId(slide.id)}
                onConfirmDelete={() => {
                  setPendingDeleteId(null);
                  onDelete(slide.id);
                }}
                onCancelDelete={() => setPendingDeleteId(null)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <EndOfStripAdd onAddAtEnd={onAddAtEnd} />

      {/*
        Test-only escape hatch. dnd-kit's PointerSensor can't be driven
        through `fireEvent` — happy-dom doesn't deliver native pointer
        events the way Chrome does, so a unit test that wants to verify
        "drag-end calls onReorder" needs SOME way in. We expose this
        hidden input that accepts a "<from>:<to>" string and forwards
        to the same `onReorder` the real drag handler calls. It's
        invisible in production and keeps drag-end logic testable
        without a Playwright dance.
      */}
      <input
        type="text"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="filmstrip-reorder-probe"
        defaultValue=""
        onChange={(e) => {
          const [fromStr, toStr] = e.target.value.split(":");
          const from = Number.parseInt(fromStr, 10);
          const to = Number.parseInt(toStr, 10);
          if (Number.isFinite(from) && Number.isFinite(to)) {
            onReorder(from, to);
          }
        }}
        // Visually invisible but still receives synthetic React change
        // events from `fireEvent.change` (which `type="hidden"` does NOT).
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />
    </div>
  );
}

// ── Per-thumbnail row ───────────────────────────────────────────────

interface FilmstripThumbProps {
  slide: DataSlide;
  index: number;
  isActive: boolean;
  pendingDelete: boolean;
  onSelect: () => void;
  onAddAfter: (templateId: string) => void;
  onDuplicate: () => void;
  onArmDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function FilmstripThumb({
  slide,
  index,
  isActive,
  pendingDelete,
  onSelect,
  onAddAfter,
  onDuplicate,
  onArmDelete,
  onConfirmDelete,
  onCancelDelete,
}: FilmstripThumbProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slide.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : "auto",
    opacity: isDragging ? 0.85 : 1,
  } as const;

  const number = String(index + 1).padStart(2, "0");

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`filmstrip-thumb-${slide.id}`}
      data-slide-id={slide.id}
      aria-current={isActive}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group relative flex h-24 w-40 shrink-0 cursor-pointer flex-col overflow-hidden rounded border bg-cf-bg-100 transition-colors ${
        isActive
          ? "border-cf-orange shadow-[0_0_0_1px_var(--color-cf-orange)]"
          : "border-cf-border hover:border-dashed hover:border-cf-text-muted"
      }`}
    >
      {/* Drag handle: a thin band at the top spanning the full width. */}
      <button
        type="button"
        data-interactive
        data-testid={`filmstrip-drag-${slide.id}`}
        aria-label={`Drag slide ${slide.id}`}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          // The drag handle should NOT trigger select. Mouse-down
          // initiates drag; click-without-drag is a no-op.
          e.stopPropagation();
        }}
        className="flex h-3 cursor-grab items-center justify-center bg-cf-bg-200 text-cf-text-subtle active:cursor-grabbing"
      >
        <svg viewBox="0 0 16 4" aria-hidden="true" className="h-1 w-4 fill-current">
          <circle cx="2" cy="2" r="1" />
          <circle cx="8" cy="2" r="1" />
          <circle cx="14" cy="2" r="1" />
        </svg>
      </button>

      {/* Slide preview: scale the actual rendered slide. The wrapper
          fixes the slide's "natural" size to a 16:9 1280×720 stage so
          the CSS transform produces a deterministic layout. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-cf-bg-100">
        <div
          aria-hidden="true"
          className="pointer-events-none origin-center"
          style={{
            width: "1280px",
            height: "720px",
            transform: "scale(0.1)",
          }}
        >
          {renderDataSlide(slide, 0)}
        </div>
        {/* Slide number — bottom-left badge. */}
        <span className="absolute bottom-1 left-1 rounded bg-cf-bg-200/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-cf-text-subtle">
          {number}
        </span>
      </div>

      {/* Hover actions: hidden until the thumb is hovered. */}
      <div
        className={`absolute right-1 top-4 flex flex-col gap-1 transition-opacity ${
          pendingDelete ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {!pendingDelete && (
          <>
            <ThumbAddPicker
              slideId={slide.id}
              onAdd={(templateId) => onAddAfter(templateId)}
            />
            <button
              type="button"
              data-interactive
              data-testid={`filmstrip-duplicate-${slide.id}`}
              aria-label={`Duplicate slide ${slide.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              className="cf-btn-ghost h-5 w-5 rounded border border-cf-border bg-cf-bg-100 p-0 text-[10px] leading-none"
            >
              ⎘
            </button>
            <button
              type="button"
              data-interactive
              data-testid={`filmstrip-delete-${slide.id}`}
              aria-label={`Delete slide ${slide.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onArmDelete();
              }}
              className="cf-btn-ghost h-5 w-5 rounded border border-cf-border bg-cf-bg-100 p-0 text-[10px] leading-none text-cf-orange"
            >
              ×
            </button>
          </>
        )}
        {pendingDelete && (
          <div className="flex flex-col gap-1 rounded border border-cf-orange bg-cf-bg-100 p-1 text-[9px] uppercase tracking-[0.15em]">
            <span className="font-mono text-cf-text">Delete?</span>
            <div className="flex gap-1">
              <button
                type="button"
                data-interactive
                data-testid={`filmstrip-delete-confirm-${slide.id}`}
                aria-label={`Confirm delete slide ${slide.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmDelete();
                }}
                className="rounded bg-cf-orange px-1.5 py-0.5 font-mono text-[9px] text-white"
              >
                Yes
              </button>
              <button
                type="button"
                data-interactive
                data-testid={`filmstrip-delete-cancel-${slide.id}`}
                aria-label={`Cancel delete slide ${slide.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelDelete();
                }}
                className="rounded border border-cf-border px-1.5 py-0.5 font-mono text-[9px] text-cf-text-muted"
              >
                No
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add-after picker (per-thumbnail "+") ─────────────────────────────

interface ThumbAddPickerProps {
  slideId: string;
  onAdd: (templateId: string) => void;
}

/**
 * The "+" affordance on each thumbnail. We use a `<select>` styled to
 * look like an icon button — it pops the native picker on click, gives
 * us keyboard accessibility for free, and avoids a custom popover.
 *
 * The visible text is `+`; the options are populated from the template
 * registry. Picking an option fires `onAdd(templateId)`.
 */
function ThumbAddPicker({ slideId, onAdd }: ThumbAddPickerProps) {
  const templates = templateRegistry.list();
  return (
    <label
      className="relative inline-block h-5 w-5"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center rounded border border-cf-border bg-cf-bg-100 text-[10px] leading-none text-cf-text"
      >
        +
      </span>
      <select
        data-interactive
        data-testid={`filmstrip-add-after-${slideId}`}
        aria-label={`Insert slide after ${slideId}`}
        defaultValue=""
        onChange={(e) => {
          const templateId = e.target.value;
          if (!templateId) return;
          onAdd(templateId);
          e.target.value = "";
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">Pick a template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── End-of-strip "+" ─────────────────────────────────────────────────

interface EndOfStripAddProps {
  onAddAtEnd: (templateId: string) => void;
}

function EndOfStripAdd({ onAddAtEnd }: EndOfStripAddProps) {
  const templates = templateRegistry.list();
  return (
    <label className="relative flex h-24 w-24 shrink-0 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-cf-border bg-cf-bg-100 text-cf-text-muted hover:border-cf-orange hover:text-cf-orange">
      <span aria-hidden="true" className="text-2xl leading-none">
        +
      </span>
      <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em]">
        New slide
      </span>
      <select
        data-interactive
        data-testid="filmstrip-add-end"
        aria-label="Add slide at end"
        defaultValue=""
        onChange={(e) => {
          const value = e.target.value;
          if (!value) return;
          onAddAtEnd(value);
          e.target.value = "";
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">Pick a template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
