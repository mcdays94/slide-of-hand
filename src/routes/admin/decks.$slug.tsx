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
 * 404 fallback for unknown slugs mirrors the public viewer's UX.
 */

import { Link, useParams } from "react-router-dom";
import { Deck } from "@/framework/viewer/Deck";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { getDeckBySlug } from "@/lib/decks-registry";

export default function AdminDeckRoute() {
  const { slug } = useParams<{ slug: string }>();
  const deck = slug ? getDeckBySlug(slug) : undefined;

  if (!deck) {
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

  return (
    <PresenterModeProvider enabled={true}>
      <Deck slug={deck.meta.slug} title={deck.meta.title} slides={deck.slides} />
    </PresenterModeProvider>
  );
}
