/**
 * `/` — public deck index.
 *
 * Renders every public deck — both source-based decks discovered at build
 * time AND KV-backed decks fetched from `/api/decks` — as a card, sorted by
 * `meta.date` descending. Build-time wins precedence on slug collision (see
 * `src/lib/decks-registry.ts` top-of-file comment for why).
 *
 * The page title is reset to "Slide of Hand" on mount — the deck viewer rewrites
 * it on navigate, so we must restore it when returning to the index.
 *
 * Network-failure fallback: if `/api/decks` returns non-2xx (or fails
 * outright), the page still renders with just the build-time list. The
 * audience never sees a network error message in v1 — KV decks are
 * additive.
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useDataDeckList } from "@/lib/decks-registry";
import { DeckCard } from "@/components/DeckCard";

export default function Root() {
  const { decks } = useDataDeckList();

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "Slide of Hand";
    }
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 py-16 sm:px-8 sm:py-24">
      <header className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <p className="cf-tag">Slide of Hand</p>
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
          {decks.map((meta) => (
            <li key={meta.slug}>
              <DeckCard meta={meta} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
