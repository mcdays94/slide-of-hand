/**
 * Magnifier overlay.
 *
 * Hold `W` to activate. A circular ~250px region centered on the cursor shows
 * a 2× magnified view of the slide. Implementation: clone the slide-shell
 * DOM into the overlay (cheap — we use `cloneNode(true)` once per
 * mouse-move, then offset/scale with CSS transform).
 *
 * For tests, the math is split out into `magnifierMath.ts`. This component
 * is a thin DOM glue over those math results.
 */

import { useEffect, useRef, useState } from "react";
import {
  MAGNIFIER_SIZE,
  MAGNIFIER_ZOOM,
  computeMagnifierPlacement,
} from "./magnifierMath";

const MAGNIFIER_KEY = "w";

interface CursorPos {
  x: number;
  y: number;
}

export function Magnifier() {
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState<CursorPos | null>(null);
  const cloneHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key.toLowerCase() !== MAGNIFIER_KEY) return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, select, textarea, [contenteditable=true], [data-interactive]",
        )
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      setActive(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== MAGNIFIER_KEY) return;
      setActive(false);
      setPos(null);
    };
    const onBlur = () => {
      setActive(false);
      setPos(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => {
      setPos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [active]);

  // Re-clone slide DOM whenever the cursor moves while active. The clone is
  // cheap; the slide tree is bounded.
  useEffect(() => {
    if (!active || !pos) return;
    const slideEl = document.querySelector<HTMLElement>(
      "[data-testid='slide-shell']",
    );
    const host = cloneHostRef.current;
    if (!slideEl || !host) return;

    const rect = slideEl.getBoundingClientRect();
    const placement = computeMagnifierPlacement(pos.x, pos.y, rect);

    // Wipe + re-insert clone. Inputs/canvases inside won't carry their
    // dynamic state, but for static slide content this is sufficient.
    host.innerHTML = "";
    const clone = slideEl.cloneNode(true) as HTMLElement;
    clone.style.position = "absolute";
    clone.style.left = `${placement.cloneOriginX}px`;
    clone.style.top = `${placement.cloneOriginY}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.transformOrigin = "0 0";
    clone.style.transform = `scale(${MAGNIFIER_ZOOM})`;
    clone.style.pointerEvents = "none";
    host.appendChild(clone);
  }, [active, pos]);

  if (!active || !pos) return null;

  // Position the overlay so the cursor sits at its center.
  const half = MAGNIFIER_SIZE / 2;
  return (
    <div
      data-testid="magnifier"
      aria-hidden="true"
      style={{
        position: "fixed",
        left: pos.x - half,
        top: pos.y - half,
        width: MAGNIFIER_SIZE,
        height: MAGNIFIER_SIZE,
        borderRadius: "50%",
        overflow: "hidden",
        boxShadow:
          "0 0 0 2px var(--color-cf-orange), 0 12px 28px rgba(0, 0, 0, 0.25)",
        pointerEvents: "none",
        zIndex: 9998,
        backgroundColor: "var(--color-cf-bg-100)",
      }}
    >
      <div
        ref={cloneHostRef}
        data-testid="magnifier-clone-host"
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
        }}
      />
    </div>
  );
}
