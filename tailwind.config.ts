import type { Config } from "tailwindcss";

/**
 * Tailwind 4 uses CSS-first config via `@theme` in `src/styles/index.css` for
 * the design tokens. This file exists as a typed reference for editor tooling
 * and as a place to declare content paths + classic-style theme extensions if
 * we ever need them. The source of truth for token values is the CSS theme
 * block; mirror anything you change here there.
 *
 * Cloudflare Workers Design System tokens (warm cream + warm brown):
 *   --color-cf-bg-100: #FFFBF5    ← page background (never pure white)
 *   --color-cf-bg-200: #F4EFE6    ← surface / card background
 *   --color-cf-bg-300: #E8E0D2    ← subtle elevated surface
 *   --color-cf-text:   #521000    ← primary text (never pure black)
 *   --color-cf-text-muted:  #7A4A2D
 *   --color-cf-text-subtle: #A88572
 *   --color-cf-border: #E0D3BD
 *   --color-cf-orange: #FF4801
 *   --color-cf-blue:   #0A95FF
 *   --color-cf-green:  #19E306
 */
const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "cf-bg-100": "#FFFBF5",
        "cf-bg-200": "#F4EFE6",
        "cf-bg-300": "#E8E0D2",
        "cf-text": "#521000",
        "cf-text-muted": "#7A4A2D",
        "cf-text-subtle": "#A88572",
        "cf-border": "#E0D3BD",
        "cf-orange": "#FF4801",
        "cf-blue": "#0A95FF",
        "cf-green": "#19E306",
      },
    },
  },
};

export default config;
