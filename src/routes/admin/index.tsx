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
 *
 * Pending source actions (issue #246): source-backed decks whose
 * lifecycle action is mid-flight in a GitHub PR get a Pending pill,
 * a PR link, and a Clear pending button on their card. The pending
 * record's `expectedState` field also drives placement:
 *   - pending archive  (expectedState=archived) → Archived section
 *   - pending restore  (expectedState=active)   → Active section
 *   - pending delete   (expectedState=deleted)  → Archived section
 *                                                 with Pending delete copy
 * KV-backed decks ignore pending projection — their lifecycle is
 * immediate (PR #245).
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
import {
  GitHubConnectGate,
  type GitHubConnectGateIntent,
  type SourceLifecycleAction,
} from "@/components/GitHubConnectGate";
import { useSettings } from "@/framework/viewer/useSettings";
import { useGitHubOAuth } from "@/lib/use-github-oauth";
import { usePendingSourceActions } from "@/lib/use-pending-source-actions";
import type { PendingSourceAction } from "@/lib/pending-source-actions";

/**
 * Friendly inline error string for source-backed lifecycle actions
 * whose real backend has not landed yet. Archive (#247) is wired;
 * Restore (#248) and Delete (#249) ship in follow-up slices and
 * still surface this copy on confirm.
 */
const SOURCE_NOT_WIRED_MESSAGE: Record<SourceLifecycleAction, string> = {
  archive:
    "Source archive backend is not wired yet — coming in a follow-up slice.",
  restore:
    "Source restore backend is not wired yet — coming in a follow-up slice.",
  delete:
    "Source delete backend is not wired yet — coming in a follow-up slice.",
};

/**
 * Call the source-backed Archive endpoint (#247). Returns the parsed
 * success payload, or throws an Error with the server's `error`
 * message attached for inline surfacing.
 *
 * The endpoint is slow (clones the repo + runs the full test gate
 * inside a Cloudflare Sandbox; expect 60–120 s wall time in
 * production) but the UI is "fire-and-forget from the user's
 * perspective": on resolution we refetch the pending list and let
 * the projection in `usePendingSourceActions` move the card to
 * Archived with a Pending pill + PR link.
 */
async function archiveSourceDeckViaEndpoint(slug: string): Promise<void> {
  const res = await fetch(
    `/api/admin/source-decks/${encodeURIComponent(slug)}/archive`,
    { method: "POST", headers: adminWriteHeaders() },
  );
  if (!res.ok) {
    let message = `Failed to archive source deck (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* not JSON — keep generic message */
    }
    throw new Error(message);
  }
}

export default function AdminIndex() {
  const { entries } = useAdminDataDeckList();
  const { settings, setSetting } = useSettings();
  // Pending source actions (issue #246) — markers for source-backed
  // deck lifecycle actions whose GitHub PRs are still in flight. Used
  // to project the EXPECTED placement of a deck onto the admin list
  // before the PR has merged + redeployed, so the author sees the
  // outcome immediately instead of having to remember which PR they
  // opened. KV-backed decks are NEVER subject to pending projection.
  const {
    actions: pendingActions,
    clearPending,
    refetch: refetchPending,
  } = usePendingSourceActions();
  // GitHub OAuth connection (issue #251). Source-backed lifecycle
  // actions require the user's GitHub token (we open draft PRs against
  // the repo). When disconnected, the lifecycle handler routes the
  // intent through `<GitHubConnectGate>` instead of running the stub.
  const githubConnection = useGitHubOAuth();
  // Stored intent for the source lifecycle action that triggered the
  // gate. Captured on confirm so the Retry button (visible once the
  // user has connected) can re-run the original action.
  const [sourceLifecycleIntent, setSourceLifecycleIntent] =
    useState<GitHubConnectGateIntent | null>(null);
  // Inline error surfaced on the gate after a failed Retry. The
  // source-action backends are stubs in this slice so Retry will
  // currently always surface the SOURCE_NOT_WIRED_MESSAGE.
  const [sourceLifecycleRetryError, setSourceLifecycleRetryError] = useState<
    string | null
  >(null);
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

  /**
   * Look up a deck's title for the gate's body copy. Falls back to
   * the slug if the registry entry is gone (shouldn't happen — the
   * action menu is rooted in the same entry list — but better safe).
   */
  const findTitle = useCallback(
    (slug: string): string => {
      const found = entries.find((e) => e.meta.slug === slug);
      return found?.meta.title ?? slug;
    },
    [entries],
  );

  /**
   * Issue #251 — open the GitHub connect gate for a source-backed
   * lifecycle action. Returns `true` if the gate intercepted (parent
   * should resolve cleanly so the existing confirm dialog closes);
   * `false` means the user is connected and the source stub path
   * should run. KV decks should NEVER pass through this helper.
   */
  const tryOpenSourceGate = useCallback(
    (action: SourceLifecycleAction, slug: string): boolean => {
      if (githubConnection.state === "connected") return false;
      setSourceLifecycleIntent({
        action,
        slug,
        title: findTitle(slug),
      });
      setSourceLifecycleRetryError(null);
      return true;
    },
    [githubConnection.state, findTitle],
  );

  const handleArchive = useCallback(
    async (slug: string) => {
      if (findSource(slug) !== "kv") {
        // Source-backed archive: gate on GitHub. If we open the gate
        // we resolve cleanly (no throw) so the existing confirm
        // dialog closes — the gate is now the surface for the
        // remaining intent.
        if (tryOpenSourceGate("archive", slug)) return;
        // GitHub connected: hit the real source-archive endpoint
        // (issue #247). On success the Worker has opened a draft
        // PR and persisted a `PendingSourceAction` record in KV.
        // Refetch the pending list so the projection in
        // `usePendingSourceActions` moves the card into the
        // Archived section with a Pending pill + PR link without
        // a full reload.
        await archiveSourceDeckViaEndpoint(slug);
        await refetchPending();
        return;
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
    [findSource, tryOpenSourceGate, refetchPending],
  );

  const handleRestore = useCallback(
    async (slug: string) => {
      if (findSource(slug) !== "kv") {
        if (tryOpenSourceGate("restore", slug)) return;
        throw new Error(SOURCE_NOT_WIRED_MESSAGE.restore);
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
    [findSource, tryOpenSourceGate],
  );

  /**
   * Side effect for a confirmed deletion.
   *
   * KV decks (issue #130): DELETE /api/admin/decks/<slug>, optimistically
   * hide the row, schedule a reload.
   *
   * Source decks (issue #251): gate on GitHub. If disconnected, the
   * gate intercepts and the parent dialog closes cleanly. If
   * connected, fall through to the stub error — the real source-delete
   * backend ships in a later slice (#247-#249 PR flow).
   *
   * The reload for KV decks is a follow-up — see issue #130's
   * acknowledged TODO: a cleaner refactor would expose `refetch` from
   * `useAdminDataDeckList`. Until then, `window.location.reload()` is
   * the cheapest correct approach.
   */
  const handleDelete = useCallback(
    async (slug: string) => {
      if (findSource(slug) !== "kv") {
        if (tryOpenSourceGate("delete", slug)) return;
        throw new Error(SOURCE_NOT_WIRED_MESSAGE.delete);
      }
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
    },
    [findSource, tryOpenSourceGate],
  );

  /**
   * Issue #251 — Retry handler for the GitHub connect gate. Once the
   * user has connected (the hook's status flips to `"connected"`),
   * Retry replays the stored source intent.
   *
   * Archive (#247) now invokes the real source-archive endpoint and
   * closes the gate on success. Restore (#248) and Delete (#249)
   * still surface the friendly "not yet wired" inline error until
   * their backends land.
   */
  const handleSourceLifecycleRetry = useCallback(async () => {
    if (!sourceLifecycleIntent) return;
    if (sourceLifecycleIntent.action === "archive") {
      try {
        await archiveSourceDeckViaEndpoint(sourceLifecycleIntent.slug);
        await refetchPending();
        // Success — close the gate. The pending projection takes
        // over the card's visual state.
        setSourceLifecycleIntent(null);
        setSourceLifecycleRetryError(null);
      } catch (err) {
        setSourceLifecycleRetryError(
          err instanceof Error
            ? err.message
            : `Failed to archive source deck.`,
        );
      }
      return;
    }
    setSourceLifecycleRetryError(
      SOURCE_NOT_WIRED_MESSAGE[sourceLifecycleIntent.action],
    );
  }, [sourceLifecycleIntent, refetchPending]);

  /**
   * Issue #251 — Cancel / dismiss the gate. Clears both the intent
   * and any inline retry error so the next open starts clean.
   */
  const handleSourceLifecycleCancel = useCallback(() => {
    setSourceLifecycleIntent(null);
    setSourceLifecycleRetryError(null);
  }, []);

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
  //
  // Issue #246 — pending source actions project the EXPECTED state
  // for source-backed decks onto placement:
  //   - pending archive  (expectedState=archived) → Archived
  //   - pending restore  (expectedState=active)   → Active
  //   - pending delete   (expectedState=deleted)  → Archived (with
  //     "Pending delete" copy on the pill — we don't drop the card
  //     because the PR may never merge)
  // KV-backed decks ignore the pending projection (lifecycle is
  // immediate from #245).
  const { activeEntries, archivedEntries } = useMemo(() => {
    const alive = entries.filter((e) => !deletedSlugs.has(e.meta.slug));
    const isArchivedNow = (
      slug: string,
      metaArchived: boolean | undefined,
      isSource: boolean,
    ): boolean => {
      // Pending source actions override placement for source-backed
      // decks only. A pending archive or pending delete pulls the
      // card into Archived; a pending restore pushes it into Active.
      const pending = isSource ? pendingActions[slug] : undefined;
      if (pending) {
        return pending.expectedState !== "active";
      }
      // No pending projection — fall back to the KV override map
      // (issue #245) and finally the persisted `meta.archived`.
      if (slug in archivedOverrides) {
        return archivedOverrides[slug] === true;
      }
      return metaArchived === true;
    };
    const archived = alive.filter((e) =>
      isArchivedNow(
        e.meta.slug,
        e.meta.archived,
        (e.source ?? "source") === "source",
      ),
    );
    const active = alive
      .filter(
        (e) =>
          !isArchivedNow(
            e.meta.slug,
            e.meta.archived,
            (e.source ?? "source") === "source",
          ),
      )
      .filter((e) => settings.showDrafts || e.meta.draft !== true);
    return { activeEntries: active, archivedEntries: archived };
  }, [
    entries,
    deletedSlugs,
    archivedOverrides,
    settings.showDrafts,
    pendingActions,
  ]);

  // Translate active registry entries into grid items. KV-backed
  // decks are deletable; source decks are not (they live in code).
  const activeItems: DeckCardGridItem[] = activeEntries.map((entry) =>
    toGridItem(entry, {
      showIdeButton,
      projectRoot,
      pendingActions,
      clearPending,
    }),
  );

  // Archived entries get the same card chrome plus the lifecycle
  // action menu (issue #244). Restore appears on every archived card
  // (the UI surface is universal across source + KV); Delete appears
  // on EVERY archived card too as of #251 — source Delete is routed
  // through the GitHub connect gate when the user is not connected.
  // The IDE link is dropped — the deck is retired, opening it for
  // editing is not the intended flow.
  //
  // Issue #246 — source-backed archived rows may carry a pending
  // source action projection. The pending pill renders the same way
  // here as in Active.
  const archivedItems: DeckCardGridItem[] = archivedEntries.map((entry) => {
    const isSource = (entry.source ?? "source") === "source";
    const pending = isSource ? pendingActions[entry.meta.slug] : undefined;
    return {
      meta: entry.meta,
      to: `/admin/decks/${entry.meta.slug}`,
      visibility: entry.visibility,
      canDelete: true,
      canRestore: true,
      pending: pending
        ? {
            action: pending.action,
            prUrl: pending.prUrl,
            onClear: clearPending,
          }
        : undefined,
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

      {/*
        Issue #251 — GitHub connect gate. Mounted at the route root so
        it overlays every deck card. Opens when a source-backed
        lifecycle action runs without a connected GitHub token; closes
        when the user cancels or successfully retries the intent.
      */}
      <GitHubConnectGate
        isOpen={sourceLifecycleIntent !== null}
        intent={sourceLifecycleIntent}
        connectionState={githubConnection.state}
        startUrl={githubConnection.startUrl()}
        onCancel={handleSourceLifecycleCancel}
        onRetry={handleSourceLifecycleRetry}
        retryError={sourceLifecycleRetryError}
      />
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
  /** Pending source actions keyed by slug (issue #246). */
  pendingActions: Record<string, PendingSourceAction>;
  /** Clear-pending handler (issue #246) — passed to source-backed pending cards. */
  clearPending: (slug: string) => Promise<void>;
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
  // Issue #251 — Delete is now exposed on BOTH KV and source rows.
  // For KV decks Delete continues to call the runtime DELETE
  // endpoint (issue #130). For source decks the click is gated by
  // the typed-slug confirm AND then the GitHub connect gate; once
  // the source-delete backend lands (#247-#249) the gate's Retry
  // will invoke the real PR-creating flow.
  const canDelete = true;
  // Archive is exposed on every active deck via the lifecycle menu
  // (issue #244). The real backend ships in a later slice; this slice
  // only surfaces the UI shape, and the AdminIndex's `handleArchive`
  // throws a friendly inline error if the user confirms.
  const canArchive = true;

  // Pending source actions project ONLY onto source-backed decks
  // (issue #246). KV decks get an immediate lifecycle from PR #245.
  const pending = isSource ? ctx.pendingActions[entry.meta.slug] : undefined;

  return {
    meta: entry.meta,
    to: `/admin/decks/${entry.meta.slug}`,
    visibility: entry.visibility,
    canDelete,
    canArchive,
    ideHref: ideHref || undefined,
    pending: pending
      ? {
          action: pending.action,
          prUrl: pending.prUrl,
          onClear: ctx.clearPending,
        }
      : undefined,
  };
}
