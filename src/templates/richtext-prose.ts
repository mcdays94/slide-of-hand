/**
 * Shared Tailwind className string for containers that render
 * `richtext` slot output (i.e. wrap a `<RichTextRender>` from
 * `src/framework/templates/RichTextRender.tsx`).
 *
 * Why this exists: Tailwind's preflight zeroes `list-style` on
 * `<ul>`/`<ol>` and strips paragraph margins, so the correct DOM
 * react-markdown emits would otherwise render as flush, unstyled
 * text on the public viewer. This string restores list bullets,
 * paragraph spacing, emphasis, inline code, and link styling
 * harmonised with the warm cream/brown design tokens
 * (see `src/styles/index.css`'s `@theme` block).
 *
 * Used by:
 *   - `default/index.tsx`        (body slot)
 *   - `big-stat/index.tsx`       (context slot)
 *   - `quote/index.tsx`          (quote slot)
 *   - `two-column/index.tsx`     (left + right slots)
 *
 * The deliberate constraint: `<RichTextRender>` itself stays
 * theming-agnostic per #81's design contract — *containers* that
 * render richtext apply prose styling, not the renderer. This
 * matches the inline-arbitrary-variant pattern already established
 * by `src/templates/list/index.tsx`.
 *
 * Notes on individual rules:
 *   - `marker:text-cf-orange` — bullets pick up the brand accent,
 *     mirroring `src/templates/list/index.tsx`.
 *   - `[&_strong]:font-medium` — AGENTS.md mandates medium weight
 *     for emphasis (never bold).
 *   - `[&_p:last-child]:mb-0` — prevents trailing whitespace under
 *     the final paragraph in a flex/gap parent.
 *   - `[&_code]` — inline code only; fenced blocks are routed
 *     through the `code` slot kind (Shiki-highlighted).
 */
export const richtextProseClasses = [
  // Lists (restore preflight-zeroed list-style)
  "[&_ul]:list-disc",
  "[&_ul]:pl-6",
  "[&_ul]:space-y-1",
  "[&_ol]:list-decimal",
  "[&_ol]:pl-6",
  "[&_ol]:space-y-1",
  "[&_li]:marker:text-cf-orange",
  // Inter-block spacing — every block emitted by react-markdown
  // (paragraphs, lists) gets a top margin, separating it from its
  // previous block sibling. We then ZERO the margin on the very
  // first child via `>:first-child:mt-0` so the prose container
  // doesn't get an unwanted leading gap. This pattern (vs.
  // bottom-margin + `:last-child:mb-0`) is robust when the
  // richtext content lives next to decorative wrapper siblings —
  // e.g. the quote template's <blockquote> with leading/trailing
  // quote-mark <span>s — because we never spuriously space the
  // wrapper content away from the prose.
  "[&_p]:mt-3",
  "[&_ul]:mt-3",
  "[&_ol]:mt-3",
  "[&>:first-child]:mt-0",
  // Emphasis (medium weight, never bold)
  "[&_strong]:font-medium",
  "[&_strong]:text-cf-text",
  "[&_em]:italic",
  // Inline code
  "[&_code]:font-mono",
  "[&_code]:text-[0.9em]",
  "[&_code]:rounded",
  "[&_code]:bg-cf-bg-200",
  "[&_code]:px-1",
  "[&_code]:py-0.5",
  "[&_code]:text-cf-text",
  // Links
  "[&_a]:text-cf-orange",
  "[&_a]:underline",
  "[&_a:hover]:no-underline",
].join(" ");
