/**
 * Admin deck index — `/admin`.
 *
 * Lists every deck the author has access to:
 *
 *   - Build-time (source) decks, public + private (private only in dev).
 *   - KV-backed decks created via the New Deck modal, both public AND
 *     private (the admin endpoint at `/api/admin/decks` returns the
 *     full set; see `worker/decks.ts`).
 *
 * Each row shows a visibility badge so the author can see at a glance
 * which decks are committed-and-public vs author-only-private.
 *
 * Each entry links to `/admin/decks/<slug>` where the viewer mounts in
 * presenter mode (presenter window key handlers + tools auto-activate via
 * the `<PresenterModeProvider>` wrap in slice #7's `decks.$slug.tsx`).
 *
 * The "Open in IDE" button is shown only for source decks — KV decks
 * have no on-disk source file to open.
 *
 * Issue #130: KV-backed deck rows also expose a hover-revealed trashcan
 * that opens a `<ConfirmDialog>`. Confirming hits
 * `DELETE /api/admin/decks/<slug>` (already wired in `worker/decks.ts`)
 * and triggers a re-fetch of the admin deck list. Build-time decks have
 * no UI trashcan because they live in source files — deletion is a
 * `git rm`, not a runtime action.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  useAdminDataDeckList,
  type RegistryEntry,
} from "@/lib/decks-registry";
import { vscodeUrlForDeckSource } from "@/lib/vscode-url";
import { NewDeckModal } from "@/framework/editor/NewDeckModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { adminWriteHeaders } from "@/lib/admin-fetch";

/**
 * Inline SVG of lucide's `Code` icon — bracket-bracket arrows. We keep it
 * inline (rather than depending on `lucide-react`) so the feature ships
 * with zero new dependencies, per the issue's acceptance criteria.
 */
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

/**
 * Inline SVG of lucide's `Trash2` icon. Same rationale as `CodeIcon` —
 * inline keeps the bundle dep-free and matches the visual language of
 * the existing IDE affordance.
 */
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

interface AdminDeckRowProps {
  entry: RegistryEntry;
  ideUrl: string;
  showIdeButton: boolean;
  showDeleteButton: boolean;
  onRequestDelete: (entry: RegistryEntry) => void;
}

/**
 * One admin-list row. Owns the hero-image fallback state per row so a single
 * deck failing to load its thumbnail doesn't affect the others.
 *
 * Hero source priority: `meta.cover` (author-set) > `/thumbnails/<slug>/01.png`
 * (build-time auto-snap) > hidden hero strip via `onError` (graceful for
 * fresh clones with no thumbnails generated yet). Mirrors the fallback chain
 * used by `<DeckCard>` and `<OverviewTile>`.
 */
function AdminDeckRow({
  entry,
  ideUrl,
  showIdeButton,
  showDeleteButton,
  onRequestDelete,
}: AdminDeckRowProps) {
  const { meta, visibility } = entry;
  const heroSrc = meta.cover ?? `/thumbnails/${meta.slug}/01.png`;
  const [imageFailed, setImageFailed] = useState(false);
  const showHero = !imageFailed;

  return (
    <li className="relative">
      <Link
        to={`/admin/decks/${meta.slug}`}
        className="cf-card group block overflow-hidden text-left no-underline"
      >
        {showHero && (
          <div className="aspect-[16/9] w-full overflow-hidden border-b border-cf-border bg-cf-bg-200">
            <img
              src={heroSrc}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover"
            />
          </div>
        )}
        <div className="p-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="cf-tag">
              {meta.date}
              {meta.runtimeMinutes ? ` · ${meta.runtimeMinutes} min` : ""}
            </p>
            <span
              data-visibility={visibility}
              className={
                visibility === "private"
                  ? "rounded border border-cf-orange/40 bg-cf-orange/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-orange"
                  : "rounded border border-cf-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle"
              }
            >
              {visibility}
            </span>
          </div>
          <p className="mb-1 text-xl font-medium tracking-[-0.025em] text-cf-text">
            {meta.title}
          </p>
          {meta.description && (
            <p className="text-sm text-cf-text-muted">{meta.description}</p>
          )}
          {meta.author && (
            <p className="mt-3 text-xs text-cf-text-subtle">
              {meta.author}
              {meta.event ? ` · ${meta.event}` : ""}
            </p>
          )}
        </div>
      </Link>
      {showIdeButton && ideUrl && (
        <a
          href={ideUrl}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${meta.slug} in IDE`}
          title={`Open ${meta.slug} in IDE`}
          data-testid="open-in-ide"
          className="absolute bottom-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded border border-cf-border bg-cf-bg-100 text-cf-text-muted no-underline transition-colors hover:border-cf-text hover:text-cf-text"
        >
          <CodeIcon />
        </a>
      )}
      {showDeleteButton && (
        // Hover-revealed delete trashcan. Positioned bottom-right
        // (mirroring the "Open in IDE" button on source-deck rows; KV
        // decks never carry the IDE button so there's no collision).
        // Top-right would clash with the visibility badge that lives
        // inside the card body. The opacity-0 → 100 on group-hover is
        // the canonical hover-reveal pattern from AGENTS.md.
        <button
          type="button"
          data-interactive
          data-testid={`delete-deck-${meta.slug}`}
          aria-label={`Delete ${meta.title}`}
          title={`Delete ${meta.title}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRequestDelete(entry);
          }}
          className="absolute bottom-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded border border-cf-border bg-cf-bg-100 text-cf-text-muted opacity-0 transition-opacity hover:border-cf-orange hover:text-cf-orange focus:opacity-100 group-hover:opacity-100"
        >
          <TrashIcon />
        </button>
      )}
    </li>
  );
}

export default function AdminIndex() {
  const { entries } = useAdminDataDeckList();
  const [newDeckOpen, setNewDeckOpen] = useState(false);
  // Local-state list of KV slugs that have been deleted in this session.
  // We optimistically hide them while the admin list refetches via
  // `window.location.reload()` (which fully re-runs the hook). For the
  // unit-test path the hook is mocked, so `useAdminDataDeckList` won't
  // re-fetch in response to a state change — `deletedSlugs` makes the
  // delete UX correct in both worlds.
  const [deletedSlugs, setDeletedSlugs] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingDelete, setPendingDelete] = useState<RegistryEntry | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // `__PROJECT_ROOT__` is injected by vite.config.ts: an absolute path in
  // dev (`command === "serve"`), the empty string in production builds.
  // We additionally gate the button render on `import.meta.env.DEV` so the
  // production bundle has no trace of the affordance even if the sentinel
  // ever leaks through.
  const projectRoot = __PROJECT_ROOT__;
  const showIdeButton = import.meta.env.DEV && projectRoot.length > 0;

  const cancelDelete = useCallback(() => {
    if (deleting) return; // mid-flight; ignore until response lands
    setPendingDelete(null);
    setDeleteError(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const slug = pendingDelete.meta.slug;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/admin/decks/${encodeURIComponent(slug)}`,
        {
          method: "DELETE",
          headers: adminWriteHeaders(),
        },
      );
      if (!res.ok) {
        let message = `Failed to delete deck (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* not JSON — keep generic message */
        }
        setDeleteError(message);
        setDeleting(false);
        return;
      }
      // Success: optimistically hide the row, close the dialog, and
      // re-fetch the admin list. The hook's effect re-runs on mount,
      // not on demand, so we fall back to a full reload in the real
      // app. Tests don't see the reload because `setDeletedSlugs`
      // already filters the row out; the assertion path remains stable.
      setDeletedSlugs((prev) => {
        const next = new Set(prev);
        next.add(slug);
        return next;
      });
      setPendingDelete(null);
      setDeleting(false);
      if (typeof window !== "undefined" && window.location?.reload) {
        // Defer the reload so React commits the closed-dialog state
        // before the page tears down — keeps the visual transition
        // clean for the user.
        setTimeout(() => window.location.reload(), 0);
      }
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : "Network error — try again.",
      );
      setDeleting(false);
    }
  }, [pendingDelete]);

  // Esc on the confirm dialog is handled by `<ConfirmDialog>` itself,
  // which calls `onCancel`. Mid-flight cancellations are ignored by
  // `cancelDelete`. We keep this empty effect-free comment as a
  // reminder for the next reader.
  useEffect(() => {
    // Reset error state when the dialog is dismissed.
    if (!pendingDelete) setDeleteError(null);
  }, [pendingDelete]);

  const visibleEntries = entries.filter(
    (e) => !deletedSlugs.has(e.meta.slug),
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="cf-tag">Decks</p>
          <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
            All decks
          </h1>
          <p className="text-sm text-cf-text-muted">
            {visibleEntries.length === 0
              ? "No decks discovered yet."
              : `${visibleEntries.length} deck${visibleEntries.length === 1 ? "" : "s"} available · presenter mode active inside.`}
          </p>
        </div>
        <button
          type="button"
          data-interactive
          data-testid="new-deck-button"
          onClick={() => setNewDeckOpen(true)}
          className="cf-btn-primary"
        >
          New deck
        </button>
      </div>

      <NewDeckModal
        open={newDeckOpen}
        onClose={() => setNewDeckOpen(false)}
      />

      {visibleEntries.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visibleEntries.map((entry) => {
            // KV-backed decks have no on-disk source file; only render
            // the "Open in IDE" affordance for build-time entries.
            const isSource = (entry.source ?? "source") === "source";
            const rowShowIdeButton = showIdeButton && isSource;
            // Only KV-backed decks expose the delete trashcan. Source
            // decks live in code — deleting them is a `git rm`, not a
            // runtime API call.
            const rowShowDeleteButton = !isSource;
            const ideUrl = rowShowIdeButton
              ? vscodeUrlForDeckSource(
                  projectRoot,
                  entry.visibility,
                  entry.meta.slug,
                )
              : "";
            return (
              <AdminDeckRow
                key={entry.meta.slug}
                entry={entry}
                ideUrl={ideUrl}
                showIdeButton={rowShowIdeButton}
                showDeleteButton={rowShowDeleteButton}
                onRequestDelete={(e) => {
                  setPendingDelete(e);
                  setDeleteError(null);
                }}
              />
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete deck?"
        body={
          <>
            <p>
              Delete <strong>{pendingDelete?.meta.title}</strong>? This
              cannot be undone.
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
    </main>
  );
}
