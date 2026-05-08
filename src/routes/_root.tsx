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
          <div className="flex items-center gap-2">
            <Link
              to="/admin"
              className="cf-btn-ghost"
              data-testid="admin-link"
            >
              Studio
            </Link>
            <a
              href="https://github.com/mcdays94/slide-of-hand"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View source on GitHub"
              data-testid="github-link"
              className="cf-btn-ghost"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
            </a>
          </div>
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
