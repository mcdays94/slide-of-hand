/**
 * 17 — Thank you. (Closer)
 *
 * The closing slide has been merged into 16 (`closingSlide`) per
 * QA round 3 — one big-card slide instead of two.
 *
 * This file is kept as a thin re-export so any stale imports of
 * `thanksSlide` still resolve to the merged slide. The deck registry
 * (`src/lib/slides.tsx`) no longer references it directly.
 */
export { closingSlide as thanksSlide } from "./16-try-it-now";
