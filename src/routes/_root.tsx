/**
 * Root layout placeholder.
 *
 * Slice #4 replaces this with a real index page (curated public deck cards).
 * For now it just stubs `/` so the router has a valid root and dev visitors
 * can navigate manually to `/decks/<slug>`.
 */

import { Link } from "react-router-dom";
import { getPublicDecks } from "@/lib/decks-registry";

export default function Root() {
  const decks = getPublicDecks();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <p className="cf-tag">ReAction</p>
      <h1 className="text-5xl font-medium tracking-[-0.04em] text-cf-text sm:text-6xl">
        Decks
      </h1>
      <p className="max-w-lg text-base text-cf-text-muted">
        Pre-v1 — the curated index lands in slice #4. For now, jump straight
        into a deck.
      </p>
      {decks.length === 0 ? (
        <p className="text-sm text-cf-text-subtle">
          No decks discovered yet.
        </p>
      ) : (
        <ul className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          {decks.map((d) => (
            <li key={d.meta.slug}>
              <Link
                to={`/decks/${d.meta.slug}`}
                className="cf-card block p-6 text-left no-underline"
              >
                <p className="cf-tag mb-2">
                  {d.meta.date}
                  {d.meta.runtimeMinutes
                    ? ` · ${d.meta.runtimeMinutes} min`
                    : ""}
                </p>
                <p className="mb-1 text-xl font-medium tracking-[-0.025em] text-cf-text">
                  {d.meta.title}
                </p>
                <p className="text-sm text-cf-text-muted">
                  {d.meta.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
