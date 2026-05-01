/**
 * Admin deck index — `/admin`.
 *
 * Lists every locally-available deck (public + private in dev; public only
 * in the production bundle, since `private/*` is excluded at registry-build
 * time — see `lib/decks-registry.ts`).
 *
 * Each row shows a visibility badge so the author can see at a glance which
 * decks are committed-and-public vs author-only-private.
 *
 * Each entry links to `/admin/decks/<slug>` where the viewer mounts in
 * presenter mode (presenter window key handlers + tools auto-activate via
 * the `<PresenterModeProvider>` wrap in slice #7's `decks.$slug.tsx`).
 */

import { Link } from "react-router-dom";
import { getAllDeckEntries } from "@/lib/decks-registry";

export default function AdminIndex() {
  const entries = getAllDeckEntries();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <p className="cf-tag">Decks</p>
        <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
          All decks
        </h1>
        <p className="text-sm text-cf-text-muted">
          {entries.length === 0
            ? "No decks discovered yet."
            : `${entries.length} deck${entries.length === 1 ? "" : "s"} available · presenter mode active inside.`}
        </p>
      </div>

      {entries.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {entries.map((entry) => {
            const { deck, visibility } = entry;
            return (
              <li key={deck.meta.slug}>
                <Link
                  to={`/admin/decks/${deck.meta.slug}`}
                  className="cf-card block p-6 text-left no-underline"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <p className="cf-tag">
                      {deck.meta.date}
                      {deck.meta.runtimeMinutes
                        ? ` · ${deck.meta.runtimeMinutes} min`
                        : ""}
                    </p>
                    <span
                      data-visibility={visibility}
                      className={
                        visibility === "private"
                          ? "rounded border border-cf-orange/40 bg-cf-orange/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-orange"
                          : "rounded border border-cf-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle"
                      }
                    >
                      {visibility}
                    </span>
                  </div>
                  <p className="mb-1 text-xl font-medium tracking-[-0.025em] text-cf-text">
                    {deck.meta.title}
                  </p>
                  <p className="text-sm text-cf-text-muted">
                    {deck.meta.description}
                  </p>
                  {deck.meta.author && (
                    <p className="mt-3 text-xs text-cf-text-subtle">
                      {deck.meta.author}
                      {deck.meta.event ? ` · ${deck.meta.event}` : ""}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
