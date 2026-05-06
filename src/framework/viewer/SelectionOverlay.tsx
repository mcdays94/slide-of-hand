/**
 * `<SelectionOverlay>` — pure-DOM positioning layer that paints a 1px
 * dashed orange outline around the currently-inspected element plus a
 * tag+class badge in the upper-left.
 *
 * Lives outside the slide subtree so it never participates in the
 * inspector's own selector computation. Uses `position: fixed` with
 * computed `top/left/width/height` from the target's
 * `getBoundingClientRect()`. We re-poll the rect on every animation
 * frame while mounted — cheap (~one rect read + one style write per
 * frame) and dead simple, which avoids the "what if the element moves
 * mid-animation" problem that a `ResizeObserver`-only solution would
 * miss (RO doesn't fire for translate-only transforms).
 *
 * Per AGENTS.md: no inline hex, brand orange via Tailwind class
 * (`border-cf-orange`). 1px dashed border matches the SoH hover idiom.
 */

import { useEffect, useRef, useState } from "react";

export interface SelectionOverlayProps {
  /** The target element to highlight. `null` hides the overlay. */
  target: Element | null;
  /** Badge label, e.g. `"H1.text-cf-orange"`. */
  label: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function readRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function rectsEqual(a: Rect, b: Rect): boolean {
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  );
}

export function SelectionOverlay({ target, label }: SelectionOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(() =>
    target ? readRect(target) : null,
  );
  const rafRef = useRef<number | null>(null);
  const lastRectRef = useRef<Rect | null>(null);

  useEffect(() => {
    if (!target) {
      setRect(null);
      lastRectRef.current = null;
      return;
    }

    // Seed immediately so the first paint already shows the box.
    const seed = readRect(target);
    lastRectRef.current = seed;
    setRect(seed);

    // requestAnimationFrame loop — re-reads the bounding rect each frame
    // and only commits to React state when the values actually change.
    // happy-dom's `requestAnimationFrame` shim runs synchronously, so this
    // also works in tests without faking timers.
    const tick = () => {
      const next = readRect(target);
      const last = lastRectRef.current;
      if (!last || !rectsEqual(last, next)) {
        lastRectRef.current = next;
        setRect(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target]);

  if (!target || !rect) return null;

  return (
    <div
      data-testid="selection-overlay"
      data-no-advance
      aria-hidden="true"
      className="pointer-events-none fixed z-40 border border-dashed border-cf-orange"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
    >
      <span
        data-testid="selection-overlay-badge"
        className="absolute -top-5 left-0 inline-block bg-cf-orange px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-cf-bg-100"
      >
        {label}
      </span>
    </div>
  );
}
