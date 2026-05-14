/**
 * `<SlideManager>` — admin-only right-side overlay for editing the slide
 * list of a deck. Triggered by the `M` key in `<Deck>` and gated by
 * `usePresenterMode()` so it never appears on the public viewer.
 *
 * Capabilities (v1, locked by the orchestrator):
 *   - Reorder slides (drag handles)
 *   - Hide / show a slide (eye toggle)
 *   - Rename a slide (text input)
 *   - Edit speaker notes as markdown (inline textarea + preview)
 *
 * Out of scope: duplicate / delete (those create or remove source files,
 * which fights the manifest-override pattern). The author opens the IDE
 * for those operations — there's a footer hint in the sidebar.
 *
 * Live-preview model:
 *   - The component owns a local `draft` state mirroring the form.
 *   - On every change it calls `applyDraft(draft)` from `useDeckManifest`,
 *     so `<Deck>` re-runs `mergeSlides` and the visible slide list updates
 *     instantly.
 *   - Save POSTs the draft to `/api/admin/manifests/<slug>` and refetches.
 *   - Reset DELETEs the KV key and clears the draft to source defaults.
 *
 * Drafts persist in component state until Save / Reset; closing and
 * re-opening the sidebar discards them (the sidebar reseeds from the
 * persisted manifest each open).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import ReactMarkdown from "react-markdown";
import { easeEntrance } from "@/lib/motion";
import { richtextProseClasses } from "@/templates/richtext-prose";
import {
  MANIFEST_VERSION,
  MAX_NOTES_LENGTH,
  type Manifest,
  type SlideOverride,
} from "@/lib/manifest";
import type { SlideDef } from "./types";
import type { UseDeckManifestResult } from "./useDeckManifest";

export interface SlideManagerProps {
  open: boolean;
  slug: string;
  /** Source slides as authored in code (no manifest applied). */
  sourceSlides: SlideDef[];
  manifest: UseDeckManifestResult;
  onClose: () => void;
  /**
   * ToC nav: jump the deck cursor to the slide at the given effective-slides
   * index. The cursor is keyed against the full effective list (Hidden
   * included) per ADR 0003, so calling this with a Hidden row's index DOES
   * land on the Hidden slide without un-hiding it — admin can pull up a
   * supporting slide during Q&A.
   *
   * Optional so unit tests that only exercise editing affordances don't
   * have to pass a stub. In `<Deck>` it's always wired.
   */
  onNavigateToSlide?: (effectiveIndex: number) => void;
}

interface DraftRow {
  id: string;
  /** Source slide for fallback values (title, notes preview placeholder). */
  source: SlideDef;
  override: SlideOverride;
}

type SaveState = "idle" | "saving" | "error";

const MAX_TITLE = 200;

// ── Draft / manifest helpers ─────────────────────────────────────────────

function buildInitialRows(
  sourceSlides: SlideDef[],
  applied: Manifest | null,
): DraftRow[] {
  const sourceById = new Map(sourceSlides.map((s) => [s.id, s]));
  const rows: DraftRow[] = [];
  const seen = new Set<string>();

  if (applied) {
    for (const id of applied.order) {
      const source = sourceById.get(id);
      if (!source) continue;
      seen.add(id);
      rows.push({
        id,
        source,
        override: { ...(applied.overrides[id] ?? {}) },
      });
    }
  }
  // Append source slides not in the manifest.
  for (const slide of sourceSlides) {
    if (seen.has(slide.id)) continue;
    rows.push({ id: slide.id, source: slide, override: {} });
  }
  return rows;
}

function rowsToManifest(rows: DraftRow[]): Manifest {
  const overrides: Record<string, SlideOverride> = {};
  for (const row of rows) {
    if (Object.keys(row.override).length > 0) {
      overrides[row.id] = { ...row.override };
    }
  }
  return {
    version: MANIFEST_VERSION,
    order: rows.map((row) => row.id),
    overrides,
    updatedAt: new Date().toISOString(),
  };
}

// ── Sortable row ──────────────────────────────────────────────────────────

interface RowProps {
  row: DraftRow;
  index: number;
  slug: string;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onTitleChange: (next: string) => void;
  onNotesChange: (next: string) => void;
  onToggleHidden: () => void;
  /**
   * ToC nav: invoked when the row's "navigate" surface is clicked. The
   * row delegates to `<SlideManager>`'s `onNavigateToSlide`, which the
   * parent (`<Deck>`) wires to `gotoWithBeacon(effectiveIndex)`.
   *
   * The rename input, drag handle, hide button, and notes button each
   * carry `data-interactive` (or are native interactive elements) so
   * their clicks don't bubble up as nav — see `shouldSuppressRowClick`.
   */
  onNavigate?: () => void;
}

/**
 * True if the click target (or any ancestor up to the row root) is an
 * interactive control — the rename input, drag handle, hide button,
 * notes button, etc. Rows defer to row-level navigation only when the
 * raw row background was clicked.
 *
 * The lookup is scoped to ancestors INSIDE the row (`rowEl`). The
 * sidebar itself sits inside `<aside data-no-advance>`, and naively
 * using `target.closest("[data-no-advance]")` would walk up past the
 * row root and suppress every click. `data-no-advance` is for
 * click-to-advance suppression on the Deck viewport, not for ToC nav.
 */
function shouldSuppressRowClick(
  target: EventTarget | null,
  rowEl: Element,
): boolean {
  if (!(target instanceof Element)) return false;
  if (typeof window !== "undefined" && window.getSelection()?.toString()) {
    return true;
  }
  const interactive = target.closest(
    "[data-interactive], a, button, input, select, textarea, label, [contenteditable=true]",
  );
  if (!interactive) return false;
  return rowEl.contains(interactive);
}

function SlideRow({
  row,
  index,
  slug,
  notesOpen,
  onToggleNotes,
  onTitleChange,
  onNotesChange,
  onToggleHidden,
  onNavigate,
}: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : "auto",
    opacity: isDragging ? 0.85 : 1,
  };

  const titleValue = row.override.title ?? row.source.title ?? "";
  const notesValue = row.override.notes ?? "";
  const hidden = row.override.hidden ?? row.source.hidden ?? false;
  const thumbSrc = `/thumbnails/${slug}/${String(index + 1).padStart(2, "0")}.png`;
  // Local fallback flag so we don't try to render a missing image.
  const [imageFailed, setImageFailed] = useState(false);

  // Re-evaluate fallback when the underlying index changes (after drag).
  useEffect(() => {
    setImageFailed(false);
  }, [index, slug]);

  // ── Row click ⇒ ToC nav ────────────────────────────────────────────
  // The row delegates to `onNavigate` only when the click missed every
  // inner interactive control (rename input, drag handle, hide / notes
  // buttons). Drag operations are filtered separately — `useSortable`
  // sets `isDragging` for the duration of a drag, so we ignore those
  // click events to avoid a navigation firing as the drag completes.
  const handleRowClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!onNavigate) return;
    if (isDragging) return;
    if (shouldSuppressRowClick(e.target, e.currentTarget)) return;
    onNavigate();
  };

  const handleRowKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onNavigate) return;
    // Don't hijack typing inside the rename input / notes textarea.
    if (shouldSuppressRowClick(e.target, e.currentTarget)) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNavigate();
    }
  };

  return (
    <div
      ref={setNodeRef}
      data-testid="slide-manager-row"
      data-slide-id={row.id}
      data-hidden={hidden ? "true" : undefined}
      style={style}
      onClick={onNavigate ? handleRowClick : undefined}
      onKeyDown={onNavigate ? handleRowKeyDown : undefined}
      role={onNavigate ? "button" : undefined}
      tabIndex={onNavigate ? 0 : undefined}
      aria-label={
        onNavigate
          ? `Go to slide ${row.source.title ?? row.id}${hidden ? " (hidden)" : ""}`
          : undefined
      }
      // Hidden styling: muted text color across the whole row, but
      // strike-through is scoped to the title input below (and the
      // thumbnail kicker) — applying line-through to the row would
      // cross out the HIDE / NOTES buttons, which the author still
      // needs to be able to read and click.
      className={`flex flex-col gap-2 border-b border-cf-border px-4 py-3 ${
        onNavigate ? "cursor-pointer hover:bg-cf-bg-200/40" : ""
      } ${hidden ? "text-cf-text-subtle" : ""}`}
    >
      <div className="flex items-center gap-3">
        {/* Drag handle. Only this triggers a sort. */}
        <button
          type="button"
          data-interactive
          data-testid="slide-manager-drag-handle"
          aria-label={`Drag slide ${row.source.title ?? row.id}`}
          {...attributes}
          {...listeners}
          className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-cf-text-subtle hover:text-cf-text active:cursor-grabbing"
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

        {/* Thumbnail. */}
        <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-cf-border bg-cf-bg-200">
          {imageFailed ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-cf-text-subtle">
              {String(index + 1).padStart(2, "0")}
            </span>
          ) : (
            <img
              src={thumbSrc}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover"
            />
          )}
        </div>

        {/* Title. */}
        <input
          type="text"
          data-interactive
          data-testid="slide-manager-title-input"
          aria-label={`Title for slide ${row.id}`}
          value={titleValue}
          maxLength={MAX_TITLE}
          spellCheck={false}
          onChange={(e) => onTitleChange(e.target.value)}
          // Hidden rows: muted color + strike-through baked onto the input
          // itself, since form controls don't inherit text-decoration from
          // their parent in most browsers.
          className={`flex-1 rounded border border-cf-border bg-transparent px-2 py-1 text-sm ${
            hidden ? "text-cf-text-subtle line-through" : "text-cf-text"
          }`}
        />

        {/* Hidden toggle. */}
        <button
          type="button"
          data-interactive
          data-testid="slide-manager-toggle-hidden"
          aria-label={hidden ? "Show slide" : "Hide slide"}
          aria-pressed={hidden}
          onClick={onToggleHidden}
          className="cf-btn-ghost h-8 px-2"
        >
          {hidden ? "Show" : "Hide"}
        </button>

        {/* Notes toggle. */}
        <button
          type="button"
          data-interactive
          data-testid="slide-manager-toggle-notes"
          aria-label={notesOpen ? "Collapse notes" : "Edit notes"}
          aria-pressed={notesOpen}
          onClick={onToggleNotes}
          className="cf-btn-ghost h-8 px-2"
        >
          Notes
        </button>
      </div>

      {notesOpen && (
        <NotesEditor
          slideId={row.id}
          value={notesValue}
          onChange={onNotesChange}
        />
      )}
    </div>
  );
}

// ── Notes editor ──────────────────────────────────────────────────────────

interface NotesEditorProps {
  slideId: string;
  value: string;
  onChange: (next: string) => void;
}

function NotesEditor({ slideId, value, onChange }: NotesEditorProps) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const charCount = value.length;
  const overLimit = charCount > MAX_NOTES_LENGTH;

  return (
    <div className="ml-9 flex flex-col gap-2 rounded border border-cf-border bg-cf-bg-200/40 p-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            type="button"
            data-interactive
            data-testid="slide-manager-notes-tab-edit"
            aria-pressed={tab === "edit"}
            onClick={() => setTab("edit")}
            className={`font-mono text-[10px] uppercase tracking-[0.25em] px-2 py-1 ${
              tab === "edit"
                ? "text-cf-text"
                : "text-cf-text-subtle hover:text-cf-text"
            }`}
          >
            Edit
          </button>
          <button
            type="button"
            data-interactive
            data-testid="slide-manager-notes-tab-preview"
            aria-pressed={tab === "preview"}
            onClick={() => setTab("preview")}
            className={`font-mono text-[10px] uppercase tracking-[0.25em] px-2 py-1 ${
              tab === "preview"
                ? "text-cf-text"
                : "text-cf-text-subtle hover:text-cf-text"
            }`}
          >
            Preview
          </button>
        </div>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.2em] ${
            overLimit ? "text-cf-danger" : "text-cf-text-subtle"
          }`}
        >
          {charCount} / {MAX_NOTES_LENGTH}
        </span>
      </div>
      {tab === "edit" ? (
        <textarea
          data-interactive
          data-testid="slide-manager-notes-editor"
          aria-label={`Notes for slide ${slideId}`}
          rows={6}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck
          className="min-h-[8rem] w-full resize-y rounded border border-cf-border bg-cf-bg-100 px-2 py-2 font-mono text-xs text-cf-text"
        />
      ) : (
        <div
          data-testid="slide-manager-notes-preview"
          className={`rounded border border-dashed border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text ${richtextProseClasses}`}
        >
          {value ? (
            <ReactMarkdown>{value}</ReactMarkdown>
          ) : (
            <p className="text-cf-text-subtle">
              <em>(empty — falls back to source notes)</em>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── SlideManager ──────────────────────────────────────────────────────────

export function SlideManager({
  open,
  slug,
  sourceSlides,
  manifest,
  onClose,
  onNavigateToSlide,
}: SlideManagerProps) {
  const { manifest: persisted, applyDraft, clearDraft, refetch } = manifest;

  const [rows, setRows] = useState<DraftRow[]>(() =>
    buildInitialRows(sourceSlides, persisted),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [openNotesId, setOpenNotesId] = useState<string | null>(null);

  // Re-seed when the sidebar opens, or when persisted state changes
  // (Save / Reset / refetch). Mirrors ThemeSidebar's pattern.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setRows(buildInitialRows(sourceSlides, persisted));
      setSaveState("idle");
      setStatusMessage(null);
      setOpenNotesId(null);
    }
    prevOpen.current = open;
  }, [open, persisted, sourceSlides]);

  // If the persisted manifest changes while open (e.g. another tab saved),
  // re-seed rows. This intentionally drops in-flight drafts; v1 KV is
  // last-write-wins and we keep the UI honest about that.
  useEffect(() => {
    if (open) {
      setRows(buildInitialRows(sourceSlides, persisted));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persisted]);

  // Whenever rows change, push a draft up so <Deck> can live-preview.
  useEffect(() => {
    if (!open) return;
    applyDraft(rowsToManifest(rows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const baselineRows = useMemo(
    () => buildInitialRows(sourceSlides, persisted),
    [sourceSlides, persisted],
  );

  const isDirty = useMemo(
    () => !rowsAreEqual(rows, baselineRows),
    [rows, baselineRows],
  );

  // ── Sortable sensors ──────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRows((prev) => {
      const oldIndex = prev.findIndex((r) => r.id === active.id);
      const newIndex = prev.findIndex((r) => r.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  // ── Per-row mutation ──────────────────────────────────────────────
  const updateOverride = useCallback(
    (id: string, patch: (prev: SlideOverride, source: SlideDef) => SlideOverride) => {
      setRows((prev) =>
        prev.map((row) =>
          row.id === id
            ? { ...row, override: patch(row.override, row.source) }
            : row,
        ),
      );
    },
    [],
  );

  const onTitleChange = useCallback(
    (id: string, next: string) => {
      updateOverride(id, (override, source) => {
        const cleaned = next.slice(0, MAX_TITLE);
        // If the new value matches the source title, drop the override
        // entirely so the manifest stays sparse.
        if (cleaned === (source.title ?? "")) {
          const { title: _t, ...rest } = override;
          return rest;
        }
        return { ...override, title: cleaned };
      });
    },
    [updateOverride],
  );

  const onNotesChange = useCallback(
    (id: string, next: string) => {
      updateOverride(id, (override) => {
        // Cap the length so a paste of a giant blob doesn't quietly
        // exceed the server's 10000-char ceiling. The author still sees
        // the over-limit count in the editor, but this stops a runaway.
        const cleaned = next.slice(0, MAX_NOTES_LENGTH);
        return { ...override, notes: cleaned };
      });
    },
    [updateOverride],
  );

  const onToggleHidden = useCallback(
    (id: string) => {
      updateOverride(id, (override, source) => {
        const sourceHidden = source.hidden ?? false;
        const current = override.hidden ?? sourceHidden;
        const nextHidden = !current;
        if (nextHidden === sourceHidden) {
          const { hidden: _h, ...rest } = override;
          return rest;
        }
        return { ...override, hidden: nextHidden };
      });
    },
    [updateOverride],
  );

  // ── Save / Reset / Close ──────────────────────────────────────────
  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const payload = rowsToManifest(rows);
      // Client-side guard: notes within the 10000 char limit. The server
      // also validates but we surface a clear inline error here.
      for (const [id, override] of Object.entries(payload.overrides)) {
        if (override.notes && override.notes.length > MAX_NOTES_LENGTH) {
          setSaveState("error");
          setStatusMessage(
            `Notes for slide "${id}" exceed ${MAX_NOTES_LENGTH} chars.`,
          );
          return;
        }
      }
      setSaveState("saving");
      setStatusMessage(null);
      try {
        const res = await fetch(
          `/api/admin/manifests/${encodeURIComponent(slug)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              order: payload.order,
              overrides: payload.overrides,
            }),
          },
        );
        if (!res.ok) {
          setSaveState("error");
          setStatusMessage(`Save failed (${res.status}).`);
          return;
        }
        await refetch();
        setSaveState("idle");
        setStatusMessage("Saved.");
      } catch {
        setSaveState("error");
        setStatusMessage("Save failed (network).");
      }
    },
    [rows, slug, refetch],
  );

  const onReset = useCallback(async () => {
    setSaveState("saving");
    setStatusMessage(null);
    try {
      const res = await fetch(
        `/api/admin/manifests/${encodeURIComponent(slug)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        setSaveState("error");
        setStatusMessage(`Reset failed (${res.status}).`);
        return;
      }
      await refetch();
      clearDraft();
      setRows(buildInitialRows(sourceSlides, null));
      setSaveState("idle");
      setStatusMessage("Reset to source.");
    } catch {
      setSaveState("error");
      setStatusMessage("Reset failed (network).");
    }
  }, [slug, refetch, clearDraft, sourceSlides]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="slide-manager"
          data-testid="slide-manager"
          data-no-advance
          aria-label="Slide manager"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.2, ease: easeEntrance }}
          className="absolute right-0 top-0 z-50 flex h-full w-[480px] flex-col border-l border-cf-border bg-cf-bg-100 text-cf-text shadow-[0_0_0_1px_var(--color-cf-border)]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-cf-border px-5 py-4">
            <div>
              <p className="cf-tag">Manifest</p>
              <h2 className="mt-1 flex items-center gap-2 text-lg font-medium tracking-[-0.02em]">
                Slides
                {isDirty && (
                  <span
                    aria-label="unsaved changes"
                    title="Unsaved changes"
                    data-testid="slide-manager-dirty-indicator"
                    className="inline-block h-2 w-2 rounded-full bg-cf-orange"
                  />
                )}
              </h2>
            </div>
            <button
              type="button"
              data-interactive
              data-testid="slide-manager-close"
              onClick={onClose}
              aria-label="Close slide manager"
              className="cf-btn-ghost"
            >
              Esc
            </button>
          </header>

          <form
            onSubmit={onSubmit}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={rows.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {rows.map((row, index) => (
                    <SlideRow
                      key={row.id}
                      row={row}
                      index={index}
                      slug={slug}
                      notesOpen={openNotesId === row.id}
                      onToggleNotes={() =>
                        setOpenNotesId((cur) => (cur === row.id ? null : row.id))
                      }
                      onTitleChange={(next) => onTitleChange(row.id, next)}
                      onNotesChange={(next) => onNotesChange(row.id, next)}
                      onToggleHidden={() => onToggleHidden(row.id)}
                      onNavigate={
                        onNavigateToSlide
                          ? () => onNavigateToSlide(index)
                          : undefined
                      }
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            <footer className="flex flex-col gap-3 border-t border-cf-border px-5 py-4">
              {statusMessage && (
                <p
                  className={`cf-tag ${
                    saveState === "error"
                      ? "text-cf-danger"
                      : "text-cf-text-muted"
                  }`}
                  role="status"
                >
                  {statusMessage}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  data-interactive
                  data-testid="slide-manager-save"
                  disabled={!isDirty || saveState === "saving"}
                  className="cf-btn-ghost flex-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saveState === "saving" ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  data-interactive
                  data-testid="slide-manager-reset"
                  onClick={onReset}
                  disabled={!persisted || saveState === "saving"}
                  className="cf-btn-ghost flex-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset
                </button>
              </div>
              <p className="cf-tag text-cf-text-subtle">
                To add or delete slides, open in IDE →
              </p>
            </footer>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

// ── Equality helper ───────────────────────────────────────────────────────

function rowsAreEqual(a: DraftRow[], b: DraftRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id) return false;
    if (!overridesEqual(x.override, y.override)) return false;
  }
  return true;
}

function overridesEqual(a: SlideOverride, b: SlideOverride): boolean {
  return (
    (a.hidden ?? null) === (b.hidden ?? null) &&
    (a.title ?? null) === (b.title ?? null) &&
    (a.notes ?? null) === (b.notes ?? null)
  );
}
