/**
 * Framework-level `<SourceFooter>` — bottom-of-slide source list.
 *
 * Pairs with `<Cite n={N} />` markers in the slide body: each entry
 * carries the same `n` as the marker above, plus a short label and an
 * optional href.
 *
 * Drop it in as the last child of any default-layout slide body —
 * `mt-auto` snaps it to the bottom of the available flex column, so
 * it sits just above the deck's own slide-counter footer.
 *
 * Designed to be unobtrusive: small mono type, muted colour, dashed
 * top border. The orange `[N]` token is the only visual emphasis so
 * the eye can quickly hop between marker and source.
 *
 * Issue #234. Mirrors the deck-local copies in `cf-dynamic-workers`
 * and `cf-zt-ai`; relaxed to allow `href?` so non-URL references
 * (books, talks, internal docs) can still appear in the footer band.
 */

import type { Source } from "./types";

interface SourceFooterProps {
  sources: Source[];
  /**
   * Optional extra classes — rarely needed. By default the footer
   * pins itself to the bottom of the slide column via `mt-auto` and
   * renders as a thin dashed-top band above the deck's slide-counter
   * footer.
   */
  className?: string;
}

export function SourceFooter({ sources, className }: SourceFooterProps) {
  return (
    <div
      className={[
        "mt-auto flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-dashed border-cf-border pt-3 font-mono text-[10px] leading-relaxed text-cf-text-subtle",
        className ?? "",
      ].join(" ")}
    >
      <span className="font-medium uppercase tracking-[0.12em] text-cf-text-muted">
        Sources
      </span>
      {sources.map((s) => (
        <span key={s.n} className="flex items-center gap-1.5">
          <span className="font-medium text-cf-orange/80">[{s.n}]</span>
          {s.href ? (
            <a
              href={s.href}
              target="_blank"
              rel="noreferrer noopener"
              // Click-to-advance opt-out — see `<Cite>` for the same
              // dance. Without this, clicking a source row would
              // advance the deck instead of opening the source.
              data-no-advance
              className="text-cf-text-muted underline-offset-4 transition-colors hover:text-cf-orange hover:underline"
            >
              {s.label}
            </a>
          ) : (
            <span className="text-cf-text-muted">{s.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
