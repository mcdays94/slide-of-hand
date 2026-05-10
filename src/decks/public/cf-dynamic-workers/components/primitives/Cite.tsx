interface CiteProps {
  /** 1-based source number — matches a Source entry in the slide's SourceFooter. */
  n: number;
  /**
   * Optional URL. When set the marker is a real link that opens the source
   * in a new tab. When omitted the marker is purely visual (the source URL
   * lives only in the SourceFooter at the bottom of the slide).
   */
  href?: string;
}

/**
 * Inline citation marker — a small superscript `[N]` rendered next to a
 * claim. Designed to pair with `<SourceFooter sources=[…] />` at the
 * bottom of the slide; the `n` here matches one of the source entries
 * down there.
 *
 * The marker is brand-orange (slightly muted) so it reads as "this claim
 * has a citation" without distracting from the claim itself.
 *
 * Usage:
 *   <p>92% of UK enterprises use AI<Cite n={1} href="https://…" /></p>
 */
export function Cite({ n, href }: CiteProps) {
  const cls =
    "ml-0.5 font-mono text-[0.65em] font-medium text-cf-orange/80 transition-colors hover:text-cf-orange";
  const text = `[${n}]`;
  return (
    <sup>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className={cls}
          data-no-advance
        >
          {text}
        </a>
      ) : (
        <span className={cls}>{text}</span>
      )}
    </sup>
  );
}
