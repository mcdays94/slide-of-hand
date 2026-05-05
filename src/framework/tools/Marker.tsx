/**
 * Freehand marker overlay.
 *
 * Press `E` to toggle marker mode on / off; `Esc` exits. A canvas covers
 * the slide and captures pointer events; mouse / pen drag draws strokes in
 * brand orange.
 *
 * Stroke auto-fade (cf-slides parity):
 *   - Each stroke is captured into an in-memory `strokes` array.
 *   - The whole canvas redraws every animation frame from this array.
 *   - When the user releases the pointer, the LATEST stroke records its
 *     `releasedAt` timestamp. Each stroke's opacity is computed from
 *     `1 - clamp((now - releasedAt - hold) / fade, 0, 1)`. With
 *     `hold = 2500ms` and `fade = 1000ms`, strokes are fully opaque for
 *     2.5s after release, then fade to 0 over 1s, then are pruned.
 *   - Drawing a new stroke RESETS the timer for ALL strokes (we clear the
 *     `releasedAt` on every existing stroke at pointer-down so a sequence
 *     of strokes doesn't fade mid-sequence).
 *
 * Drawings are also cleared when the slide changes — we observe the
 * `data-slide-index` on the slide shell and clear strokes on change.
 *
 * The canvas is wrapped in `<div data-no-advance>` so clicks on it never
 * advance the deck (Deck.tsx's click handler honors that attribute).
 */

import { useCallback, useEffect, useRef, useState } from "react";

const MARKER_KEY = "e";
const MARKER_RESOLVED_COLOR = "#FF4801";
const MARKER_WIDTH = 3;

/** Time (ms) a finished stroke stays fully opaque before it begins fading. */
export const MARKER_FADE_HOLD_MS = 2500;
/** Time (ms) over which a stroke fades from opacity 1 → 0. */
export const MARKER_FADE_DURATION_MS = 1000;

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  /** Wall-clock timestamp (ms) when the user released the pointer, or null
   *  while the stroke is still being drawn. */
  releasedAt: number | null;
}

export interface MarkerProps {
  /** Optional callback called when marker mode toggles (used by composition). */
  onActiveChange?: (active: boolean) => void;
}

/**
 * Compute a stroke's current opacity given the wall-clock time, the
 * release time, and the configured hold + fade durations. Pure; exported
 * for unit tests.
 */
export function computeStrokeOpacity(
  now: number,
  releasedAt: number | null,
  holdMs: number = MARKER_FADE_HOLD_MS,
  fadeMs: number = MARKER_FADE_DURATION_MS,
): number {
  if (releasedAt == null) return 1;
  const elapsed = now - releasedAt - holdMs;
  if (elapsed <= 0) return 1;
  if (elapsed >= fadeMs) return 0;
  return 1 - elapsed / fadeMs;
}

export function Marker({ onActiveChange }: MarkerProps = {}) {
  const [active, setActive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<boolean>(false);
  const rafRef = useRef<number | null>(null);

  // Keep external observers in sync.
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  // Toggle on `E`, exit on `Esc`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, select, textarea, [contenteditable=true], [data-interactive]",
        )
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === MARKER_KEY) {
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => !a);
      } else if (e.key === "Escape") {
        setActive((a) => {
          if (!a) return a;
          e.preventDefault();
          return false;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Resize the canvas backing store to match the slide size whenever active.
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const slideEl = document.querySelector<HTMLElement>(
      "[data-testid='slide-shell']",
    );
    const rect =
      slideEl?.getBoundingClientRect() ??
      ({
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      } as DOMRect);
    canvas.style.left = `${rect.left}px`;
    canvas.style.top = `${rect.top}px`;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = MARKER_WIDTH;
      ctx.strokeStyle = MARKER_RESOLVED_COLOR;
    }
  }, []);

  /** Clear pixel buffer (does NOT touch the strokes array). */
  const clearPixels = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  /** Redraw the entire canvas from `strokes`, applying per-stroke opacity. */
  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    clearPixels();
    const now = performance.now();
    const surviving: Stroke[] = [];
    for (const stroke of strokesRef.current) {
      const opacity = computeStrokeOpacity(now, stroke.releasedAt);
      if (opacity <= 0) continue; // prune
      surviving.push(stroke);
      if (stroke.points.length < 2) continue;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
    strokesRef.current = surviving;
  }, [clearPixels]);

  // Drive the render loop while active.
  useEffect(() => {
    if (!active) return;
    resizeCanvas();
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      redrawAll();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      window.removeEventListener("resize", onResize);
    };
  }, [active, redrawAll, resizeCanvas]);

  // Clear strokes when the visible slide index changes.
  useEffect(() => {
    if (!active) return;
    const slideEl = document.querySelector<HTMLElement>(
      "[data-testid='slide-shell']",
    );
    if (!slideEl) return;
    let lastIndex = slideEl.getAttribute("data-slide-index");
    const observer = new MutationObserver(() => {
      const current = document.querySelector<HTMLElement>(
        "[data-testid='slide-shell']",
      );
      const idx = current?.getAttribute("data-slide-index") ?? null;
      if (idx !== lastIndex) {
        lastIndex = idx;
        strokesRef.current = [];
        clearPixels();
        resizeCanvas();
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-slide-index"],
    });
    return () => observer.disconnect();
  }, [active, clearPixels, resizeCanvas]);

  // Reset strokes when the marker is deactivated.
  useEffect(() => {
    if (active) return;
    strokesRef.current = [];
    clearPixels();
  }, [active, clearPixels]);

  // Pointer handlers — bound directly to the canvas via React.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Reset the fade timer on EVERY existing stroke so a sequence of
    // strokes doesn't fade mid-sequence.
    for (const s of strokesRef.current) {
      s.releasedAt = null;
    }
    strokesRef.current.push({ points: [{ x, y }], releasedAt: null });
    drawingRef.current = true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    if (stroke) stroke.points.push({ x, y });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    // Mark all strokes as released *now* so they all start fading together
    // from this moment. (We reset releasedAt on every new pointer-down, so
    // this just stamps the freshly-finished sequence.)
    const now = performance.now();
    for (const s of strokesRef.current) {
      if (s.releasedAt == null) s.releasedAt = now;
    }
  };

  if (!active) return null;
  return (
    <div data-no-advance data-testid="marker-host">
      <canvas
        ref={canvasRef}
        data-testid="marker-canvas"
        data-marker-active="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "fixed",
          cursor: "crosshair",
          zIndex: 9997,
          backgroundColor: "transparent",
        }}
      />
    </div>
  );
}
