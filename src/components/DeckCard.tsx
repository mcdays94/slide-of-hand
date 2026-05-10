/**
 * `<DeckCard>` — single card on the public deck index.
 *
 * Renders a deck's `DeckMeta` as a clickable card linking to `/decks/<slug>`.
 * The visual identity follows the design-token aesthetic: warm cream surface,
 * subtle border that turns dashed on hover (per AGENTS.md design rule), an
 * uppercase mono kicker for date / event / runtime, a medium-weight title, a
 * muted description, and small pill tags (max 3 visible).
 *
 * Optional fields are omitted entirely when absent — no empty wrappers, no
 * stale labels.
 *
 * Hero strip (16:9 image) resolution order:
 *   1. `meta.cover` — author opt-in, highest priority
 *   2. `/thumbnails/<slug>/01.png` — build-time auto-thumbnail produced by
 *      `npm run thumbnails`. See `scripts/build-thumbnails.mjs`.
 *   3. (image fails to load) — hide the hero strip entirely. The card remains
 *      a valid layout with just text content. This is the graceful fallback
 *      for fresh clones / pre-`npm run thumbnails` state.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import type { DeckMeta } from "@/framework/viewer/types";

export interface DeckCardProps {
  meta: DeckMeta;
}

const MAX_VISIBLE_TAGS = 3;

export function DeckCard({ meta }: DeckCardProps) {
  const visibleTags = meta.tags?.slice(0, MAX_VISIBLE_TAGS) ?? [];
  const hasTags = visibleTags.length > 0;

  // Compose the kicker pieces. Each piece is included only when present.
  const kickerPieces: string[] = [meta.date];
  if (meta.event) kickerPieces.push(meta.event);
  if (meta.runtimeMinutes !== undefined) {
    kickerPieces.push(`${meta.runtimeMinutes} min`);
  }

  // Hero image resolution: explicit cover wins; otherwise fall back to the
  // build-time auto-thumbnail. If THAT 404s, the `onError` handler hides
  // the hero strip entirely.
  const heroSrc = meta.cover ?? `/thumbnails/${meta.slug}/01.png`;
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <Link
      to={`/decks/${meta.slug}`}
      className="cf-card group block overflow-hidden no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cf-orange"
      data-testid="deck-card"
    >
      {!imageFailed && (
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

      <div className="flex flex-col gap-3 p-6">
        <p className="cf-tag">
          {kickerPieces.join(" · ")}
        </p>

        <h2 className="text-xl font-medium tracking-[-0.025em] text-cf-text sm:text-2xl">
          {meta.title}
        </h2>

        {meta.description && (
          <p className="text-sm text-cf-text-muted sm:text-[15px]">
            {meta.description}
          </p>
        )}

        {hasTags && (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {visibleTags.map((tag) => (
              <li
                key={tag}
                data-deck-tag
                className="rounded-full border border-cf-orange/30 bg-cf-orange/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-orange"
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Link>
  );
}
