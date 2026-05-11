/**
 * Presenter affordances (laser, magnifier, marker, P-key window trigger,
 * TopToolbar admin buttons, Theme / Inspect / Slides / Analytics / AI,
 * EditMode, StudioBadge, the admin-only Settings rows) are gated by
 * `<PresenterModeProvider>`. On this PUBLIC route the provider's
 * `enabled` is driven by `useAccessAuth()` — only callers with a valid
 * Cloudflare Access session (i.e. authenticated admins viewing their
 * own deck on the public URL) see the author UI. Unauthenticated
 * visitors get the audience-side chrome only.
 *
 * Earlier (2026-05-10) we expanded the affordances "globally" so any
 * presenter could use them without a magic URL flag — but `enabled={true}`
 * leaked admin UI (Settings rows for AI model, GitHub, speaker notes,
 * deck card hover; the AI sparkle button; the P-key presenter trigger;
 * Theme / Inspect / Analytics buttons) to anyone hitting `/decks/<slug>`
 * on the public web. Auth-gating the provider on this route restores
 * the intended split: admins-in-public-viewer still get their tools;
 * audience members see only viewing controls.
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
import { useAccessAuth } from "@/lib/use-access-auth";

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
  /**
   * Driven by `useAccessAuth()` in the parent. When `false` we render
   * the deck with no admin affordances — public visitors get a clean
   * viewer with no Theme / Inspect / AI / Slides / Analytics buttons,
   * no Settings rows for admin-only preferences, no presenter-window
   * trigger on the P key. The PresenterWindow itself has its own
   * defense-in-depth auth check (see `PresenterWindow.tsx`).
   */
  isAdmin: boolean;
}

/**
 * Reads the lazy-loaded `Deck` resource and renders the appropriate viewer.
 * Suspends (throws the load promise) until the deck's chunk is fetched.
 */
function BuildTimeDeck({ slug, presenter, isAdmin }: BuildTimeDeckProps) {
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
    <PresenterModeProvider enabled={isAdmin}>
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

  const presenter = search.get("presenter") === "1";

  // The gate for showing admin affordances (Theme / Inspect / AI / etc.)
  // in the viewer chrome. Driven by Cloudflare Access status — non-Access
  // visitors get the audience view; signed-in admins viewing their own
  // deck via the public URL still get their tools. Probe fires once per
  // mount via `useAccessAuth`'s `/api/admin/auth-status` call. While
  // `status === "checking"` we render audience chrome (conservative —
  // never flash admin UI then hide it).
  const authStatus = useAccessAuth();
  const isAdmin = authStatus === "authenticated";

  // ── 1. Build-time hit ─────────────────────────────────────────────────
  if (isBuildTime && slug) {
    return (
      <Suspense fallback={<DeckLoadingFallback />}>
        <BuildTimeDeck slug={slug} presenter={presenter} isAdmin={isAdmin} />
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
      <PresenterModeProvider enabled={isAdmin}>
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
