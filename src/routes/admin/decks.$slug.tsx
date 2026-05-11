/**
 * Admin deck viewer — `/admin/decks/<slug>`.
 *
 * Renders the same `<Deck>` component as the public viewer, but wrapped in
 * `<PresenterModeProvider enabled={true}>`. That single context flip
 * activates every presenter affordance composed inside `<Deck>`:
 *
 *   - Slice #5: presenter window key handlers (`P` opens presenter window).
 *   - Slice #6: laser / magnifier / marker tools + auto-hide chrome.
 *
 * No prop wiring needed; `<PresenterAffordances>` reads the context and
 * mounts/unmounts itself accordingly.
 *
 * Lazy-load (issue #105): build-time decks are fetched as their own chunk
 * only when this route mounts with a matching slug. The Suspense boundary
 * shows a brief loading splash while the chunk arrives.
 *
 * 404 fallback for unknown slugs falls through to the KV-backed editor
 * path (Slice 6 / #62): a brand-new deck created by the wizard exists
 * only in KV, so the build-time registry never resolves it. With
 * `?edit=1` we mount `<EditMode>` (which does its own KV fetch and
 * 404 handling); without `?edit=1`, we mount `<DataDeck>` for the
 * read-only view, so authors can preview their KV-only deck inside
 * the admin shell.
 *
 * Edit mode (Slice 6 / #62) is `?edit=1`. We branch BEFORE the
 * build-time registry lookup so a build-time deck can also be edited
 * — no, that's a future feature: build-time decks are code, not KV
 * records, so editing them via the modal would have no effect on the
 * source. For Slice 6 we only mount `<EditMode>` when there's NO
 * build-time deck for this slug.
 */

import { Suspense, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Deck } from "@/framework/viewer/Deck";
import { DataDeck, dataDeckToDeck } from "@/framework/viewer/DataDeck";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { PresenterWindow } from "@/framework/presenter/PresenterWindow";
import {
  getDeckResource,
  hasBuildTimeDeck,
  useAdminDataDeck,
} from "@/lib/decks-registry";
import { EditMode } from "@/framework/editor/EditMode";
import { RequireAdminAccess } from "@/components/RequireAdminAccess";

function DeckLoadingFallback() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cf-bg-100 px-6 text-center">
      <p className="cf-tag">Loading</p>
      <p className="text-sm text-cf-text-muted">Loading deck…</p>
    </main>
  );
}

interface BuildTimeDeckProps {
  slug: string;
  presenter: boolean;
}

function BuildTimeDeck({ slug, presenter }: BuildTimeDeckProps) {
  const resource = useMemo(() => getDeckResource(slug), [slug]);
  const deck = resource.read();
  if (!deck) {
    return <NotFound slug={slug} />;
  }
  if (presenter) {
    return <PresenterWindow deck={deck} />;
  }
  return (
    <PresenterModeProvider enabled={true}>
      <Deck
        slug={deck.meta.slug}
        title={deck.meta.title}
        slides={deck.slides}
      />
    </PresenterModeProvider>
  );
}

function NotFound({ slug }: { slug: string | undefined }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="cf-tag">404</p>
      <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
        No deck called &ldquo;{slug}&rdquo;.
      </h1>
      <Link to="/admin" className="cf-btn-ghost">
        Back to admin
      </Link>
    </main>
  );
}

/**
 * Client-side route guard wrapper. `<AdminDeckRoute>` is NOT nested
 * under `<AdminLayout>` (see App.tsx — the deck viewer fills the full
 * viewport, no chrome strip), so it does not inherit the layout's
 * `<RequireAdminAccess>` gate. Wrap explicitly here so an
 * unauthenticated visitor that navigates to `/admin/decks/<slug>` via
 * client-side React Router nav (which bypasses Cloudflare Access at
 * the edge) gets the sign-in landing instead of the admin chrome.
 *
 * The inner hooks (`useAdminDataDeck`, etc.) only mount when the
 * guard resolves to authenticated — so we don't fire wasted KV
 * fetches for visitors who shouldn't be here in the first place.
 */
export default function AdminDeckRoute() {
  return (
    <RequireAdminAccess>
      <AdminDeckRouteInner />
    </RequireAdminAccess>
  );
}

function AdminDeckRouteInner() {
  const { slug } = useParams<{ slug: string }>();
  const [search] = useSearchParams();
  const editMode = search.get("edit") === "1";
  const presenterMode = search.get("presenter") === "1";

  const isBuildTime = slug ? hasBuildTimeDeck(slug) : false;
  // Only fetch the KV record when the build-time registry missed.
  // We use the ADMIN variant (Slice 6 / #62) so private decks resolve
  // — the public hook would 404 them.
  const kvSlug = !isBuildTime && slug ? slug : "";
  const kvResult = useAdminDataDeck(kvSlug);

  // Edit mode: defer all rendering to <EditMode>, which does its own
  // KV fetch + 404 handling. Build-time decks are NOT editable in
  // Slice 6 (they live in source files); fall through to read-only.
  if (editMode && slug && !isBuildTime) {
    return (
      <PresenterModeProvider enabled={true}>
        <EditMode slug={slug} />
      </PresenterModeProvider>
    );
  }

  // Build-time deck: lazy-load and render the imperative <Deck>.
  if (isBuildTime && slug) {
    return (
      <Suspense fallback={<DeckLoadingFallback />}>
        <BuildTimeDeck slug={slug} presenter={presenterMode} />
      </Suspense>
    );
  }

  // KV deck (read-only on the admin route — entry into edit is via
  // the `R` key or the wizard's redirect).
  if (kvResult.deck) {
    if (presenterMode) {
      // KV-backed decks support presenter mode via the dataDeckToDeck()
      // adapter (#61 follow-up). Same window component as build-time
      // decks; the conversion preserves id/title/notes/phases on every
      // slide.
      return <PresenterWindow deck={dataDeckToDeck(kvResult.deck)} />;
    }
    return (
      <PresenterModeProvider enabled={true}>
        <DataDeck deck={kvResult.deck} />
      </PresenterModeProvider>
    );
  }

  // While the KV fetch is in flight, render nothing — the 404 path
  // takes over the moment the fetch resolves.
  if (kvResult.isLoading) {
    return null;
  }

  return <NotFound slug={slug} />;
}
