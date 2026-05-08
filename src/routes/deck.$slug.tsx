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
 *   - `?presenter-mode=1` — turns on `<PresenterModeProvider enabled>` so
 *     presenter affordances (the P-key listener; future tools) mount on
 *     the public viewer. **Dev-only override** — slice #7 will replace it
 *     by activating the provider on the admin route only. Remove this
 *     branch once #7 lands.
 *
 * Note: the `?presenter=1` branch only fires for build-time decks today.
 * Adding presenter window support for KV decks is a follow-up — the
 * presenter window currently expects a `Deck` (the framework type), and
 * we'd need to either thread `<DataDeck>`'s converted slides through
 * the same window component or extend it to accept either shape. Out
 * of scope for #61.
 */

import { Link, useParams, useSearchParams } from "react-router-dom";
import { Deck } from "@/framework/viewer/Deck";
import { DataDeck } from "@/framework/viewer/DataDeck";
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
