import { useEffect, useRef, useState } from "react";
import { interpolateCount } from "./format";

/**
 * Animated count-up hook.
 *
 * Whenever `target` changes, smoothly tween from the current displayed
 * value to the new target over `durationMs`, with a cubic ease-out.
 * Driven by `requestAnimationFrame` so it stays GPU-friendly even with
 * a few of them on screen.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const targetRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    // No motion if tabs aren't visible / SSR.
    if (typeof window === "undefined") {
      setDisplay(target);
      return;
    }
    fromRef.current = display;
    targetRef.current = target;
    startRef.current = null;

    function step(now: number) {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = elapsed / durationMs;
      const v = interpolateCount(fromRef.current, targetRef.current, t);
      setDisplay(v);
      if (t < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      } else {
        frameRef.current = null;
      }
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}
