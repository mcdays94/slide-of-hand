/**
 * Deck viewer route — `/decks/<slug>`.
 *
 * Resolution order (Slice 5 / #61):
 *   1. Build-time registry (`hasBuildTimeDeck` / `loadDeckBySlug`). If the
 *      slug matches a build-time deck → lazy-load the deck's chunk and
 *      render `<Deck>` once it resolves. Wrapped in a `<Suspense>` so the
 *      visitor sees a brief loading splash rather than a blank screen.
 *   2. KV-backed deck (`useDataDeck`). If found → render `<DataDeck>`.
 *   3. Both miss → 404 page.
 *
 * Lazy split (issue #105): build-time decks are fetched as their own
 * chunk only when this route mounts with a matching slug. Three.js,
 * topojson, react-three-fiber, etc. live inside heavy decks
 * (cf-code-mode's globe slide, cf-dynamic-workers' globe-app sub-app)
 * and never enter the main bundle.
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

import { Suspense, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Deck } from "@/framework/viewer/Deck";
import { DataDeck, dataDeckToDeck } from "@/framework/viewer/DataDeck";
import {
  getDeckResource,
  hasBuildTimeDeck,
  useDataDeck,
} from "@/lib/decks-registry";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { PresenterWindow } from "@/framework/presenter/PresenterWindow";

/**
 * Suspense fallback for the lazy build-time deck load. Matches the design
 * tokens (warm cream background + warm brown text) and the analytics
 * route's loading splash to keep the lazy-load UX consistent across the app.
 */
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
  presenterModeOverride: boolean;
}

/**
 * Reads the lazy-loaded `Deck` resource and renders the appropriate viewer.
 * Suspends (throws the load promise) until the deck's chunk is fetched.
 */
function BuildTimeDeck({
  slug,
  presenter,
  presenterModeOverride,
}: BuildTimeDeckProps) {
  const resource = useMemo(() => getDeckResource(slug), [slug]);
  const deck = resource.read();
  if (!deck) {
    // Should be impossible — `hasBuildTimeDeck` was true at the call
    // site — but if the loader returned undefined for any reason, fall
    // through to a 404 rather than crashing.
    return <NotFound slug={slug} />;
  }
  if (presenter) {
    return <PresenterWindow deck={deck} />;
  }
  return (
    <PresenterModeProvider enabled={presenterModeOverride}>
      <Deck slug={deck.meta.slug} title={deck.meta.title} slides={deck.slides} />
    </PresenterModeProvider>
  );
}

function NotFound({ slug }: { slug: string | undefined }) {
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

export default function DeckRoute() {
  const { slug } = useParams<{ slug: string }>();
  const [search] = useSearchParams();
  const isBuildTime = slug ? hasBuildTimeDeck(slug) : false;

  // Only fetch from KV when the build-time registry didn't have this slug.
  // Empty string short-circuits the hook (it skips the network call).
  const kvSlug = !isBuildTime && slug ? slug : "";
  const kvResult = useDataDeck(kvSlug);

  const presenterModeOverride = search.get("presenter-mode") === "1";
  const presenter = search.get("presenter") === "1";

  // ── 1. Build-time hit ─────────────────────────────────────────────────
  if (isBuildTime && slug) {
    return (
      <Suspense fallback={<DeckLoadingFallback />}>
        <BuildTimeDeck
          slug={slug}
          presenter={presenter}
          presenterModeOverride={presenterModeOverride}
        />
      </Suspense>
    );
  }

  // ── 2. KV hit ─────────────────────────────────────────────────────────
  if (kvResult.deck) {
    if (presenter) {
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
  return <NotFound slug={slug} />;
}
