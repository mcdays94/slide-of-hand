import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeEntrance } from "../../lib/motion";

/**
 * A massive animated number that counts up from 0 when it enters view.
 * Pair with a label below for stat-style slides.
 */
export function GiantNumber({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1.6,
  className = "",
  color = "var(--color-cf-orange)",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
  className?: string;
  color?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10%" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    let frame = 0;
    function tick(now: number) {
      const elapsed = (now - start) / 1000;
      const t = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, duration]);

  const text = display.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <motion.span
      ref={ref}
      className={[
        "block font-medium leading-[0.95] tracking-[-0.04em]",
        className,
      ].join(" ")}
      style={{ color }}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.4, ease: easeEntrance }}
    >
      {prefix}
      {text}
      {suffix}
    </motion.span>
  );
}
