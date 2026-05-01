/**
 * Deck viewer route — `/decks/<slug>`.
 *
 * Resolves the slug against the auto-discovered registry and mounts `<Deck>`.
 * 404s for unknown slugs.
 */

import { Link, useParams } from "react-router-dom";
import { Deck } from "@/framework/viewer/Deck";
import { getDeckBySlug } from "@/lib/decks-registry";

export default function DeckRoute() {
  const { slug } = useParams<{ slug: string }>();
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

  return (
    <Deck slug={deck.meta.slug} title={deck.meta.title} slides={deck.slides} />
  );
}
