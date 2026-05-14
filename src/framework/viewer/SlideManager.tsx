/**
 * `<SlideManager>` — the right-side ToC sidebar. Triggered by the `M` key
 * in `<Deck>`. Renders in two roles distinguished by `usePresenterMode()`:
 *
 *   - **Admin** (presenter mode): the full editing surface from #207 +
 *     #208 — drag-reorder, hide / show, rename, notes editor. Hidden
 *     slides are visible in the list (muted + line-through). Triggered
 *     via the same `M` key, gated only by visibility of admin chrome.
 *   - **Audience** (#209): a read-only ToC. Each row is just
 *     `[NN] [thumb] title`, full row clickable. Hidden slides are
 *     filtered out entirely via `getRowsForRole(..., "audience")`. No
 *     drag handle, no eye, no pencil, no note icon — none of those
 *     affordances are useful without admin auth.
 *
 * The user-facing name is the "ToC sidebar" (per CONTEXT.md); the file
 * keeps the historical `SlideManager` identifier.
 *
 * Capabilities — admin only (v1, locked by the orchestrator):
 *   - Reorder slides (drag handles)
 *   - Hide / show a slide (eye toggle)
 *   - Rename a slide (pencil → inline input)
 *   - Edit speaker notes as markdown (note icon → accordion editor)
 *
 * Out of scope: duplicate / delete (those create or remove source files,
 * which fights the manifest-override pattern). The author opens the IDE
 * for those operations — there's a footer hint in the sidebar.
 *
 * Row layout (issue #208, admin only):
 *   Default: `[NN] [thumb] title-span` — clean, low-density.
 *   Hover:   a compact affordance cluster fades in on the right edge:
 *            [grip] [eye] [pencil] [note].
 *   Pencil click: swaps the title span for an inline rename input.
 *   Note click: expands an accordion notes editor BELOW the row,
 *               animated with `easeEntrance` from `@/lib/motion`.
 *
 * Audience row layout (#209):
 *   `[NN] [thumb] title-span`, clickable. No hover cluster of any kind.
 *
 * Live-preview model (admin only):
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
import { mergeSlides } from "@/lib/manifest-merge";
import type { SlideDef } from "./types";
import type { UseDeckManifestResult } from "./useDeckManifest";
import { getRowsForRole, type SlideManagerRole } from "./getRowsForRole";

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
  /**
   * Position of the deck's current cursor slide in the unfiltered
   * effective list. Drives `aria-current="page"` on the matching row +
   * a subtle highlight, so screen-readers + sighted users can tell at
   * a glance which row corresponds to the slide on stage.
   *
   * Optional so unit tests that only exercise editing affordances
   * don't have to pass a stub. In `<Deck>` it's always wired to
   * `cursor.slide`.
   */
  currentSlideEffectiveIndex?: number;
  /**
   * Viewer role. Defaults to `"admin"` so existing call sites (and the
   * #207/#208 admin tests) keep working unchanged. The audience render
   * path (#209) passes `"audience"` to filter out Hidden slides and
   * suppress every editing affordance.
   *
   * `<Deck>` derives this from `usePresenterMode()`: `true` ⇒ `"admin"`,
   * `false` ⇒ `"audience"`. Per CONTEXT.md the `usePresenterMode`
   * context is the **admin-route signal**, despite the historical name.
   */
  role?: SlideManagerRole;
  /**
   * Which side the sidebar anchors to (#210). Defaults to `"right"`
   * for backwards compatibility with the original right-only layout.
   * The slice-5 edge handles open the sidebar from the matching side.
   *
   * The per-user `tocSidebarEdge` preference that lets the audience
   * pick a default lands in the next slice (#211) — for now `<Deck>`
   * passes the side derived from which edge handle was clicked.
   */
  side?: "left" | "right";
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

// ── Affordance cluster icons ──────────────────────────────────────────────
//
// Inline SVGs keep us off any icon-library dependency. All icons are
// 14×14 stroke-currentColor so they inherit the row's text color and
// the cluster button's hover color.

function GripIcon() {
  return (
    <svg viewBox="0 0 12 16" aria-hidden="true" className="h-3.5 w-3 fill-current">
      <circle cx="3" cy="3" r="1.2" />
      <circle cx="9" cy="3" r="1.2" />
      <circle cx="3" cy="8" r="1.2" />
      <circle cx="9" cy="8" r="1.2" />
      <circle cx="3" cy="13" r="1.2" />
      <circle cx="9" cy="13" r="1.2" />
    </svg>
  );
}

function EyeOpenIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M2 4.5s1.6 2.2 3.7 3.3" />
      <path d="M14 4.5s-1.6 2.2-3.7 3.3" />
      <path d="M6 8.3l-0.7 2.2" />
      <path d="M10 8.3l0.7 2.2" />
      <path d="M8 8.6V11" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M11.2 2.8l2 2-7.6 7.6-2.6.6.6-2.6 7.6-7.6Z" />
      <path d="M10.2 3.8l2 2" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M3 2.5h7l3 3v8H3v-11Z" />
      <path d="M10 2.5v3h3" />
      <path d="M5.5 8.5h5" />
      <path d="M5.5 10.8h4" />
    </svg>
  );
}

// ── Sortable row ──────────────────────────────────────────────────────────

interface RowProps {
  row: DraftRow;
  index: number;
  slug: string;
  notesOpen: boolean;
  editingTitle: boolean;
  /**
   * True when this row corresponds to the deck's current cursor slide.
   * Drives `aria-current="page"` on the row + a subtle visual marker.
   */
  isCurrent: boolean;
  onToggleNotes: () => void;
  onBeginEditingTitle: () => void;
  onEndEditingTitle: () => void;
  onTitleChange: (next: string) => void;
  onNotesChange: (next: string) => void;
  onToggleHidden: () => void;
  /**
   * ToC nav: invoked when the row's "navigate" surface is clicked. The
   * row delegates to `<SlideManager>`'s `onNavigateToSlide`, which the
   * parent (`<Deck>`) wires to `gotoEffectiveWithBeacon(effectiveIndex)`.
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
  editingTitle,
  isCurrent,
  onToggleNotes,
  onBeginEditingTitle,
  onEndEditingTitle,
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
  // Section detection: a row is a "section slide" iff its layout is
  // `"section"` — these are full-bleed chapter dividers. Many body
  // slides ALSO carry `sectionLabel` / `sectionNumber` (the chrome
  // kicker on the slide itself), so detecting via `sectionLabel` alone
  // would conflate body slides with dividers and break the hierarchy.
  // The ToC always indents non-section rows (rather than computing
  // "which section am I under"), which is both simpler and behaves
  // correctly even before the first section divider.
  const isSection = row.source.layout === "section";
  const sectionLabel = row.source.sectionLabel;
  const sectionNumber = row.source.sectionNumber;
  // Local fallback flag so we don't try to render a missing image.
  const [imageFailed, setImageFailed] = useState(false);

  // Re-evaluate fallback when the underlying index changes (after drag).
  useEffect(() => {
    setImageFailed(false);
  }, [index, slug]);

  // Focus the input the moment we flip into edit mode. Select-all so
  // the author can immediately replace the title with one keystroke.
  const titleInputRef = useRef<HTMLInputElement>(null);
  // The text we'd revert to on Esc — captured on entry to edit mode.
  const titleAtEditStart = useRef<string>("");
  useEffect(() => {
    if (editingTitle) {
      titleAtEditStart.current = titleValue;
      // Use a microtask so the input has actually mounted.
      requestAnimationFrame(() => {
        const el = titleInputRef.current;
        if (!el) return;
        el.focus();
        el.select();
      });
    }
    // We intentionally only react to the editingTitle flip, not value churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTitle]);

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

  // Inline rename input keyboard handling: Esc cancels (revert), Enter
  // commits (blur). Blur is wired via onBlur to also commit.
  const handleTitleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onTitleChange(titleAtEditStart.current);
      onEndEditingTitle();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onEndEditingTitle();
    }
  };

  return (
    <div
      ref={setNodeRef}
      data-testid="slide-manager-row"
      data-slide-id={row.id}
      data-hidden={hidden ? "true" : undefined}
      data-editing-title={editingTitle ? "true" : undefined}
      data-section={isSection ? "true" : undefined}
      data-current={isCurrent ? "true" : undefined}
      style={style}
      onClick={onNavigate ? handleRowClick : undefined}
      onKeyDown={onNavigate ? handleRowKeyDown : undefined}
      role={onNavigate ? "button" : undefined}
      tabIndex={onNavigate ? 0 : undefined}
      aria-current={onNavigate && isCurrent ? "page" : undefined}
      aria-label={
        onNavigate
          ? `Go to slide ${row.source.title ?? row.id}${hidden ? " (hidden)" : ""}`
          : undefined
      }
      // Hidden styling: muted text color across the whole row, but
      // strike-through is scoped to the title (input / span) below —
      // applying line-through to the row would cross out HIDE / NOTES
      // affordances, which the author still needs to read.
      //
      // `group` enables the hover-revealed affordance cluster below.
      // `relative` anchors the absolutely-positioned cluster to the row.
      //
      // Section rows: get a slightly thicker top border separator + a
      // mt-1 spacer so chapters visually breathe apart from the rows
      // above. Non-section rows nested under a section get pl-4 so the
      // outline hierarchy reads at a glance.
      className={`group flex flex-col border-b border-cf-border ${
        onNavigate ? "cursor-pointer hover:bg-cf-bg-200/40" : ""
      } ${hidden ? "text-cf-text-subtle" : ""} ${
        isSection ? "mt-1 border-t border-cf-border" : ""
      } ${isCurrent ? "bg-cf-bg-200/30" : ""}`}
    >
      {/* Default row content: [NN] [thumb] title — clean baseline.
          `relative` here anchors the affordance cluster to JUST the
          title strip (not the row + accordion combined, which would
          cause the cluster to float over the notes editor below).
          Non-section rows: pl-8 (vs px-4 = pl-4) indents the row body
          to nest under the most recent section heading. */}
      <div
        className={`relative flex items-center gap-3 ${
          isSection ? "px-4 py-3.5" : "py-3 pl-8 pr-4"
        }`}
      >
        {/* Slide number — fixed-width mono so the column lines up. */}
        <span
          aria-hidden="true"
          className="w-6 shrink-0 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle"
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        {/* Thumbnail. */}
        <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-cf-border bg-cf-bg-200">
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

        {/* Title — span by default, input when editing.
            min-w-0 lets flex truncate the span on narrow widths.

            Section rows render the uppercase mono kicker above a
            slightly larger title so the deck's chapter divider and the
            ToC speak the same visual language (matches the `cf-tag`
            class used on the slide chrome). */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {isSection && (sectionNumber || sectionLabel) && (
            <span
              data-testid="slide-manager-section-kicker"
              className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle"
            >
              {sectionNumber && <span>{sectionNumber}</span>}
              {sectionLabel && <span>{sectionLabel}</span>}
            </span>
          )}
          {editingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              data-interactive
              data-testid="slide-manager-title-input"
              aria-label={`Title for slide ${row.id}`}
              value={titleValue}
              maxLength={MAX_TITLE}
              spellCheck={false}
              onChange={(e) => onTitleChange(e.target.value)}
              onBlur={onEndEditingTitle}
              onKeyDown={handleTitleKeyDown}
              // Hidden rows: muted + strike-through baked onto the input
              // itself, since form controls don't inherit text-decoration
              // from their parent in most browsers.
              className={`w-full rounded border border-cf-border bg-cf-bg-100 px-2 py-1 text-sm ${
                hidden ? "text-cf-text-subtle line-through" : "text-cf-text"
              }`}
            />
          ) : (
            <span
              data-testid="slide-manager-title-display"
              className={`block truncate ${
                isSection
                  ? "text-base tracking-[-0.02em]"
                  : "text-sm"
              } ${
                hidden ? "text-cf-text-subtle line-through" : "text-cf-text"
              }`}
              title={titleValue}
            >
              {titleValue || (
                <em className="text-cf-text-subtle">(untitled)</em>
              )}
            </span>
          )}
          {hidden && (
            // Screen-reader-only suffix — the muted + strikethrough
            // styling is visual-only, this exposes the same information
            // to assistive tech.
            <span className="sr-only">(hidden)</span>
          )}
        </div>

        {/* Hover-revealed affordance cluster.
            Absolutely positioned at the right edge of the TITLE STRIP
            so the default row stays clean and the accordion below isn't
            covered. A subtle gradient on the left edge softens the title
            behind it on hover. Invisible until the row is hovered or
            focus enters one of its buttons. */}
        <HoverAffordanceCluster
          hidden={hidden}
          editingTitle={editingTitle}
          notesOpen={notesOpen}
          rowTitle={row.source.title ?? row.id}
          dragAttributes={attributes}
          dragListeners={listeners}
          onToggleHidden={onToggleHidden}
          onBeginEditingTitle={onBeginEditingTitle}
          onToggleNotes={onToggleNotes}
        />
      </div>

      {/* Notes accordion — expands below the row when toggled. */}
      <AnimatePresence initial={false}>
        {notesOpen && (
          <motion.div
            key="notes"
            data-testid="slide-manager-notes-accordion"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: easeEntrance }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">
              <NotesEditor
                slideId={row.id}
                value={notesValue}
                onChange={onNotesChange}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Hover-revealed affordance cluster ─────────────────────────────────────

interface HoverAffordanceClusterProps {
  hidden: boolean;
  editingTitle: boolean;
  notesOpen: boolean;
  rowTitle: string;
  dragAttributes: ReturnType<typeof useSortable>["attributes"];
  dragListeners: ReturnType<typeof useSortable>["listeners"];
  onToggleHidden: () => void;
  onBeginEditingTitle: () => void;
  onToggleNotes: () => void;
}

function HoverAffordanceCluster({
  hidden,
  editingTitle,
  notesOpen,
  rowTitle,
  dragAttributes,
  dragListeners,
  onToggleHidden,
  onBeginEditingTitle,
  onToggleNotes,
}: HoverAffordanceClusterProps) {
  // The cluster sits absolutely positioned over the right edge of the
  // row. We keep it in the DOM (no mount/unmount) so focusing a button
  // via the keyboard (Tab) doesn't surprise-jump layout. The visual
  // reveal is opacity + a tiny x slide; pointer-events flip in sync so
  // the icons don't intercept clicks while invisible.
  //
  // `focus-within:opacity-100` keeps the cluster visible when a button
  // inside it is keyboard-focused, even if the cursor isn't over the row.
  //
  // While the rename input is active OR the notes accordion is open we
  // keep the cluster visible too — both modes are mid-task and hiding
  // the affordance the author just clicked would be disorienting.
  const forceVisible = editingTitle || notesOpen;
  return (
    <div
      data-testid="slide-manager-affordances"
      data-visible={forceVisible ? "true" : undefined}
      // Soft gradient fade so the title text dissolves under the icons
      // on hover instead of being cut off by a hard edge. Uses the same
      // `--color-cf-bg-200` token as the row hover background so the
      // cluster blends with whatever's behind it.
      style={{
        background: forceVisible
          ? undefined
          : "linear-gradient(to right, transparent, var(--color-cf-bg-200) 28%)",
      }}
      className={`pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 pl-8 pr-3 transition-opacity duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${
        forceVisible
          ? "pointer-events-auto opacity-100"
          : "opacity-0"
      }`}
    >
      {/* The pointer-events-auto on the inner div lets the buttons take
          clicks even though the gradient backdrop is decorative. */}
      <div className="pointer-events-auto flex items-center gap-0.5">
        {/* Drag handle. The @dnd-kit listeners are attached here, so
            the grip in the hover cluster IS the drag affordance. */}
        <button
          type="button"
          data-interactive
          data-testid="slide-manager-drag-handle"
          aria-label={`Drag slide ${rowTitle}`}
          {...dragAttributes}
          {...dragListeners}
          className="flex h-7 w-7 cursor-grab items-center justify-center rounded text-cf-text-muted hover:bg-cf-bg-200 hover:text-cf-text active:cursor-grabbing"
        >
          <GripIcon />
        </button>

        {/* Eye toggle. */}
        <button
          type="button"
          data-interactive
          data-testid="slide-manager-toggle-hidden"
          aria-label={hidden ? "Show slide" : "Hide slide"}
          aria-pressed={hidden}
          onClick={onToggleHidden}
          className="flex h-7 w-7 items-center justify-center rounded text-cf-text-muted hover:bg-cf-bg-200 hover:text-cf-text"
        >
          {hidden ? <EyeClosedIcon /> : <EyeOpenIcon />}
        </button>

        {/* Pencil — opens inline rename input. */}
        <button
          type="button"
          data-interactive
          data-testid="slide-manager-edit-title"
          aria-label={`Rename slide ${rowTitle}`}
          aria-pressed={editingTitle}
          onClick={onBeginEditingTitle}
          className={`flex h-7 w-7 items-center justify-center rounded hover:bg-cf-bg-200 hover:text-cf-text ${
            editingTitle ? "text-cf-orange" : "text-cf-text-muted"
          }`}
        >
          <PencilIcon />
        </button>

        {/* Note icon — toggles the inline notes editor. */}
        <button
          type="button"
          data-interactive
          data-testid="slide-manager-toggle-notes"
          aria-label={notesOpen ? "Collapse notes" : "Edit notes"}
          aria-pressed={notesOpen}
          onClick={onToggleNotes}
          className={`flex h-7 w-7 items-center justify-center rounded hover:bg-cf-bg-200 hover:text-cf-text ${
            notesOpen ? "text-cf-orange" : "text-cf-text-muted"
          }`}
        >
          <NoteIcon />
        </button>
      </div>
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
    <div className="flex flex-col gap-2 rounded border border-cf-border bg-cf-bg-200/40 p-3">
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
  currentSlideEffectiveIndex,
  role = "admin",
  side = "right",
}: SlideManagerProps) {
  if (role === "audience") {
    return (
      <AudienceSlideManager
        open={open}
        slug={slug}
        sourceSlides={sourceSlides}
        manifest={manifest}
        onClose={onClose}
        onNavigateToSlide={onNavigateToSlide}
        side={side}
        currentSlideEffectiveIndex={currentSlideEffectiveIndex}
      />
    );
  }
  return (
    <AdminSlideManager
      open={open}
      slug={slug}
      sourceSlides={sourceSlides}
      manifest={manifest}
      onClose={onClose}
      onNavigateToSlide={onNavigateToSlide}
      side={side}
      currentSlideEffectiveIndex={currentSlideEffectiveIndex}
    />
  );
}

function AdminSlideManager({
  open,
  slug,
  sourceSlides,
  manifest,
  onClose,
  onNavigateToSlide,
  side = "right",
  currentSlideEffectiveIndex,
}: Omit<SlideManagerProps, "role">) {
  // Click-outside-close: when the sidebar is open, a `mousedown`
  // landing OUTSIDE the aside dismisses it. We use `mousedown` (not
  // `click`) so a drag started outside the sidebar — e.g. selecting
  // text in the slide — doesn't surprise-close it on mouseup. Clicks
  // INSIDE the sidebar (rows, header buttons, the notes editor) are
  // ignored. The listener is registered on `document`, not `window`,
  // for parity with `<ThemeSidebar>` + every other React popover.
  const asideRef = useRef<HTMLElement>(null);
  const { manifest: persisted, applyDraft, clearDraft, refetch } = manifest;

  const [rows, setRows] = useState<DraftRow[]>(() =>
    buildInitialRows(sourceSlides, persisted),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [openNotesId, setOpenNotesId] = useState<string | null>(null);
  // Single-row edit at a time. Clicking pencil on another row commits
  // the prior one (blur fires naturally) and opens the new one.
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);

  // Re-seed when the sidebar opens, or when persisted state changes
  // (Save / Reset / refetch). Mirrors ThemeSidebar's pattern.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setRows(buildInitialRows(sourceSlides, persisted));
      setSaveState("idle");
      setStatusMessage(null);
      setOpenNotesId(null);
      setEditingTitleId(null);
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

  // Click-outside-close.
  //
  // We listen for `mousedown` in capture phase. When the mousedown
  // lands outside the sidebar we BOTH dismiss AND suppress the
  // subsequent `click` event on the Deck surface — otherwise the same
  // gesture both closes the sidebar AND advances the slide, which is
  // surprising. The suppression is a one-shot `click` capture listener
  // that calls `stopImmediatePropagation` + `preventDefault` and then
  // self-removes; this keeps later, intentional clicks working.
  //
  // We only arm the listener while open, and defer one frame so the
  // same toolbar / M-key click that opened the sidebar doesn't
  // immediately re-close it.
  useEffect(() => {
    if (!open) return;
    const isOutside = (target: EventTarget | null) => {
      const aside = asideRef.current;
      if (!aside) return false;
      if (!(target instanceof Node)) return false;
      return !aside.contains(target);
    };
    const onDocMouseDown = (e: MouseEvent) => {
      if (!isOutside(e.target)) return;
      // One-shot click swallower for THIS mousedown's matching click.
      const swallow = (ev: MouseEvent) => {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        document.removeEventListener("click", swallow, true);
      };
      document.addEventListener("click", swallow, true);
      // Safety net: drop the swallower if no click fires (e.g. the
      // user dragged off the body between down and up).
      window.setTimeout(() => {
        document.removeEventListener("click", swallow, true);
      }, 300);
      onClose();
    };
    let id: number | null = window.requestAnimationFrame(() => {
      id = null;
      document.addEventListener("mousedown", onDocMouseDown, true);
    });
    return () => {
      if (id !== null) window.cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDocMouseDown, true);
    };
  }, [open, onClose]);

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
          ref={asideRef}
          data-testid="slide-manager"
          data-side={side}
          data-no-advance
          role="region"
          aria-label="Slide list"
          initial={{ opacity: 0, x: side === "left" ? -24 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: side === "left" ? -24 : 24 }}
          transition={{ duration: 0.2, ease: easeEntrance }}
          className={`absolute top-0 z-50 flex h-full w-[420px] flex-col bg-cf-bg-100 text-cf-text shadow-[0_0_0_1px_var(--color-cf-border)] ${
            side === "left"
              ? "left-0 border-r border-cf-border"
              : "right-0 border-l border-cf-border"
          }`}
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
              aria-label="Close slide list"
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
                      editingTitle={editingTitleId === row.id}
                      isCurrent={currentSlideEffectiveIndex === index}
                      onToggleNotes={() =>
                        setOpenNotesId((cur) => (cur === row.id ? null : row.id))
                      }
                      onBeginEditingTitle={() => setEditingTitleId(row.id)}
                      onEndEditingTitle={() =>
                        setEditingTitleId((cur) =>
                          cur === row.id ? null : cur,
                        )
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

// ── Audience sidebar (#209) ──────────────────────────────────────────────
//
// The read-only ToC every public-route visitor sees on `M`. Rows are
// `[NN] [thumb] title` clickable; Hidden slides are filtered out by
// `getRowsForRole(..., "audience")`. None of the admin affordances
// (drag handle, eye toggle, pencil, note icon, save / reset footer)
// are mounted here — the component renders a minimal sidebar that
// shares its visual chrome with the admin one.

interface AudienceRowProps {
  slide: SlideDef;
  /** Position of `slide` in the unfiltered effective slide list. */
  effectiveIndex: number;
  /** Display position in the audience list (1-indexed). */
  displayNumber: number;
  slug: string;
  /**
   * True when this row corresponds to the deck's current cursor slide.
   * Drives `aria-current="page"` + a subtle visual highlight.
   */
  isCurrent: boolean;
  onNavigate?: (effectiveIndex: number) => void;
}

function AudienceSlideRow({
  slide,
  effectiveIndex,
  displayNumber,
  slug,
  isCurrent,
  onNavigate,
}: AudienceRowProps) {
  const thumbSrc = `/thumbnails/${slug}/${String(displayNumber).padStart(2, "0")}.png`;
  const [imageFailed, setImageFailed] = useState(false);
  const titleValue = slide.title ?? slide.id;
  const clickable = Boolean(onNavigate);
  // Section detection — same rule as the admin sidebar: a row is a
  // "section slide" iff its layout is `"section"` (full-bleed chapter
  // divider). Section rows render with the kicker + a slightly larger
  // title; non-section rows get a small left padding so the outline
  // hierarchy reads as a ToC.
  const isSection = slide.layout === "section";
  const sectionLabel = slide.sectionLabel;
  const sectionNumber = slide.sectionNumber;

  const handleClick = () => {
    if (!onNavigate) return;
    if (typeof window !== "undefined" && window.getSelection()?.toString()) {
      return;
    }
    onNavigate(effectiveIndex);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onNavigate) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNavigate(effectiveIndex);
    }
  };

  return (
    <div
      data-testid="slide-manager-row"
      data-slide-id={slide.id}
      data-audience-row
      data-section={isSection ? "true" : undefined}
      data-current={isCurrent ? "true" : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-current={clickable && isCurrent ? "page" : undefined}
      aria-label={
        clickable ? `Go to slide ${titleValue}` : undefined
      }
      onClick={clickable ? handleClick : undefined}
      onKeyDown={clickable ? handleKeyDown : undefined}
      className={`flex items-center gap-3 border-b border-cf-border ${
        isSection ? "mt-1 border-t border-cf-border px-4 py-3.5" : "py-3 pl-8 pr-4"
      } ${
        clickable ? "cursor-pointer hover:bg-cf-bg-200/40" : ""
      } ${isCurrent ? "bg-cf-bg-200/30" : ""}`}
    >
      <span
        aria-hidden="true"
        className="w-6 shrink-0 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle"
      >
        {String(displayNumber).padStart(2, "0")}
      </span>

      <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-cf-border bg-cf-bg-200">
        {imageFailed ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-cf-text-subtle">
            {String(displayNumber).padStart(2, "0")}
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

      <div className="flex min-w-0 flex-1 flex-col">
        {isSection && (sectionNumber || sectionLabel) && (
          <span
            data-testid="slide-manager-section-kicker"
            className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle"
          >
            {sectionNumber && <span>{sectionNumber}</span>}
            {sectionLabel && <span>{sectionLabel}</span>}
          </span>
        )}
        <span
          data-testid="slide-manager-title-display"
          className={`block truncate ${
            isSection ? "text-base tracking-[-0.02em]" : "text-sm"
          } text-cf-text`}
          title={titleValue}
        >
          {titleValue || (
            <em className="text-cf-text-subtle">(untitled)</em>
          )}
        </span>
      </div>
    </div>
  );
}

function AudienceSlideManager({
  open,
  slug,
  sourceSlides,
  manifest,
  onClose,
  onNavigateToSlide,
  side = "right",
  currentSlideEffectiveIndex,
}: Omit<SlideManagerProps, "role">) {
  const { applied } = manifest;
  const asideRef = useRef<HTMLElement>(null);

  // Mirror the same effective-slides derivation `<Deck>` uses. We don't
  // import it from `<Deck>` because `<SlideManager>` is mounted as a
  // sibling — and `mergeSlides` is pure, so the duplication is cheap.
  const effectiveSlides = useMemo(
    () => mergeSlides(sourceSlides, applied),
    [sourceSlides, applied],
  );

  const rows = useMemo(
    () => getRowsForRole(effectiveSlides, "audience"),
    [effectiveSlides],
  );

  // Click-outside-close — same shape as the admin sidebar. We listen
  // for `mousedown` to dismiss and arm a one-shot `click` swallower
  // so the same gesture doesn't ALSO trigger the Deck's click-to-
  // advance.
  useEffect(() => {
    if (!open) return;
    const isOutside = (target: EventTarget | null) => {
      const aside = asideRef.current;
      if (!aside) return false;
      if (!(target instanceof Node)) return false;
      return !aside.contains(target);
    };
    const onDocMouseDown = (e: MouseEvent) => {
      if (!isOutside(e.target)) return;
      const swallow = (ev: MouseEvent) => {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        document.removeEventListener("click", swallow, true);
      };
      document.addEventListener("click", swallow, true);
      window.setTimeout(() => {
        document.removeEventListener("click", swallow, true);
      }, 300);
      onClose();
    };
    let id: number | null = window.requestAnimationFrame(() => {
      id = null;
      document.addEventListener("mousedown", onDocMouseDown, true);
    });
    return () => {
      if (id !== null) window.cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDocMouseDown, true);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="slide-manager"
          ref={asideRef}
          data-testid="slide-manager"
          data-audience
          data-side={side}
          data-no-advance
          role="region"
          aria-label="Slide list"
          initial={{ opacity: 0, x: side === "left" ? -24 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: side === "left" ? -24 : 24 }}
          transition={{ duration: 0.2, ease: easeEntrance }}
          className={`absolute top-0 z-50 flex h-full w-[420px] flex-col bg-cf-bg-100 text-cf-text shadow-[0_0_0_1px_var(--color-cf-border)] ${
            side === "left"
              ? "left-0 border-r border-cf-border"
              : "right-0 border-l border-cf-border"
          }`}
        >
          <header className="flex items-start justify-between gap-3 border-b border-cf-border px-5 py-4">
            <div>
              <p className="cf-tag">Slides</p>
              <h2 className="mt-1 text-lg font-medium tracking-[-0.02em]">
                {effectiveSlides.length === 0
                  ? "Empty deck"
                  : `${rows.length} ${rows.length === 1 ? "slide" : "slides"}`}
              </h2>
            </div>
            <button
              type="button"
              data-interactive
              data-testid="slide-manager-close"
              onClick={onClose}
              aria-label="Close slide list"
              className="cf-btn-ghost"
            >
              Esc
            </button>
          </header>
          <div className="flex-1 overflow-y-auto">
            {rows.map((row, i) => (
              <AudienceSlideRow
                key={row.slide.id}
                slide={row.slide}
                effectiveIndex={row.effectiveIndex}
                displayNumber={i + 1}
                slug={slug}
                isCurrent={currentSlideEffectiveIndex === row.effectiveIndex}
                onNavigate={onNavigateToSlide}
              />
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
