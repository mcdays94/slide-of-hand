/**
 * Deck viewer route — `/decks/<slug>`.
 *
 * Resolution order (Slice 5 / #61):
 *   1. Build-time registry (`getDeckBySlug`). If found → render existing
 *      source-based `<Deck>`.
 *   2. KV-backed deck (`useDataDeck`). If found → render `<DataDeck>`.
 *   3. Both miss → 404 page.
 *
 * Build-time wins precedence on slug collision (see `decks-registry.ts`
 * top-of-file comment for why). The KV fetch only fires when build-time
 * misses — saves a round-trip on the common path.
 *
 * Slice #5 query parameters:
 *
 *   - `?presenter=1` — swaps the live `<Deck>` for `<PresenterWindow>`. This
 *     is what the spawned popup tab loads when the author presses `P`.
 *     Works for both build-time decks and KV-backed (`<DataDeck>`) decks
 *     — the latter via the `dataDeckToDeck()` adapter (#61 follow-up).
 *   - `?presenter-mode=1` — turns on `<PresenterModeProvider enabled>` so
 *     presenter affordances (the P-key listener; future tools) mount on
 *     the public viewer. **Dev-only override** — slice #7 will replace it
 *     by activating the provider on the admin route only. Remove this
 *     branch once #7 lands.
 */

import { Link, useParams, useSearchParams } from "react-router-dom";
import { Deck } from "@/framework/viewer/Deck";
import { DataDeck, dataDeckToDeck } from "@/framework/viewer/DataDeck";
import { getDeckBySlug, useDataDeck } from "@/lib/decks-registry";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { PresenterWindow } from "@/framework/presenter/PresenterWindow";

export default function DeckRoute() {
  const { slug } = useParams<{ slug: string }>();
  const [search] = useSearchParams();
  const sourceDeck = slug ? getDeckBySlug(slug) : undefined;

  // Only fetch from KV when the build-time registry didn't have this slug.
  // Empty string short-circuits the hook (it skips the network call).
  const kvSlug = !sourceDeck && slug ? slug : "";
  const kvResult = useDataDeck(kvSlug);

  const presenterModeOverride = search.get("presenter-mode") === "1";

  // ── 1. Build-time hit ─────────────────────────────────────────────────
  if (sourceDeck) {
    if (search.get("presenter") === "1") {
      return <PresenterWindow deck={sourceDeck} />;
    }
    return (
      <PresenterModeProvider enabled={presenterModeOverride}>
        <Deck
          slug={sourceDeck.meta.slug}
          title={sourceDeck.meta.title}
          slides={sourceDeck.slides}
        />
      </PresenterModeProvider>
    );
  }

  // ── 2. KV hit ─────────────────────────────────────────────────────────
  if (kvResult.deck) {
    if (search.get("presenter") === "1") {
      // Adapt the KV-backed record to the framework `Deck` shape the
      // presenter window expects. The adapter is pure — every per-slide
      // field the presenter window reads (id, title, notes, phases,
      // runtimeSeconds) survives the round-trip.
      return <PresenterWindow deck={dataDeckToDeck(kvResult.deck)} />;
    }
    return (
      <PresenterModeProvider enabled={presenterModeOverride}>
        <DataDeck deck={kvResult.deck} />
      </PresenterModeProvider>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────
  // While the KV fetch is in flight (and build-time missed), show nothing.
  // The 404 path takes over the moment the fetch resolves with notFound.
  if (kvResult.isLoading) {
    return null;
  }

  // ── 3. 404 ────────────────────────────────────────────────────────────
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="cf-tag">404</p>
      <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
        No deck called “{slug}”.
      </h1>
      <Link to="/" className="cf-btn-ghost">
        Back to decks
      </Link>
    </main>
  );
}
