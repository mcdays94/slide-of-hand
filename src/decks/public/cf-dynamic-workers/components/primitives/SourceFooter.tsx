export interface Source {
  /** 1-based number — matches a `<Cite n={N} />` marker in the slide body. */
  n: number;
  /**
   * Short, human-readable attribution. Keep it tight: publisher + report
   * title + year is usually enough. The full URL goes in `href`.
   */
  label: string;
  /** Public URL for the source. Opens in a new tab. */
  href: string;
}

interface SourceFooterProps {
  sources: Source[];
  /**
   * Optional extra classes — rarely needed. By default the footer pins
   * itself to the bottom of the slide column via `mt-auto` and renders
   * as a thin dashed-top band above the deck's slide-counter footer.
   */
  className?: string;
}

/**
 * Renders the source citations as a thin footer band at the bottom of a
 * slide. Drop it in as the last child of any default-layout slide body
 * — `mt-auto` snaps it to the bottom of the available flex column, so it
 * sits just above the deck's own slide-counter footer.
 *
 * Pair every entry here with a `<Cite n={N} />` marker next to the
 * matching claim above. The marker tells readers "there's a source for
 * this"; this footer tells them what the source is and how to open it.
 *
 * Designed to be unobtrusive: small mono type, muted colour, dashed
 * top border. The orange `[N]` token is the only visual emphasis so the
 * eye can quickly hop between marker and source.
 */
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
          <a
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
            data-no-advance
            className="text-cf-text-muted underline-offset-4 transition-colors hover:text-cf-orange hover:underline"
          >
            {s.label}
          </a>
        </span>
      ))}
    </div>
  );
}
