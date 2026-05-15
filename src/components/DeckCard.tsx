/**
 * `<DeckCard>` — single deck card, used on BOTH the public homepage (`/`)
 * and the Studio admin grid (`/admin`). Issue #127 unifies these two
 * previously-divergent renderers.
 *
 * Visual identity follows the design-token aesthetic: warm cream surface,
 * subtle border that turns dashed on hover, an uppercase mono kicker for
 * date / event / runtime, a medium-weight title, a muted description, and
 * small pill tags (max 3 visible).
 *
 * Optional fields are omitted entirely when absent — no empty wrappers,
 * no stale labels.
 *
 * Hero strip (16:9 image) resolution order:
 *   1. `meta.cover` — author opt-in, highest priority.
 *   2. `/thumbnails/<slug>/01.png` — build-time auto-thumbnail produced
 *      by `npm run thumbnails`.
 *   3. (image fails to load) — hide the hero strip entirely.
 *
 * Structure note: the outer wrapper is a non-interactive `<div>` and
 * the click target is an inner `<Link>` (which carries the `deck-card`
 * test-id). Admin slots (IDE link, lifecycle action menu) are absolute-
 * positioned SIBLINGS of the `<Link>` rather than children — nesting an
 * `<a>` inside another `<a>` is invalid HTML and trips React's
 * nested-anchor warning. The existing `<AdminDeckRow>` used the same
 * trick.
 *
 * View modes (issue #127):
 *   - `view="grid"`: 16:9 thumbnail on top, fixed-height meta block below.
 *     Title + description are line-clamped so all cards in a grid have
 *     identical dimensions regardless of how much copy a deck carries.
 *   - `view="list"`: small thumbnail on the left, meta on the right, one
 *     row per deck. Designed for users who prefer scanning by title.
 *
 * Optional admin slots:
 *   - `visibility="private"`: renders a small uppercase-mono badge so the
 *     author can see at a glance which decks are committed-and-public vs
 *     author-only-private. Public decks omit the chip.
 *   - `onArchive` / `onRestore` / `onDelete` (issue #244): wire any
 *     combination of lifecycle actions. The card renders a hover-revealed
 *     `<DeckLifecycleMenu>` in the corner and owns the three confirmation
 *     dialogs:
 *       * Archive  → simple `<ConfirmDialog>` (neutral).
 *       * Restore  → simple `<ConfirmDialog>` (neutral).
 *       * Delete   → `<TypedSlugConfirmDialog>` (destructive, typed-slug
 *                    guard).
 *     The "active" vs "archived" lifecycle is derived from
 *     `meta.archived === true`; active cards expose Archive + Delete,
 *     archived cards expose Restore + Delete.
 *   - `ideHref`: when set, renders the existing "Open in IDE" affordance
 *     pinned to the bottom-right of the card.
 *
 * Backwards compatibility: this slice replaces the single hover-revealed
 * trashcan (issue #130) with the lifecycle menu. The destructive Delete
 * menu item still exposes `data-testid="delete-deck-<slug>"` as a
 * synonym so older selectors don't break — but the canonical flow is
 * now "open menu trigger → click menu item → typed-slug dialog".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DeckMeta } from "@/framework/viewer/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeckLifecycleMenu } from "./DeckLifecycleMenu";
import { TypedSlugConfirmDialog } from "./TypedSlugConfirmDialog";

/** Interval between hover-preview slide swaps, in milliseconds. */
const HOVER_PREVIEW_INTERVAL_MS = 600;

export type DeckCardView = "grid" | "list";
export type DeckCardVisibility = "public" | "private";

export interface DeckCardProps {
  meta: DeckMeta;
  /** Layout mode: `grid` (default) for the gallery; `list` for the row view. */
  view?: DeckCardView;
  /** Link target for the card's main click area. */
  to: string;
  /** Optional admin-only badge. Public decks omit the chip; only `private` is rendered. */
  visibility?: DeckCardVisibility;
  /**
   * Optional admin-only Archive callback. When provided AND the card is
   * an active deck (`meta.archived !== true`), the lifecycle menu
   * surfaces an Archive item that, on confirm, invokes this callback
   * with the deck slug. Errors thrown by the callback are surfaced
   * inline in the dialog so the user can retry without dismissing.
   */
  onArchive?: (slug: string) => Promise<void> | void;
  /**
   * Optional admin-only Restore callback. Mirrors `onArchive` but only
   * renders when the card is an archived deck.
   */
  onRestore?: (slug: string) => Promise<void> | void;
  /**
   * Optional admin-only Delete callback. Available in both lifecycles.
   * On confirm via the typed-slug dialog, invoked with the deck slug.
   * The callback owns the side effect (DELETE request + reload). If it
   * throws / rejects, the error is surfaced inline and the dialog stays
   * open for retry.
   */
  onDelete?: (slug: string) => Promise<void> | void;
  /**
   * Optional admin-only IDE link. When set, renders an "Open in IDE"
   * affordance pinned to the bottom-right of the card. Mutually
   * exclusive with the lifecycle menu in practice — the lifecycle menu
   * sits in the top-right corner; the IDE link sits in the
   * bottom-right.
   */
  ideHref?: string;
  /**
   * Number of slide thumbnails to cycle through while the user hovers
   * the card (issue #128). When `0` (or `view !== "grid"`), no
   * animation is rendered — list-mode cards never animate.
   */
  hoverPreviewSlideCount?: number;
}

const MAX_VISIBLE_TAGS = 3;

/** Inline lucide `Code` icon — kept inline to stay dep-free. */
function CodeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

export function DeckCard({
  meta,
  view = "grid",
  to,
  visibility,
  onArchive,
  onRestore,
  onDelete,
  ideHref,
  hoverPreviewSlideCount = 0,
}: DeckCardProps) {
  const visibleTags = meta.tags?.slice(0, MAX_VISIBLE_TAGS) ?? [];
  const hasTags = visibleTags.length > 0;

  const kickerPieces: string[] = [meta.date];
  if (meta.event) kickerPieces.push(meta.event);
  if (meta.runtimeMinutes !== undefined) {
    kickerPieces.push(`${meta.runtimeMinutes} min`);
  }

  const isList = view === "list";
  const isArchived = meta.archived === true;
  const lifecycle = isArchived ? "archived" : "active";

  const hoverEnabled = !isList && hoverPreviewSlideCount > 1;
  const slideOnePath = `/thumbnails/${meta.slug}/01.png`;
  const restSrc = meta.cover ?? slideOnePath;

  const [hoverIndex, setHoverIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const showHero = !imageFailed;

  const preloadSrcs = useMemo<string[]>(() => {
    if (!hoverEnabled) return [];
    const out: string[] = [];
    for (let i = 2; i <= hoverPreviewSlideCount; i++) {
      out.push(`/thumbnails/${meta.slug}/${String(i).padStart(2, "0")}.png`);
    }
    return out;
  }, [hoverEnabled, hoverPreviewSlideCount, meta.slug]);

  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    if (!hoverEnabled || !isHovering) return;
    const id = window.setInterval(() => {
      setHoverIndex((prev) => (prev + 1) % hoverPreviewSlideCount);
    }, HOVER_PREVIEW_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [hoverEnabled, isHovering, hoverPreviewSlideCount]);

  const visibleSrc = useMemo(() => {
    if (!hoverEnabled || hoverIndex === 0) return restSrc;
    return `/thumbnails/${meta.slug}/${String(hoverIndex + 1).padStart(2, "0")}.png`;
  }, [hoverEnabled, hoverIndex, meta.slug, restSrc]);

  const onMouseEnter = useCallback(() => {
    if (!hoverEnabled) return;
    setIsHovering(true);
  }, [hoverEnabled]);
  const onMouseLeave = useCallback(() => {
    if (!hoverEnabled) return;
    setIsHovering(false);
    setHoverIndex(0);
  }, [hoverEnabled]);

  // ─── Lifecycle action state ─────────────────────────────────────────
  // Each action has its own dialog. `pending*` tracks open state;
  // `*ing` tracks in-flight callback (so the button can read "Deleting…"
  // and we can ignore Cancel while the side effect is still resolving);
  // `*Error` surfaces a friendly inline message on failure.
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [pendingArchive, setPendingArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const [pendingRestore, setPendingRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingDelete) setDeleteError(null);
  }, [pendingDelete]);
  useEffect(() => {
    if (!pendingArchive) setArchiveError(null);
  }, [pendingArchive]);
  useEffect(() => {
    if (!pendingRestore) setRestoreError(null);
  }, [pendingRestore]);

  const cancelDelete = useCallback(() => {
    if (deleting) return;
    setPendingDelete(false);
    setDeleteError(null);
  }, [deleting]);
  const confirmDelete = useCallback(async () => {
    if (!onDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(meta.slug);
      setPendingDelete(false);
      setDeleting(false);
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : "Network error — try again.",
      );
      setDeleting(false);
    }
  }, [onDelete, meta.slug]);

  const cancelArchive = useCallback(() => {
    if (archiving) return;
    setPendingArchive(false);
    setArchiveError(null);
  }, [archiving]);
  const confirmArchive = useCallback(async () => {
    if (!onArchive) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await onArchive(meta.slug);
      setPendingArchive(false);
      setArchiving(false);
    } catch (e) {
      setArchiveError(
        e instanceof Error ? e.message : "Network error — try again.",
      );
      setArchiving(false);
    }
  }, [onArchive, meta.slug]);

  const cancelRestore = useCallback(() => {
    if (restoring) return;
    setPendingRestore(false);
    setRestoreError(null);
  }, [restoring]);
  const confirmRestore = useCallback(async () => {
    if (!onRestore) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await onRestore(meta.slug);
      setPendingRestore(false);
      setRestoring(false);
    } catch (e) {
      setRestoreError(
        e instanceof Error ? e.message : "Network error — try again.",
      );
      setRestoring(false);
    }
  }, [onRestore, meta.slug]);

  // Lifecycle-aware callbacks for the menu. Active decks expose
  // Archive + Delete; archived decks expose Restore + Delete.
  const menuOnArchive =
    lifecycle === "active" && onArchive
      ? () => {
          setPendingArchive(true);
          setArchiveError(null);
        }
      : undefined;
  const menuOnRestore =
    lifecycle === "archived" && onRestore
      ? () => {
          setPendingRestore(true);
          setRestoreError(null);
        }
      : undefined;
  const menuOnDelete = onDelete
    ? () => {
        setPendingDelete(true);
        setDeleteError(null);
      }
    : undefined;

  return (
    <>
      <div
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={
          isList
            ? "cf-card group relative w-full overflow-hidden"
            : "cf-card group relative flex h-full flex-col overflow-hidden"
        }
      >
        <Link
          to={to}
          data-testid="deck-card"
          data-view={view}
          className={
            isList
              ? "flex w-full items-stretch no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cf-orange"
              : "flex h-full flex-col no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cf-orange"
          }
        >
          {showHero && (
            <div
              className={
                isList
                  ? "relative aspect-[16/9] w-48 shrink-0 overflow-hidden border-r border-cf-border bg-cf-bg-200 sm:w-56"
                  : "relative aspect-[16/9] w-full shrink-0 overflow-hidden border-b border-cf-border bg-cf-bg-200"
              }
            >
              <img
                src={visibleSrc}
                alt=""
                loading="lazy"
                onError={() => setImageFailed(true)}
                className="h-full w-full object-cover"
              />
              {preloadSrcs.map((src) => (
                <img
                  key={src}
                  src={src}
                  alt=""
                  loading="eager"
                  data-hover-preload
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0"
                />
              ))}
            </div>
          )}

          <div
            className={
              isList
                ? "flex flex-1 flex-col gap-2 p-5"
                : "flex flex-1 flex-col gap-3 p-6"
            }
          >
            <div className="flex items-start justify-between gap-3">
              <p className="cf-tag">{kickerPieces.join(" · ")}</p>
              <div className="flex shrink-0 items-center gap-1.5">
                {meta.draft && (
                  <span
                    data-testid="deck-draft-pill"
                    className="rounded border border-cf-warning/40 bg-cf-warning/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-warning"
                  >
                    draft
                  </span>
                )}
                {visibility === "private" && (
                  <span
                    data-visibility="private"
                    className="rounded border border-cf-orange/40 bg-cf-orange/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-orange"
                  >
                    private
                  </span>
                )}
              </div>
            </div>

            <h2
              className={
                isList
                  ? "line-clamp-2 text-lg font-medium tracking-[-0.025em] text-cf-text sm:text-xl"
                  : "line-clamp-2 min-h-[3.5rem] text-xl font-medium tracking-[-0.025em] text-cf-text sm:text-2xl"
              }
            >
              {meta.title}
            </h2>

            {meta.description ? (
              <p
                className={
                  isList
                    ? "line-clamp-2 text-sm text-cf-text-muted sm:text-[15px]"
                    : "line-clamp-3 min-h-[4.5rem] text-sm text-cf-text-muted sm:text-[15px]"
                }
              >
                {meta.description}
              </p>
            ) : (
              !isList && <div aria-hidden className="min-h-[4.5rem]" />
            )}

            {hasTags && (
              <ul className="mt-auto flex flex-wrap gap-1.5 pt-1">
                {visibleTags.map((tag) => (
                  <li
                    key={tag}
                    data-deck-tag
                    className="rounded-full border border-cf-orange/30 bg-cf-orange/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-orange"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Link>

        {ideHref && (
          <a
            href={ideHref}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open ${meta.slug} in IDE`}
            title={`Open ${meta.slug} in IDE`}
            data-testid="open-in-ide"
            data-interactive
            className="absolute bottom-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded border border-cf-border bg-cf-bg-100 text-cf-text-muted no-underline transition-colors hover:border-cf-text hover:text-cf-text"
          >
            <CodeIcon />
          </a>
        )}

        <DeckLifecycleMenu
          slug={meta.slug}
          title={meta.title}
          lifecycle={lifecycle}
          onArchive={menuOnArchive}
          onRestore={menuOnRestore}
          onDelete={menuOnDelete}
        />
      </div>

      {onDelete && (
        <TypedSlugConfirmDialog
          isOpen={pendingDelete}
          slug={meta.slug}
          title="Delete deck?"
          body={
            <>
              <p>
                Delete <strong>{meta.title}</strong>? This will remove the
                deck permanently and clear its side data the next time the
                action is finalized. This cannot be undone.
              </p>
              {deleteError && (
                <p
                  role="alert"
                  data-testid="delete-error"
                  className="mt-3 rounded border border-cf-orange/40 bg-cf-orange/10 px-3 py-2 text-xs text-cf-orange"
                >
                  {deleteError}
                </p>
              )}
            </>
          }
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          cancelLabel="Cancel"
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}

      {onArchive && lifecycle === "active" && (
        <ConfirmDialog
          isOpen={pendingArchive}
          title="Archive deck?"
          body={
            <>
              <p>
                Archive <strong>{meta.title}</strong>? It will move to the
                Archived section and its public link will stop working
                once the action is finalized. You can restore it later.
              </p>
              {archiveError && (
                <p
                  role="alert"
                  data-testid="archive-error"
                  className="mt-3 rounded border border-cf-orange/40 bg-cf-orange/10 px-3 py-2 text-xs text-cf-orange"
                >
                  {archiveError}
                </p>
              )}
            </>
          }
          confirmLabel={archiving ? "Archiving…" : "Archive"}
          cancelLabel="Cancel"
          onConfirm={confirmArchive}
          onCancel={cancelArchive}
        />
      )}

      {onRestore && lifecycle === "archived" && (
        <ConfirmDialog
          isOpen={pendingRestore}
          title="Restore deck?"
          body={
            <>
              <p>
                Restore <strong>{meta.title}</strong>? It will move back
                to the Active section and become reachable at its public
                link again.
              </p>
              {restoreError && (
                <p
                  role="alert"
                  data-testid="restore-error"
                  className="mt-3 rounded border border-cf-orange/40 bg-cf-orange/10 px-3 py-2 text-xs text-cf-orange"
                >
                  {restoreError}
                </p>
              )}
            </>
          }
          confirmLabel={restoring ? "Restoring…" : "Restore"}
          cancelLabel="Cancel"
          onConfirm={confirmRestore}
          onCancel={cancelRestore}
        />
      )}
    </>
  );
}
