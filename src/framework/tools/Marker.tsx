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

/**
 * Time (ms) a finished stroke stays fully opaque before it begins fading.
 *
 * Originally 2500ms; reduced to 500ms in #34 after user feedback that
 * "the marker still doesn't go away after releasing" — the original
 * 3.5s total visibility (2500ms hold + 1000ms fade) felt unresponsive.
 * 500ms hold gives a brief "you drew that" moment before the fade
 * begins. Tunable via the future settings modal (#32).
 */
export const MARKER_FADE_HOLD_MS = 500;
/**
 * Time (ms) over which a stroke fades from opacity 1 → 0.
 *
 * Reduced from 1000ms to 500ms in #34 — total visibility window is now
 * 500ms hold + 500ms fade = 1s, matching the "release and it's gone"
 * expectation while keeping the fade smooth (not a pop).
 */
export const MARKER_FADE_DURATION_MS = 500;

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
  // `active` = E key currently held. Strokes are live (releasedAt === null)
  // while active is true. When E is released, all strokes' releasedAt is
  // stamped, and the canvas stays mounted long enough for the fade to
  // complete (see `mounted` below).
  const [active, setActive] = useState(false);
  // `mounted` controls whether the canvas DOM element is rendered at all.
  // It's true while `active`, AND continues to be true for the post-release
  // fade window so strokes fade out smoothly. Goes back to false after the
  // unmount timer fires (see the `active`-tracking effect below).
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<boolean>(false);
  const rafRef = useRef<number | null>(null);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep external observers in sync.
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  // Hold-to-draw: E key held → mode active; release E → strokes fade.
  // Esc immediately deactivates as a safety hatch.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
        if (e.repeat) return; // ignore key-repeat while held
        e.preventDefault();
        e.stopPropagation();
        setActive(true);
      } else if (e.key === "Escape") {
        setActive((a) => {
          if (!a) return a;
          e.preventDefault();
          return false;
        });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === MARKER_KEY) {
        setActive(false);
      }
    };
    // If the window loses focus while E is held (alt-tab, etc.), treat that
    // like a key-up — otherwise the user releases the focused-elsewhere E
    // and we'd never get a keyup event to clear active state.
    const onBlur = () => setActive(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
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

  // ── Mount lifecycle ─────────────────────────────────────────────────
  // While E is held, the canvas is mounted and strokes stay opaque
  // (releasedAt = null). When E is released, all live strokes get their
  // releasedAt timestamp stamped — strokes then fade per
  // computeStrokeOpacity. The canvas stays mounted long enough for the
  // fade to complete (hold + fade + 100ms safety buffer), then unmounts.
  // Pressing E again before the unmount timer fires cancels it: existing
  // strokes are restored to opaque (releasedAt = null) so the user can
  // continue their drawing.
  useEffect(() => {
    if (active) {
      // Activated: cancel any pending unmount, restore strokes to opaque.
      if (unmountTimerRef.current != null) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
      for (const s of strokesRef.current) s.releasedAt = null;
      setMounted(true);
      return;
    }
    // Deactivated: stamp releasedAt on all strokes that don't have it.
    drawingRef.current = false;
    const now = performance.now();
    for (const s of strokesRef.current) {
      if (s.releasedAt == null) s.releasedAt = now;
    }
    // Schedule the canvas unmount after the fade window completes. Add a
    // small safety buffer so the rAF tick has a chance to render the final
    // opacity-0 frame before the canvas disappears.
    if (unmountTimerRef.current != null) {
      clearTimeout(unmountTimerRef.current);
    }
    unmountTimerRef.current = setTimeout(() => {
      strokesRef.current = [];
      setMounted(false);
      unmountTimerRef.current = null;
    }, MARKER_FADE_HOLD_MS + MARKER_FADE_DURATION_MS + 100);
  }, [active]);

  // Drive the render loop while the canvas is mounted (active OR fading).
  useEffect(() => {
    if (!mounted) return;
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
  }, [mounted, redrawAll, resizeCanvas]);

  // Clear strokes when the visible slide index changes (only while active —
  // strokes from the previous slide should not stick around on a new slide).
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

  // On unmount of the component itself, clean up the unmount timer so the
  // setTimeout doesn't fire after the component has been torn down.
  useEffect(() => {
    return () => {
      if (unmountTimerRef.current != null) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
    };
  }, []);

  // Pointer handlers — bound directly to the canvas via React. Drawing
  // is gated on `active` (E currently held). The canvas may still be
  // mounted (post-release fade) but pointer-down should not start a new
  // stroke once E is released.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Existing strokes are already opaque (releasedAt = null) while active
    // is true — see the active-tracking effect. Just append a new stroke.
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
    // NOTE: we deliberately do NOT stamp releasedAt here. With the
    // hold-to-draw model, strokes only fade when E itself is released;
    // pointer-up just ends the current stroke without starting its fade.
    // The active-tracking effect handles the stamp on E-up.
  };

  if (!mounted) return null;
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
