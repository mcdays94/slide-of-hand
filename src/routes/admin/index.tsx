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
 * Each card shows a visibility badge for private decks so the author
 * can see at a glance which decks are committed-and-public vs author-
 * only-private.
 *
 * Each entry links to `/admin/decks/<slug>` where the viewer mounts in
 * presenter mode (presenter window key handlers + tools auto-activate via
 * the `<PresenterModeProvider>` wrap in slice #7's `decks.$slug.tsx`).
 *
 * The "Open in IDE" affordance is rendered only for source decks — KV
 * decks have no on-disk source file to open.
 *
 * Issue #130 / #127: KV-backed deck cards expose a hover-revealed
 * trashcan that opens a `<ConfirmDialog>`. Confirming hits
 * `DELETE /api/admin/decks/<slug>` and triggers `window.location.reload()`
 * to re-pull the admin list. Build-time decks have no UI trashcan because
 * they live in source files — deletion is a `git rm`, not a runtime
 * action.
 *
 * Composition: the card grid + Grid/List toggle + per-card visibility
 * badge + per-card delete dialog ALL live inside `<DeckCardGrid>` /
 * `<DeckCard>` (issue #127). This route is now thin: build the items
 * array, hand it to the grid, supply the delete side-effect.
 */

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import {
  useAdminDataDeckList,
  type RegistryEntry,
} from "@/lib/decks-registry";
import { vscodeUrlForDeckSource } from "@/lib/vscode-url";
import { adminWriteHeaders } from "@/lib/admin-fetch";
import {
  DeckCardGrid,
  type DeckCardGridItem,
} from "@/components/DeckCardGrid";

export default function AdminIndex() {
  const { entries } = useAdminDataDeckList();
  // Local-state list of KV slugs that have been deleted in this session.
  // We optimistically hide them while the admin list refetches via
  // `window.location.reload()` (which fully re-runs the hook). For the
  // unit-test path the hook is mocked, so `useAdminDataDeckList` won't
  // re-fetch in response to a state change — `deletedSlugs` makes the
  // delete UX correct in both worlds.
  const [deletedSlugs, setDeletedSlugs] = useState<Set<string>>(
    () => new Set(),
  );

  // `__PROJECT_ROOT__` is injected by vite.config.ts: an absolute path in
  // dev (`command === "serve"`), the empty string in production builds.
  // We additionally gate the IDE button render on `import.meta.env.DEV`
  // so the production bundle has no trace of the affordance even if the
  // sentinel ever leaks through.
  const projectRoot = __PROJECT_ROOT__;
  const showIdeButton = import.meta.env.DEV && projectRoot.length > 0;

  /**
   * Side effect for a confirmed deletion. Hits the admin DELETE
   * endpoint, optimistically hides the row on success, then triggers a
   * full reload so the admin list re-pulls from KV. Throws on failure
   * so the card's confirm dialog can surface the error inline and let
   * the user retry without closing.
   *
   * The reload is a follow-up — see issue #130's acknowledged TODO: a
   * cleaner refactor would expose `refetch` from `useAdminDataDeckList`.
   * Until then, `window.location.reload()` is the cheapest correct
   * approach.
   */
  const handleDelete = useCallback(async (slug: string) => {
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
      throw new Error(message);
    }
    // Success: optimistically hide the row, then schedule a reload.
    // We defer the reload so React commits the closed-dialog state
    // before the page tears down — keeps the visual transition clean.
    setDeletedSlugs((prev) => {
      const next = new Set(prev);
      next.add(slug);
      return next;
    });
    if (typeof window !== "undefined" && window.location?.reload) {
      setTimeout(() => window.location.reload(), 0);
    }
  }, []);

  const visibleEntries = entries.filter(
    (e) => !deletedSlugs.has(e.meta.slug),
  );

  // Translate each registry entry into a grid item. KV-backed decks
  // are deletable; source decks are not (they live in code).
  const items: DeckCardGridItem[] = visibleEntries.map((entry) =>
    toGridItem(entry, { showIdeButton, projectRoot }),
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
        {/* Issue #171: New-deck creation is now a route (the
            AI-first creator at /admin/decks/new) rather than a
            modal. The button is a Link so it benefits from React
            Router's client-side nav (no flash, no page reload). */}
        <Link
          to="/admin/decks/new"
          data-interactive
          data-testid="new-deck-button"
          className="cf-btn-primary"
        >
          New deck
        </Link>
      </div>

      <DeckCardGrid
        surface="admin"
        items={items}
        onDelete={handleDelete}
      />
    </main>
  );
}

interface ToGridItemContext {
  showIdeButton: boolean;
  projectRoot: string;
}

function toGridItem(
  entry: RegistryEntry,
  ctx: ToGridItemContext,
): DeckCardGridItem {
  // KV-backed decks have no on-disk source file; only render the
  // "Open in IDE" affordance for build-time entries.
  const isSource = (entry.source ?? "source") === "source";
  const ideHref =
    ctx.showIdeButton && isSource
      ? vscodeUrlForDeckSource(
          ctx.projectRoot,
          entry.visibility,
          entry.meta.slug,
        )
      : undefined;
  // Only KV-backed decks expose the delete trashcan. Source decks
  // live in code — deleting them is a `git rm`, not a runtime API
  // call.
  const canDelete = !isSource;

  return {
    meta: entry.meta,
    to: `/admin/decks/${entry.meta.slug}`,
    visibility: entry.visibility,
    canDelete,
    ideHref: ideHref || undefined,
  };
}
