/**
 * Admin deck index — `/admin`.
 *
 * Lists every deck the author has access to:
 *
 *   - Build-time (source) decks, public + private (private only in dev).
 *   - KV-backed decks created via the New Deck modal, both public AND
 *     private (the admin endpoint at `/api/admin/decks` returns the
 *     full set; see `worker/decks.ts`).
 *
 * Each row shows a visibility badge so the author can see at a glance
 * which decks are committed-and-public vs author-only-private.
 *
 * Each entry links to `/admin/decks/<slug>` where the viewer mounts in
 * presenter mode (presenter window key handlers + tools auto-activate via
 * the `<PresenterModeProvider>` wrap in slice #7's `decks.$slug.tsx`).
 *
 * The "Open in IDE" button is shown only for source decks — KV decks
 * have no on-disk source file to open.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useAdminDataDeckList,
  type RegistryEntry,
} from "@/lib/decks-registry";
import { vscodeUrlForDeckSource } from "@/lib/vscode-url";
import { NewDeckModal } from "@/framework/editor/NewDeckModal";

/**
 * Inline SVG of lucide's `Code` icon — bracket-bracket arrows. We keep it
 * inline (rather than depending on `lucide-react`) so the feature ships
 * with zero new dependencies, per the issue's acceptance criteria.
 */
function CodeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

interface AdminDeckRowProps {
  entry: RegistryEntry;
  ideUrl: string;
  showIdeButton: boolean;
}

/**
 * One admin-list row. Owns the hero-image fallback state per row so a single
 * deck failing to load its thumbnail doesn't affect the others.
 *
 * Hero source priority: `meta.cover` (author-set) > `/thumbnails/<slug>/01.png`
 * (build-time auto-snap) > hidden hero strip via `onError` (graceful for
 * fresh clones with no thumbnails generated yet). Mirrors the fallback chain
 * used by `<DeckCard>` and `<OverviewTile>`.
 */
function AdminDeckRow({ entry, ideUrl, showIdeButton }: AdminDeckRowProps) {
  const { meta, visibility } = entry;
  const heroSrc = meta.cover ?? `/thumbnails/${meta.slug}/01.png`;
  const [imageFailed, setImageFailed] = useState(false);
  const showHero = !imageFailed;

  return (
    <li className="relative">
      <Link
        to={`/admin/decks/${meta.slug}`}
        className="cf-card group block overflow-hidden text-left no-underline"
      >
        {showHero && (
          <div className="aspect-[16/9] w-full overflow-hidden border-b border-cf-border bg-cf-bg-200">
            <img
              src={heroSrc}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover"
            />
          </div>
        )}
        <div className="p-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="cf-tag">
              {meta.date}
              {meta.runtimeMinutes ? ` · ${meta.runtimeMinutes} min` : ""}
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
            {meta.title}
          </p>
          {meta.description && (
            <p className="text-sm text-cf-text-muted">{meta.description}</p>
          )}
          {meta.author && (
            <p className="mt-3 text-xs text-cf-text-subtle">
              {meta.author}
              {meta.event ? ` · ${meta.event}` : ""}
            </p>
          )}
        </div>
      </Link>
      {showIdeButton && ideUrl && (
        <a
          href={ideUrl}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${meta.slug} in IDE`}
          title={`Open ${meta.slug} in IDE`}
          data-testid="open-in-ide"
          className="absolute bottom-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded border border-cf-border bg-cf-bg-100 text-cf-text-muted no-underline transition-colors hover:border-cf-text hover:text-cf-text"
        >
          <CodeIcon />
        </a>
      )}
    </li>
  );
}

export default function AdminIndex() {
  const { entries } = useAdminDataDeckList();
  const [newDeckOpen, setNewDeckOpen] = useState(false);
  // `__PROJECT_ROOT__` is injected by vite.config.ts: an absolute path in
  // dev (`command === "serve"`), the empty string in production builds.
  // We additionally gate the button render on `import.meta.env.DEV` so the
  // production bundle has no trace of the affordance even if the sentinel
  // ever leaks through.
  const projectRoot = __PROJECT_ROOT__;
  const showIdeButton = import.meta.env.DEV && projectRoot.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex items-end justify-between gap-4">
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
        <button
          type="button"
          data-interactive
          data-testid="new-deck-button"
          onClick={() => setNewDeckOpen(true)}
          className="cf-btn-primary"
        >
          New deck
        </button>
      </div>

      <NewDeckModal
        open={newDeckOpen}
        onClose={() => setNewDeckOpen(false)}
      />

      {entries.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {entries.map((entry) => {
            // KV-backed decks have no on-disk source file; only render
            // the "Open in IDE" affordance for build-time entries.
            const isSource = (entry.source ?? "source") === "source";
            const rowShowIdeButton = showIdeButton && isSource;
            const ideUrl = rowShowIdeButton
              ? vscodeUrlForDeckSource(
                  projectRoot,
                  entry.visibility,
                  entry.meta.slug,
                )
              : "";
            return (
              <AdminDeckRow
                key={entry.meta.slug}
                entry={entry}
                ideUrl={ideUrl}
                showIdeButton={rowShowIdeButton}
              />
            );
          })}
        </ul>
      )}
    </main>
  );
}
