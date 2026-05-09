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

import { Link, useParams, useSearchParams } from "react-router-dom";
import { Deck } from "@/framework/viewer/Deck";
import { DataDeck, dataDeckToDeck } from "@/framework/viewer/DataDeck";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { PresenterWindow } from "@/framework/presenter/PresenterWindow";
import { getDeckBySlug, useAdminDataDeck } from "@/lib/decks-registry";
import { EditMode } from "@/framework/editor/EditMode";

export default function AdminDeckRoute() {
  const { slug } = useParams<{ slug: string }>();
  const [search] = useSearchParams();
  const editMode = search.get("edit") === "1";
  const presenterMode = search.get("presenter") === "1";

  const sourceDeck = slug ? getDeckBySlug(slug) : undefined;
  // Only fetch the KV record when the build-time registry missed.
  // We use the ADMIN variant (Slice 6 / #62) so private decks resolve
  // — the public hook would 404 them.
  const kvSlug = !sourceDeck && slug ? slug : "";
  const kvResult = useAdminDataDeck(kvSlug);

  // Edit mode: defer all rendering to <EditMode>, which does its own
  // KV fetch + 404 handling. Build-time decks are NOT editable in
  // Slice 6 (they live in source files); fall through to read-only.
  if (editMode && slug && !sourceDeck) {
    return (
      <PresenterModeProvider enabled={true}>
        <EditMode slug={slug} />
      </PresenterModeProvider>
    );
  }

  // Build-time deck: render the imperative <Deck>.
  if (sourceDeck) {
    if (presenterMode) {
      return <PresenterWindow deck={sourceDeck} />;
    }
    return (
      <PresenterModeProvider enabled={true}>
        <Deck
          slug={sourceDeck.meta.slug}
          title={sourceDeck.meta.title}
          slides={sourceDeck.slides}
        />
      </PresenterModeProvider>
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
