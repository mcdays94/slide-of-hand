/**
 * Curated catalog of Tailwind classes the inspector (#14, slice 3)
 * offers for swap-on-the-fly during a presentation.
 *
 * This is intentionally NOT an exhaustive enumeration of Tailwind
 * utilities. The inspector's UX is "click an element → pick a different
 * brand-aligned token from a small palette," so the catalog is
 * scoped to the SoH design language already in use across the
 * codebase (`text-cf-orange`, `bg-cf-bg-100`, etc.) plus a small set
 * of generic typography / spacing / sizing tokens that an author would
 * realistically reach for mid-talk.
 *
 * Token discipline mirrors AGENTS.md § Anti-patterns:
 *  - Never literal hex — only Tailwind class tokens.
 *  - No `*-white` / `*-black` — those live on the wrong end of the
 *    contrast scale for the SoH palette.
 *  - No bold weight on text tokens — medium is the brand.
 *
 * The values below MUST stay in sync with the `@theme` block in
 * `src/styles/index.css`. If you add a `--color-cf-*` token there,
 * mirror it here. The tests in `tailwind-tokens.test.ts` spot-check
 * that key tokens are present.
 */

export type TokenCategory =
  | "color"
  | "background"
  | "typography"
  | "spacing"
  | "border"
  | "sizing";

export interface TokenGroup {
  /** Coarse bucket for grouping in the picker UI. */
  category: TokenCategory;
  /** Human-readable group name (e.g. "Text color"). */
  label: string;
  /** Tailwind classes belonging to this group. Each is a single class
   *  (no whitespace, no compound stacks). */
  classNames: string[];
  /** Tooltip copy for the picker — explains what this category mutates. */
  description: string;
}

export const TAILWIND_TOKENS: TokenGroup[] = [
  // ── Text color (foreground) ────────────────────────────────────────
  // Sourced from the `@theme` block in src/styles/index.css. Includes
  // the warm-brown text scale, the brand orange (used sparingly for
  // emphasis), and the semantic accents (success / warning / danger)
  // for status-style text.
  {
    category: "color",
    label: "Text color",
    description:
      "Foreground color. Drawn from the SoH warm-brown text scale plus the brand accents.",
    classNames: [
      "text-cf-text",
      "text-cf-text-muted",
      "text-cf-text-subtle",
      "text-cf-orange",
      "text-cf-blue",
      "text-cf-success",
      "text-cf-warning",
      "text-cf-danger",
    ],
  },

  // ── Background color ───────────────────────────────────────────────
  // The three warm-cream surface tones plus orange / border for
  // accent fills (e.g. callouts, kicker chips).
  {
    category: "background",
    label: "Background color",
    description:
      "Surface fill. Use the warm-cream scale for blocks; brand orange or borders for accents.",
    classNames: [
      "bg-cf-bg-100",
      "bg-cf-bg-200",
      "bg-cf-bg-300",
      "bg-cf-border",
      "bg-cf-orange",
      "bg-cf-success",
      "bg-cf-warning",
      "bg-cf-danger",
    ],
  },

  // ── Typography ─────────────────────────────────────────────────────
  // Type scale tokens already in use across decks (see grep output:
  // text-{sm,base,lg,xl,2xl,…,7xl}). Plus the two SoH-brand font
  // families (`font-mono` for kickers, `font-medium` for headings —
  // never bold, see AGENTS.md § Anti-patterns).
  {
    category: "typography",
    label: "Typography",
    description:
      "Type scale + weight + family. SoH uses medium weight on headings — never bold.",
    classNames: [
      "text-sm",
      "text-base",
      "text-lg",
      "text-xl",
      "text-2xl",
      "text-4xl",
      "text-6xl",
      "text-8xl",
      "font-medium",
      "font-mono",
    ],
  },

  // ── Spacing ────────────────────────────────────────────────────────
  // Representative subset — not every Tailwind step. The inspector is
  // for "nudge a value" mid-talk, not for arbitrary layout work; a
  // small picker beats a giant one.
  {
    category: "spacing",
    label: "Spacing",
    description:
      "Padding, margin, and gap. A representative subset — exhaustive scales would overwhelm the picker.",
    classNames: [
      "p-2",
      "p-4",
      "p-8",
      "m-4",
      "mt-8",
      "gap-2",
      "gap-4",
      "gap-8",
    ],
  },

  // ── Border ─────────────────────────────────────────────────────────
  // SoH brand: hover affordance is a dashed border, not a glow.
  // Includes the corner-radius tokens used across cards (`rounded-md`,
  // `rounded-full` for pills) and the brand border colors.
  {
    category: "border",
    label: "Border",
    description:
      "Outline + radius. SoH hover affordance is dashed border, not glow.",
    classNames: [
      "border",
      "border-cf-border",
      "border-cf-orange",
      "border-dashed",
      "rounded-md",
      "rounded-full",
    ],
  },

  // ── Sizing ─────────────────────────────────────────────────────────
  // Block-level width / height tokens authors reach for to constrain a
  // headline column or stretch a hero block.
  {
    category: "sizing",
    label: "Sizing",
    description:
      "Width and height constraints. Use sparingly — slides usually flow from layout primitives.",
    classNames: [
      "w-full",
      "max-w-md",
      "max-w-2xl",
      "max-w-4xl",
      "h-full",
    ],
  },
];
