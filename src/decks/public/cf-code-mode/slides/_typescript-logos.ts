/**
 * Pure data + helpers for slide 08 ("LLMs have seen a LOT of TypeScript.").
 *
 * The slide stacks two horizontal bars. The visual punchline is the
 * sheer width disparity — the top bar fills the viewport, the bottom
 * bar is a tiny sliver. Everything visual is derived from the
 * constants in this file so we can test the disparity numerically and
 * the phase-driven transforms in isolation from the React tree.
 */

export interface TsLogo {
  /** Brand name shown as a tooltip / aria-label. */
  name: string;
  /** Short monogram / wordmark used when no SVG is available. Keep ≤ 4 chars. */
  monogram: string;
  /** Brand-ish foreground colour for the monogram glyph. */
  color: string;
  /** Optional path under /logos/ — preferred over the monogram when present. */
  src?: string;
}

/**
 * The TypeScript ecosystem brand bar. A liberal mix of frameworks,
 * runtimes, build tools, ORMs and editors that anyone in the audience
 * will recognise on sight. Each entry is a small visual chip — when
 * we don't have a real SVG we fall back to a brand-coloured monogram
 * which is plenty for a 30-second backdrop.
 *
 * Ordering matters: it controls the marquee's left-to-right cadence,
 * so we deliberately scatter shapes/colours rather than grouping them.
 */
export const TYPESCRIPT_LOGOS: readonly TsLogo[] = Object.freeze([
  { name: "TypeScript", monogram: "TS", color: "#3178C6" },
  { name: "React", monogram: "Re", color: "#61DAFB" },
  { name: "Next.js", monogram: "N", color: "#111111" },
  { name: "Vite", monogram: "V", color: "#646CFF" },
  { name: "Astro", monogram: "A", color: "#FF5D01" },
  { name: "Svelte", monogram: "Sv", color: "#FF3E00" },
  { name: "Bun", monogram: "Bun", color: "#F472B6" },
  { name: "Deno", monogram: "D", color: "#000000" },
  { name: "Hono", monogram: "Ho", color: "#E36002" },
  { name: "Drizzle", monogram: "Dr", color: "#C5F74F" },
  { name: "tRPC", monogram: "tR", color: "#398CCB" },
  { name: "Prisma", monogram: "Pr", color: "#2D3748" },
  { name: "esbuild", monogram: "es", color: "#FFCF00" },
  { name: "Rollup", monogram: "Rl", color: "#EF3335" },
  { name: "Webpack", monogram: "Wp", color: "#8DD6F9" },
  { name: "Turbo", monogram: "Tu", color: "#0096FF" },
  { name: "Nx", monogram: "Nx", color: "#143055" },
  { name: "Remix", monogram: "Rx", color: "#121212" },
  { name: "VS Code", monogram: "VS", color: "#0078D4" },
  { name: "Node.js", monogram: "Nd", color: "#539E43" },
  { name: "Vercel", monogram: "▲", color: "#000000" },
  { name: "Cloudflare", monogram: "CF", color: "#F38020" },
  { name: "Workers", monogram: "Wk", color: "#F38020" },
  { name: "Vitest", monogram: "Vt", color: "#FCC72B" },
  { name: "Playwright", monogram: "Pw", color: "#2EAD33" },
  { name: "Jest", monogram: "J", color: "#C21325" },
  { name: "Angular", monogram: "Ng", color: "#DD0031" },
  { name: "Vue", monogram: "Vu", color: "#41B883" },
  { name: "Nuxt", monogram: "Nu", color: "#00DC82" },
  { name: "Solid", monogram: "So", color: "#2C4F7C" },
  { name: "Qwik", monogram: "Qw", color: "#18B6F6" },
  { name: "Zod", monogram: "Z", color: "#3068B7" },
  { name: "Effect", monogram: "Ef", color: "#000000" },
  { name: "GraphQL", monogram: "GQ", color: "#E10098" },
  { name: "ESLint", monogram: "ES", color: "#4B32C3" },
  { name: "Prettier", monogram: "Pt", color: "#56B3B4" },
]);

/**
 * Width of the bottom "synthetic tool-call training data" bar, as a
 * percentage of the top bar. Kept small but visible — under 5% — so
 * the disparity is unmistakable on stage. Don't go below 0.5% or it
 * becomes a single line of pixels at projector resolution.
 */
export const SLIVER_PERCENT = 1.4;

/** A short fragment of the kind of CSV-shaped synthetic tool-call training
 *  pair that ends up in instruction-tuning datasets. Rendered tiny inside
 *  the sliver — the audience just sees the silhouette of "data". */
export const SLIVER_SAMPLE =
  '"What is the weather in Austin?","get_weather({\\"city\\":\\"Austin\\"})"';

/**
 * buildMarqueeSequence — given a logo list and a repeat count, returns
 * a flat array of {key, logo} entries where the logos cycle around
 * the input list. Two consecutive entries are NEVER the same logo
 * (the input has no consecutive duplicates), and the sequence length
 * is always logos.length × repeats.
 *
 * The keyed wrapper lets React render the duplicated marquee row
 * without duplicate-key warnings — each repetition of the same logo
 * gets a unique key like `react#0`, `react#1`, etc.
 */
export function buildMarqueeSequence(
  logos: readonly TsLogo[],
  repeats: number,
): { key: string; logo: TsLogo }[] {
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new RangeError(
      `repeats must be a positive integer, got ${repeats}`,
    );
  }
  const out: { key: string; logo: TsLogo }[] = [];
  for (let r = 0; r < repeats; r++) {
    for (let i = 0; i < logos.length; i++) {
      const logo = logos[i];
      out.push({
        key: `${logo.name.toLowerCase().replace(/\s+/g, "-")}#${r}-${i}`,
        logo,
      });
    }
  }
  return out;
}

/**
 * computeBarTransform — the camera move on the top bar across phases.
 *
 *   phase 0 : identity (full bar visible, marquee scrolls).
 *   phase 1 : zoom into the centre of the bar by ~1.5× — the logos
 *             feel up-close + dense, like staring into the corpus.
 *   phase 2 : same zoom as phase 1, but the marquee freezes and the
 *             headline overlay is what's drawing the eye. The transform
 *             is identical so the bar stays put when the headline lands.
 */
export interface BarTransform {
  /** CSS transform value, e.g. "scale(1) translateX(0%)" */
  transform: string;
  /** Whether the marquee scroll animation should be running. */
  marqueeRunning: boolean;
  /** Headline opacity 0..1. */
  headlineOpacity: number;
}

export function computeBarTransform(phase: number): BarTransform {
  if (phase <= 0) {
    return {
      transform: "scale(1) translate3d(0%, 0%, 0)",
      marqueeRunning: true,
      headlineOpacity: 0,
    };
  }
  if (phase === 1) {
    return {
      transform: "scale(1.5) translate3d(-6%, 0%, 0)",
      marqueeRunning: true,
      headlineOpacity: 0,
    };
  }
  // phase ≥ 2 — freeze and reveal headline
  return {
    transform: "scale(1.5) translate3d(-6%, 0%, 0)",
    marqueeRunning: false,
    headlineOpacity: 1,
  };
}

/**
 * sliverWidthPercent — clamp helper that returns the sliver bar's
 * width as a CSS percentage string. Always under 5%.
 */
export function sliverWidthPercent(percent: number = SLIVER_PERCENT): string {
  const clamped = Math.max(0.5, Math.min(5, percent));
  return `${clamped}%`;
}
