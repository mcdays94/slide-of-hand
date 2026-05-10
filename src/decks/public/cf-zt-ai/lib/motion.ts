/**
 * Framer Motion presets — direct port of the design system's motion DNA.
 * Source: cf-workers-design system § 7.5 + § 15.5 (Animation Physics).
 *
 * Usage:
 *   import { motion } from "framer-motion";
 *   import { sectionSlideUp } from "@/lib/motion";
 *   <motion.div {...sectionSlideUp} />
 */
import type { Variants } from "framer-motion";

/** Apple-style smooth deceleration for page entrances. */
export const easeEntrance = [0.16, 1, 0.3, 1] as const;
/** High-end button feel. */
export const easeButton = [0.25, 0.46, 0.45, 0.94] as const;
/** Active / press response. */
export const easeActive = [0.55, 0.085, 0.68, 0.53] as const;
/** Standard ease-out (Tailwind default). */
export const easeStandard = [0, 0, 0.2, 1] as const;

/** Page entrance — opacity 0 → 1 over 0.5s with easeEntrance. */
export const pageEntrance = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.5, ease: easeEntrance },
  },
};

/** Section slide-up — fade + 20px translate. */
export const sectionSlideUp = {
  initial: { opacity: 0, y: 20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: easeButton },
  },
};

/** Stagger container — orchestrates child reveals on a 80ms cadence. */
export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

/** Stagger child — pair with staggerContainer. */
export const staggerItem: Variants = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: easeButton },
  },
};

/** Card hover — gentle 1.01 scale. */
export const cardHover = {
  whileHover: {
    scale: 1.01,
    transition: { duration: 0.2, ease: easeButton },
  },
  whileTap: { scale: 0.99 },
};

/** Button interaction (primary/ghost). */
export const buttonInteraction = {
  whileHover: { scale: 1.01 },
  whileTap: {
    scale: 0.98,
    y: 1,
    transition: { duration: 0.16, ease: easeActive },
  },
};

/** Slow background fade-in (used for ambient layers). */
export const backgroundFadeIn = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 2, delay: 0.1, ease: easeStandard },
  },
};

/** Slide transition — when the deck advances. */
export const slideTransition = {
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: easeEntrance },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.25, ease: easeButton },
  },
};
