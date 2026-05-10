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
 * test-id). Admin slots (IDE link, delete trashcan) are absolute-
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
 * Optional admin slots (issue #127):
 *   - `visibility="private"`: renders a small uppercase-mono badge so the
 *     author can see at a glance which decks are committed-and-public vs
 *     author-only-private. Public decks omit the chip.
 *   - `onDelete`: renders a hover-revealed trashcan that opens an inline
 *     `<ConfirmDialog>`. On confirm, invokes the callback with the deck
 *     slug. If the callback throws / rejects, the error is surfaced
 *     inline and the dialog stays open so the user can retry. (The
 *     side-effect — fetch + page reload — is the parent's responsibility.)
 *   - `ideHref`: when set, renders the existing "Open in IDE" affordance
 *     pinned to the bottom-right of the card.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DeckMeta } from "@/framework/viewer/types";
import { ConfirmDialog } from "./ConfirmDialog";

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
   * Optional admin-only delete callback. When provided, a hover-revealed
   * trashcan is rendered; on confirm, this callback is invoked with the
   * deck slug. The callback is responsible for the side effect (DELETE
   * request + reload). If it throws / rejects, the error is surfaced
   * inline and the dialog stays open.
   */
  onDelete?: (slug: string) => Promise<void> | void;
  /**
   * Optional admin-only IDE link. When set, renders an "Open in IDE"
   * affordance pinned to the bottom-right of the card. Mutually
   * exclusive with `onDelete` in practice — the trashcan and IDE link
   * share the same anchor position. The two are never both shown for
   * the same row (source decks have IDE; KV decks have delete).
   */
  ideHref?: string;
  /**
   * Number of slide thumbnails to cycle through while the user hovers
   * the card (issue #128). When `0` (or `view !== "grid"`), no
   * animation is rendered — list-mode cards never animate.
   *
   * The card always shows slide 1 in its rest state. On hover it
   * cycles `01.png → 02.png → … → 0N.png → 01.png → …` at a fixed
   * 600ms interval, snapping back to slide 1 on mouseleave / unmount.
   *
   * Preload `<img>` tags for slides 2..N are rendered with
   * `loading="eager"` and zero opacity so the swap is instant once the
   * user starts hovering — no flash of unloaded image. The preloads
   * are absolute-positioned so they don't push the layout around.
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

/** Inline lucide `Trash2` icon. */
function TrashIcon() {
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
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function DeckCard({
  meta,
  view = "grid",
  to,
  visibility,
  onDelete,
  ideHref,
  hoverPreviewSlideCount = 0,
}: DeckCardProps) {
  const visibleTags = meta.tags?.slice(0, MAX_VISIBLE_TAGS) ?? [];
  const hasTags = visibleTags.length > 0;

  // Compose the kicker pieces. Each piece is included only when present.
  const kickerPieces: string[] = [meta.date];
  if (meta.event) kickerPieces.push(meta.event);
  if (meta.runtimeMinutes !== undefined) {
    kickerPieces.push(`${meta.runtimeMinutes} min`);
  }

  const isList = view === "list";

  // Hover-preview only runs in grid mode. List-mode cards stay static
  // because the thumbnail strip is too small for the cycle to read,
  // and the cards are too tightly stacked for hovering to feel
  // intentional.
  const hoverEnabled = !isList && hoverPreviewSlideCount > 1;
  // Slide 1 path; used at rest and as the wrap-around target.
  const slideOnePath = `/thumbnails/${meta.slug}/01.png`;
  // Author-supplied cover wins for the rest-state visible image but
  // the preload set is always built from the build-time thumbnails so
  // the cycle is well-defined regardless of how the cover is sourced.
  const restSrc = meta.cover ?? slideOnePath;

  // Index 0 = slide 1 (rest state). The interval increments hoverIndex
  // through 0..hoverPreviewSlideCount-1 modulo length so it wraps back
  // to slide 1 cleanly.
  const [hoverIndex, setHoverIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const showHero = !imageFailed;

  // Build the preload list once per (slug, count) tuple. Slide 1 is
  // the visible image (rendered separately) so we only preload 02..0N.
  const preloadSrcs = useMemo<string[]>(() => {
    if (!hoverEnabled) return [];
    const out: string[] = [];
    for (let i = 2; i <= hoverPreviewSlideCount; i++) {
      out.push(`/thumbnails/${meta.slug}/${String(i).padStart(2, "0")}.png`);
    }
    return out;
  }, [hoverEnabled, hoverPreviewSlideCount, meta.slug]);

  // Mouseenter → start the cycle. Mouseleave / unmount → clear it.
  // We only depend on the IDs of things that genuinely affect the
  // schedule so the interval isn't recreated on every render — that
  // would reset the cycle every parent rerender.
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

  // Resolve the foreground src from the current hoverIndex. At index 0
  // we use `restSrc` (which honors meta.cover); for other indices we
  // walk the build-time thumbnails so the preview always shows real
  // slide content even when the cover is custom artwork.
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

  // Delete-flow state lives inside the card so each card owns its own
  // dialog. The parent's `onDelete` is only invoked on confirm.
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reset error state whenever the dialog is dismissed so the next
  // open is clean.
  useEffect(() => {
    if (!pendingDelete) setDeleteError(null);
  }, [pendingDelete]);

  const cancelDelete = useCallback(() => {
    if (deleting) return; // mid-flight; ignore until response lands
    setPendingDelete(false);
    setDeleteError(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!onDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(meta.slug);
      // Success: the parent will typically navigate / reload. If it
      // doesn't, leave the dialog closed and the row in place — the
      // parent decides what "done" means.
      setPendingDelete(false);
      setDeleting(false);
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : "Network error — try again.",
      );
      setDeleting(false);
    }
  }, [onDelete, meta.slug]);

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
              {/*
                * Preload the next slides when hover-animation is active so
                * the cycle is instant once the user starts hovering. Each
                * preload is absolute-positioned at full size with zero
                * opacity — it occupies no logical space, doesn't push
                * layout, and the browser still fetches it so subsequent
                * `src` swaps land from cache.
                */}
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
              {visibility === "private" && (
                <span
                  data-visibility="private"
                  className="rounded border border-cf-orange/40 bg-cf-orange/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-orange"
                >
                  private
                </span>
              )}
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
              // Reserve the same vertical space in grid mode so all cards
              // line up; otherwise the meta block height varies and the
              // grid looks visually noisy.
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
          // Sibling of the Link (NOT nested) so we don't emit invalid
          // <a> inside <a>. Absolute-positioned over the card's
          // bottom-right corner.
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

        {onDelete && (
          // Hover-revealed delete trashcan; sibling of the Link.
          // The opacity-0 → 100 on group-hover is the canonical
          // hover-reveal pattern from AGENTS.md.
          <button
            type="button"
            data-interactive
            data-testid={`delete-deck-${meta.slug}`}
            aria-label={`Delete ${meta.title}`}
            title={`Delete ${meta.title}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPendingDelete(true);
              setDeleteError(null);
            }}
            className="absolute bottom-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded border border-cf-border bg-cf-bg-100 text-cf-text-muted opacity-0 transition-opacity hover:border-cf-orange hover:text-cf-orange focus:opacity-100 group-hover:opacity-100"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {onDelete && (
        <ConfirmDialog
          isOpen={pendingDelete}
          title="Delete deck?"
          body={
            <>
              <p>
                Delete <strong>{meta.title}</strong>? This cannot be undone.
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
          destructive
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}
    </>
  );
}
