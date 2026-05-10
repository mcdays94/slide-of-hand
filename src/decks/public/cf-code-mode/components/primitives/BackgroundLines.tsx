import { motion } from "framer-motion";
import { backgroundFadeIn } from "../../lib/motion";

/**
 * Subtle ambient background lines (vertical dashed) that slowly fade in.
 * Apply behind cover/section slides for ambient texture.
 */
export function BackgroundLines({
  count = 6,
  opacity = 0.4,
}: {
  count?: number;
  opacity?: number;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-0 flex justify-around"
      aria-hidden="true"
      {...backgroundFadeIn}
      style={{ opacity }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="cf-dashed-line-v h-full"
          style={{ opacity: 0.55 }}
        />
      ))}
    </motion.div>
  );
}
