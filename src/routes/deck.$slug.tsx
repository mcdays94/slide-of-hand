/**
 * Deck viewer route — `/decks/<slug>`.
 *
 * Resolves the slug against the auto-discovered registry and mounts `<Deck>`.
 * 404s for unknown slugs.
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
 */

import { Link, useParams, useSearchParams } from "react-router-dom";
import { Deck } from "@/framework/viewer/Deck";
import { getDeckBySlug } from "@/lib/decks-registry";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { PresenterWindow } from "@/framework/presenter/PresenterWindow";

export default function DeckRoute() {
  const { slug } = useParams<{ slug: string }>();
  const [search] = useSearchParams();
  const deck = slug ? getDeckBySlug(slug) : undefined;

  if (!deck) {
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

  // Presenter window — spawned by the main viewer via window.open.
  if (search.get("presenter") === "1") {
    return <PresenterWindow deck={deck} />;
  }

  // DEV-ONLY: forces presenter affordances on the public viewer so the P
  // key works without slice #7's admin route. Remove once admin route ships.
  const presenterModeOverride = search.get("presenter-mode") === "1";

  return (
    <PresenterModeProvider enabled={presenterModeOverride}>
      <Deck slug={deck.meta.slug} title={deck.meta.title} slides={deck.slides} />
    </PresenterModeProvider>
  );
}
