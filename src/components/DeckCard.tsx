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

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DeckMeta } from "@/framework/viewer/types";
import { ConfirmDialog } from "./ConfirmDialog";

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
}: DeckCardProps) {
  const visibleTags = meta.tags?.slice(0, MAX_VISIBLE_TAGS) ?? [];
  const hasTags = visibleTags.length > 0;

  // Compose the kicker pieces. Each piece is included only when present.
  const kickerPieces: string[] = [meta.date];
  if (meta.event) kickerPieces.push(meta.event);
  if (meta.runtimeMinutes !== undefined) {
    kickerPieces.push(`${meta.runtimeMinutes} min`);
  }

  const heroSrc = meta.cover ?? `/thumbnails/${meta.slug}/01.png`;
  const [imageFailed, setImageFailed] = useState(false);
  const showHero = !imageFailed;

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

  const isList = view === "list";

  return (
    <>
      <div
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
                  ? "aspect-[16/9] w-48 shrink-0 overflow-hidden border-r border-cf-border bg-cf-bg-200 sm:w-56"
                  : "aspect-[16/9] w-full shrink-0 overflow-hidden border-b border-cf-border bg-cf-bg-200"
              }
            >
              <img
                src={heroSrc}
                alt=""
                loading="lazy"
                onError={() => setImageFailed(true)}
                className="h-full w-full object-cover"
              />
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
