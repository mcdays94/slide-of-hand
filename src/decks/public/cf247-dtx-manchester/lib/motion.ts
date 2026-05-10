/**
 * Framer Motion easing references — kept here so any per-slide
 * Framer Motion transitions in this deck can use the same curves as
 * the CSS animations declared in `styles.css`.
 *
 * The deck's animations are predominantly CSS-driven (lifted from the
 * source repo's `index.css`). Framer Motion is reserved for cases
 * where the framework requires it (slide entrance, future Reveal use).
 */
export const easeEntrance = [0.16, 1, 0.3, 1] as const;
export const easeButton = [0.25, 0.46, 0.45, 0.94] as const;
