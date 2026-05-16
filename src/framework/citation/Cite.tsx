/**
 * Framework-level `<Cite>` — inline citation marker.
 *
 * Renders a small superscript `[N]` next to a claim. Pairs with
 * `<SourceFooter sources={…} />` at the bottom of the same slide:
 * the `n` here matches one of the source entries down there.
 *
 * The visual style mirrors the deck-local copies that already shipped
 * in `cf-dynamic-workers` and `cf-zt-ai` so existing decks can be
 * migrated incrementally without a re-design. Live at this stable
 * path so AI-generated decks can rely on the import (issue #234).
 *
 * Usage:
 *
 *     <p>92% of UK enterprises use AI<Cite n={1} href="https://…" /></p>
 *
 *     <Cite n={2} />  // marker only; URL lives in SourceFooter
 */

interface CiteProps {
  /** 1-based source number — matches a Source entry in the slide's SourceFooter. */
  n: number;
  /**
   * Optional URL. When set the marker is a real link that opens the
   * source in a new tab (with `rel="noreferrer noopener"` so the
   * source page can't reach back into our app). When omitted the
   * marker is purely visual — the source URL lives only in the
   * SourceFooter at the bottom of the slide.
   */
  href?: string;
}

export function Cite({ n, href }: CiteProps) {
  // Subtle brand-orange so the marker reads as "this claim has a
  // citation" without distracting from the claim itself. The mono
  // numerals match the rest of the deck's citation styling.
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
          // Click-to-advance is wired on the slide surface;
          // `data-no-advance` opts this anchor out so a click opens
          // the source instead of advancing the deck.
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
