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
 * Lifecycle action menu (issue #244 / PRD #242): each card exposes a
 * hover-revealed action menu in its corner. Active KV decks show
 * Archive + Delete; archived KV decks show Restore + Delete. Source
 * decks show Archive on active rows and Restore on archived rows.
 * Delete uses a typed-slug confirmation primitive
 * (`<TypedSlugConfirmDialog>`); Archive / Restore use a simple
 * confirmation. This slice is the UI shape only — Archive / Restore
 * surface a friendly "not yet wired" inline error if the user confirms.
 * Later slices (#245 KV, #247-249 source) wire the real backends.
 *
 * Delete continues to call `DELETE /api/admin/decks/<slug>` and reload
 * for KV-backed decks (the legacy issue #130 flow). Source decks have
 * no delete backend yet — they don't expose Delete in this slice.
 *
 * Composition: the card grid + Grid/List toggle + per-card visibility
 * badge + per-card lifecycle dialogs ALL live inside `<DeckCardGrid>` /
 * `<DeckCard>`. This route is thin: build the items array, hand it to
 * the grid, supply the lifecycle side-effects.
 */

import { useCallback, useMemo, useState } from "react";
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
import { useSettings } from "@/framework/viewer/useSettings";

export default function AdminIndex() {
  const { entries } = useAdminDataDeckList();
  const { settings, setSetting } = useSettings();
  // Local-state list of KV slugs that have been deleted in this session.
  // We optimistically hide them while the admin list refetches via
  // `window.location.reload()` (which fully re-runs the hook). For the
  // unit-test path the hook is mocked, so `useAdminDataDeckList` won't
  // re-fetch in response to a state change — `deletedSlugs` makes the
  // delete UX correct in both worlds.
  const [deletedSlugs, setDeletedSlugs] = useState<Set<string>>(
    () => new Set(),
  );
  // Issue #245: KV archive/restore land local overrides for the
  // lifecycle flag so the affected card jumps between Active and
  // Archived immediately, without a full reload. The map is keyed by
  // slug → next-archived-state; missing entries mean "use the value
  // from the registry hook as-is". Unlike `deletedSlugs`, we cannot
  // simply rely on a refetch because the mocked hook in unit tests
  // does not re-resolve on state change, and even in production a
  // reload would feel sluggish for a reversible action.
  const [archivedOverrides, setArchivedOverrides] = useState<
    Record<string, boolean>
  >(() => ({}));

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

  /**
   * Issue #245: real KV archive / restore for KV-backed decks.
   *
   * Source-backed decks have no runtime mutation surface yet (the
   * GitHub PR flow ships in PRD #242 follow-up slices) so we keep the
   * `not yet wired` inline error for those rows — preserves the
   * friendly feedback from #244 while making clear that KV decks now
   * work end-to-end.
   *
   * The KV→source split is decided by walking the registry entries
   * for the slug and reading `entry.source`. We capture it inside the
   * callback so the handler stays a pure `(slug: string) => void`
   * that matches the `<DeckCardGrid>` prop contract.
   *
   * Local UI: on success we toggle `archivedOverrides[slug]` so the
   * card jumps between sections immediately. We do NOT call
   * `window.location.reload()` here because archive is a reversible,
   * non-destructive lifecycle event — a full reload would feel
   * heavier than the action warrants and would also fight the
   * existing unit-test path where `useAdminDataDeckList` is mocked.
   */
  const findSource = useCallback(
    (slug: string): "source" | "kv" => {
      const found = entries.find((e) => e.meta.slug === slug);
      return (found?.source ?? "source") as "source" | "kv";
    },
    [entries],
  );

  const handleArchive = useCallback(
    async (slug: string) => {
      if (findSource(slug) !== "kv") {
        throw new Error(
          "Archive backend is not wired yet — coming in a follow-up slice.",
        );
      }
      const res = await fetch(
        `/api/admin/decks/${encodeURIComponent(slug)}/archive`,
        { method: "POST", headers: adminWriteHeaders() },
      );
      if (!res.ok) {
        let message = `Failed to archive deck (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* not JSON — keep generic message */
        }
        throw new Error(message);
      }
      setArchivedOverrides((prev) => ({ ...prev, [slug]: true }));
    },
    [findSource],
  );

  const handleRestore = useCallback(
    async (slug: string) => {
      if (findSource(slug) !== "kv") {
        throw new Error(
          "Restore backend is not wired yet — coming in a follow-up slice.",
        );
      }
      const res = await fetch(
        `/api/admin/decks/${encodeURIComponent(slug)}/restore`,
        { method: "POST", headers: adminWriteHeaders() },
      );
      if (!res.ok) {
        let message = `Failed to restore deck (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* not JSON — keep generic message */
        }
        throw new Error(message);
      }
      setArchivedOverrides((prev) => ({ ...prev, [slug]: false }));
    },
    [findSource],
  );

  // Issue #243: split the merged admin list into Active vs Archived.
  // Archived wins over Draft on placement — a deck with both flags
  // lives in the Archived section, not the Active draft-filter path.
  // The Active section is subject to the `showDrafts` toggle (issue
  // #191); the Archived section is always visible (no toggle).
  //
  // Issue #245 — `archivedOverrides[slug]` lets the local UI flip a
  // card between sections before the registry hook re-resolves. The
  // override beats the persisted `meta.archived` so the card moves
  // immediately on a successful archive/restore POST.
  const { activeEntries, archivedEntries } = useMemo(() => {
    const alive = entries.filter((e) => !deletedSlugs.has(e.meta.slug));
    const isArchivedNow = (slug: string, metaArchived: boolean | undefined) =>
      slug in archivedOverrides
        ? archivedOverrides[slug] === true
        : metaArchived === true;
    const archived = alive.filter((e) =>
      isArchivedNow(e.meta.slug, e.meta.archived),
    );
    const active = alive
      .filter((e) => !isArchivedNow(e.meta.slug, e.meta.archived))
      .filter((e) => settings.showDrafts || e.meta.draft !== true);
    return { activeEntries: active, archivedEntries: archived };
  }, [entries, deletedSlugs, archivedOverrides, settings.showDrafts]);

  // Translate active registry entries into grid items. KV-backed
  // decks are deletable; source decks are not (they live in code).
  const activeItems: DeckCardGridItem[] = activeEntries.map((entry) =>
    toGridItem(entry, { showIdeButton, projectRoot }),
  );

  // Archived entries get the same card chrome plus the lifecycle
  // action menu (issue #244). Restore appears on every archived card
  // (the UI surface is universal across source + KV); Delete appears
  // only on KV-backed archived decks, mirroring the active-side gate
  // (source decks have no delete backend yet). The IDE link is
  // dropped — the deck is retired, opening it for editing is not the
  // intended flow.
  const archivedItems: DeckCardGridItem[] = archivedEntries.map((entry) => {
    const isSource = (entry.source ?? "source") === "source";
    return {
      meta: entry.meta,
      to: `/admin/decks/${entry.meta.slug}`,
      visibility: entry.visibility,
      canDelete: !isSource,
      canRestore: true,
    };
  });

  // Headline copy: prefer talking about the active set since the
  // Archived section is its own heading + helper line.
  const activeCount = activeItems.length;
  const totalCount = activeCount + archivedItems.length;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="cf-tag">Decks</p>
          <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
            All decks
          </h1>
          <p className="text-sm text-cf-text-muted">
            {totalCount === 0
              ? "No decks discovered yet."
              : `${totalCount} deck${totalCount === 1 ? "" : "s"} available · presenter mode active inside.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DraftFilterToggle
            value={settings.showDrafts}
            onChange={(next) => setSetting("showDrafts", next)}
          />
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
      </div>

      <section
        data-testid="admin-active-section"
        className="flex flex-col gap-4"
      >
        <DeckCardGrid
          surface="admin"
          items={activeItems}
          onDelete={handleDelete}
          onArchive={handleArchive}
        />
      </section>

      {archivedItems.length > 0 && (
        <section
          data-testid="admin-archived-section"
          className="flex flex-col gap-4 border-t border-cf-border pt-8"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-medium tracking-[-0.025em] text-cf-text">
              Archived decks
            </h2>
            <p className="text-sm text-cf-text-muted">
              Retired decks. Public links return not found.
            </p>
          </div>
          <DeckCardGrid
            surface="admin"
            items={archivedItems}
            onDelete={handleDelete}
            onRestore={handleRestore}
          />
        </section>
      )}
    </main>
  );
}

/**
 * Small two-state segmented control for the drafts filter (issue
 * #191). Mirrors the styling of `<SettingsSegmentedRow>` so the
 * affordance reads as a settings-style toggle, not a primary action.
 * Uppercase mono labels keep the chrome quiet; the orange-accent fill
 * marks the active option.
 */
interface DraftFilterToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
}

function DraftFilterToggle({ value, onChange }: DraftFilterToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Drafts filter"
      data-testid="admin-draft-filter"
      className="flex shrink-0 items-center gap-1 rounded-md border border-cf-border bg-cf-bg-200 p-0.5"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === true}
        data-interactive
        data-testid="admin-draft-filter-show"
        onClick={() => onChange(true)}
        className={`rounded px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
          value === true
            ? "bg-cf-orange text-cf-bg-100"
            : "text-cf-text-muted hover:text-cf-text"
        }`}
      >
        Show drafts
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === false}
        data-interactive
        data-testid="admin-draft-filter-hide"
        onClick={() => onChange(false)}
        className={`rounded px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
          value === false
            ? "bg-cf-orange text-cf-bg-100"
            : "text-cf-text-muted hover:text-cf-text"
        }`}
      >
        Hide drafts
      </button>
    </div>
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
  // Only KV-backed decks expose the runtime Delete action. Source
  // decks live in code — deleting them is a `git rm`, not a runtime
  // API call. (Source Delete via GitHub PR ships in a later slice.)
  const canDelete = !isSource;
  // Archive is exposed on every active deck via the lifecycle menu
  // (issue #244). The real backend ships in a later slice; this slice
  // only surfaces the UI shape, and the AdminIndex's `handleArchive`
  // throws a friendly inline error if the user confirms.
  const canArchive = true;

  return {
    meta: entry.meta,
    to: `/admin/decks/${entry.meta.slug}`,
    visibility: entry.visibility,
    canDelete,
    canArchive,
    ideHref: ideHref || undefined,
  };
}
