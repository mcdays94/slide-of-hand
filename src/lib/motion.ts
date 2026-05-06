/**
 * Motion primitives — easings + presets.
 *
 * Every animation in Slide of Hand MUST source its timing from this module.
 * Inline cubic-bezier values (`transition={{ ease: [0.25, 0.46, ...] }}`) are
 * an anti-pattern: they fragment the design system and make systemic tweaks
 * impossible. See AGENTS.md § Anti-patterns.
 *
 * The eases below are tuned by feel against the Cloudflare Workers Design
 * System aesthetic — restrained, never bouncy, never jelly-spring.
 */

import type { Transition } from "framer-motion";

// ────────────────────────────────────────────────────────────────────────────
// Easings — cubic-bezier control points.
// ────────────────────────────────────────────────────────────────────────────

/** Entrance ease — material-style "out" curve for things appearing on screen. */
export const easeEntrance = [0.16, 1, 0.3, 1] as const;

/** Button ease — quick out/in for press affordances. */
export const easeButton = [0.32, 0, 0.67, 0] as const;

/** Active ease — symmetric in-out for ongoing animations. */
export const easeActive = [0.65, 0, 0.35, 1] as const;

/** Standard ease — sane default for general-purpose transitions. */
export const easeStandard = [0.4, 0, 0.2, 1] as const;

// ────────────────────────────────────────────────────────────────────────────
// Presets — full Transition / Variant objects ready to spread.
// ────────────────────────────────────────────────────────────────────────────

/** Page entrance — fade + tiny lift. Slide containers, route transitions. */
export const pageEntrance: Transition = {
  duration: 0.5,
  ease: easeEntrance,
};

/** Section slide-up — heavier lift for hero sections / kickers. */
export const sectionSlideUp: Transition = {
  duration: 0.7,
  ease: easeEntrance,
};

/** Stagger container — orchestrates child variants (cards, list items). */
export const staggerContainer = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
} as const;

/** Stagger child — fade + lift, used inside `staggerContainer`. */
export const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: easeEntrance },
  },
} as const;

/** Card hover — subtle lift / border tweak. Hover is dashed-border in the brand. */
export const cardHover: Transition = {
  duration: 0.18,
  ease: easeStandard,
};

/** Slide transition — used by the viewer when stepping between slides. */
export const slideTransition: Transition = {
  duration: 0.35,
  ease: easeStandard,
};
