/**
 * `<RichTextRender>` — single source of truth for rendering markdown from
 * a `richtext` slot value.
 *
 * Used by:
 *   - `renderSlot()` in `./render.tsx` (the deck-viewer / data-slide path)
 *   - `<RichTextSlotEditor>` in `../editor/slots/RichTextSlotEditor.tsx`
 *     (the admin Studio's right-pane preview)
 *
 * Sharing the same component means the author's preview and the
 * audience-facing slide can never drift — fix or extend the renderer
 * once, and both update together. This also resolves the
 * `TODO(slice-6)` previously parked in `render.tsx` that left the deck
 * viewer rendering markdown as plain text (issue #81).
 *
 * Configuration: default `react-markdown@^9` only. No `rehype-raw`, so
 * authors cannot smuggle arbitrary HTML through the slot — sanitization
 * is `react-markdown`'s built-in escaping. Mirrors the deliberately
 * narrow config in `src/lib/manifest-merge.tsx`.
 *
 * If we later want GFM tables / strikethrough / autolinks, add
 * `remark-gfm` here and both consumers will pick it up.
 */

import ReactMarkdown from "react-markdown";

export interface RichTextRenderProps {
  /** The raw markdown source string. */
  source: string;
}

export function RichTextRender({ source }: RichTextRenderProps) {
  return <ReactMarkdown>{source}</ReactMarkdown>;
}
