/**
 * Shared citation types for the framework-level `<Cite>` /
 * `<SourceFooter>` pair.
 *
 * AI-generated decks import this from a stable path:
 *
 *     import { type Source } from "@/framework/citation";
 *
 * so the schema is part of the framework's public surface. Changes
 * here also need to flow into the AI deck-gen prompt
 * (`worker/ai-deck-gen.ts`).
 */

/**
 * A single citable source rendered in the slide's bottom-band footer.
 *
 * Slide authors declare `SOURCES` as `const SOURCES: Source[] = […]`
 * inside the slide file, then pair each `<Cite n={N} />` marker with
 * the matching entry by number.
 */
export interface Source {
  /** 1-based number — matches a `<Cite n={N} />` marker in the slide body. */
  n: number;
  /**
   * Short, human-readable attribution. Keep it tight: publisher +
   * report title + year is usually enough. The full URL goes in
   * `href`.
   */
  label: string;
  /**
   * Optional public URL for the source. When set, the source entry
   * renders as an external link (`target="_blank"`, sandboxed via
   * `rel="noreferrer noopener"`); when omitted, the entry is plain
   * text — useful for non-URL references such as books, talks, or
   * internal documents.
   */
  href?: string;
}
