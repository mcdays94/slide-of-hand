/**
 * DECK_DARK_THEME — Prism theme used for every code block in the deck.
 *
 * Tuned for high contrast on the deck's near-black code surface
 * (`#1c1b19`). Every plausible token type is overridden so plain
 * identifiers — variable names, parameter names, function calls, JSX
 * attribute names — never fall through to the surrounding `text-cf-text`
 * (warm dark brown), which would render as nearly-invisible dark red on
 * black. That fall-through bug is exactly what we hit before this file
 * existed.
 *
 * Palette:
 *   #fffbf5   warm cream, identifier base
 *   #fde9b8   sandy yellow, strings / attr-values
 *   #ffd4a3   muted orange, parameters / properties
 *   #ffb38a   soft orange, numbers / functions
 *   #ff7849   brand-orange, keywords
 *   #9c8a72   muted brown, punctuation
 *   #7a6f60   dim brown, comments
 */

import { themes, type PrismTheme } from "prism-react-renderer";

export const DECK_DARK_THEME: PrismTheme = {
  ...themes.vsDark,
  // `plain` is the inline style Prism's <Highlight> render prop hands us
  // for the <pre>. We MUST destructure & apply `style` from the render
  // prop or this falls back to the parent's `color`. See
  // SyntaxHighlightedCodeBlock helpers below.
  plain: {
    color: "#fffbf5",
    backgroundColor: "transparent",
  },
  styles: [
    {
      types: ["comment", "prolog", "doctype", "cdata"],
      style: { color: "#7a6f60", fontStyle: "italic" },
    },
    { types: ["punctuation"], style: { color: "#9c8a72" } },
    {
      // Object-literal keys (`mainModule:`, `modules:`), JSX tag names,
      // booleans, numbers, constants, symbols.
      types: ["property", "tag", "boolean", "number", "constant", "symbol"],
      style: { color: "#ffd4a3" },
    },
    {
      // String literals (`"code.js"`, `"LOADER"`, etc.).
      types: ["selector", "attr-name", "string", "char", "builtin"],
      style: { color: "#fde9b8" },
    },
    {
      types: ["operator", "entity", "url"],
      style: { color: "#fff7ea" },
    },
    {
      // `const`, `let`, `return`, `await`, `import`, etc.
      types: ["atrule", "attr-value", "keyword"],
      style: { color: "#ff7849", fontWeight: "500" },
    },
    {
      // Function calls — `load(`, `fetch(`, `getEntrypoint(`.
      types: ["function"],
      style: { color: "#ffb38a", fontWeight: "500" },
    },
    {
      types: ["class-name"],
      style: { color: "#fff7ea", fontWeight: "500" },
    },
    {
      // Bare identifiers — variable names, function references not
      // followed by `(`. Prism uses this for things like `worker`,
      // `userCode`, `request`, parameter names. Without an explicit
      // override these inherit the parent's `color` (warm dark brown
      // `#521000`) and become unreadable on black.
      types: [
        "regex",
        "important",
        "variable",
        "parameter",
        "imports",
        "maybe-class-name",
        "literal-property",
      ],
      style: { color: "#ffe7c8" },
    },
    {
      // Method invocation receivers (`env.LOADER`, `worker.getEntrypoint`).
      types: ["method"],
      style: { color: "#ffd4a3" },
    },
    {
      types: ["italic"],
      style: { fontStyle: "italic" },
    },
  ],
};
