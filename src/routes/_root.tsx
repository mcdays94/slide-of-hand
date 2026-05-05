/**
 * `/` — public deck index.
 *
 * Renders every deck under `src/decks/public/*` as a card, sorted by
 * `meta.date` descending. The registry already sorts, but we sort again
 * here defensively — the index page's contract is "newest first" regardless
 * of registry ordering. Each card links to the viewer at `/decks/<slug>`.
 *
 * The page title is reset to "ReAction" on mount — the deck viewer rewrites
 * it on navigate, so we must restore it when returning to the index.
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { getPublicDecks } from "@/lib/decks-registry";
import { DeckCard } from "@/components/DeckCard";

export default function Root() {
  const decks = [...getPublicDecks()].sort((a, b) => {
    if (a.meta.date === b.meta.date) {
      return a.meta.slug.localeCompare(b.meta.slug);
    }
    return b.meta.date.localeCompare(a.meta.date);
  });

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "ReAction";
    }
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 py-16 sm:px-8 sm:py-24">
      <header className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <p className="cf-tag">ReAction</p>
          <Link
            to="/admin"
            className="cf-btn-ghost"
            data-testid="admin-link"
          >
            Studio
          </Link>
        </div>
        <h1 className="text-4xl font-medium tracking-[-0.04em] text-cf-text sm:text-5xl">
          Decks
        </h1>
        <p className="max-w-2xl text-base text-cf-text-muted sm:text-lg">
          A small portfolio of talks and demos. Each deck runs on Cloudflare
          Workers and is built from typed React slides.
        </p>
      </header>

      {decks.length === 0 ? (
        <section
          className="cf-card flex flex-col items-center gap-3 px-8 py-16 text-center"
          data-testid="empty-state"
        >
          <p className="cf-tag">Empty</p>
          <p className="text-base text-cf-text-muted">
            No decks discovered yet.
          </p>
        </section>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((d) => (
            <li key={d.meta.slug}>
              <DeckCard meta={d.meta} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
