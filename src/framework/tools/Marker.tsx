/**
 * Freehand marker overlay.
 *
 * Press `E` to toggle marker mode on / off; `Esc` exits. A canvas covers
 * the slide and captures pointer events; mouse / pen drag draws strokes in
 * brand orange.
 *
 * Drawings are cleared automatically when the slide changes — we observe
 * the `data-slide-index` on the slide shell and clear the canvas on change.
 *
 * The canvas is wrapped in `<div data-no-advance>` so clicks on it never
 * advance the deck (Deck.tsx's click handler honors that attribute).
 */

import { useCallback, useEffect, useRef, useState } from "react";

const MARKER_KEY = "e";
const MARKER_COLOR = "var(--color-cf-orange)";
const MARKER_RESOLVED_COLOR = "#FF4801";
const MARKER_WIDTH = 3;

interface DrawState {
  drawing: boolean;
  lastX: number;
  lastY: number;
}

export interface MarkerProps {
  /** Optional callback called when marker mode toggles (used by composition). */
  onActiveChange?: (active: boolean) => void;
}

export function Marker({ onActiveChange }: MarkerProps = {}) {
  const [active, setActive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<DrawState>({ drawing: false, lastX: 0, lastY: 0 });

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
  // Bail-out resize on slide swap is handled by the slide-change effect below.
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
      // CSS variables aren't readable from canvas; use the resolved value.
      ctx.strokeStyle = MARKER_RESOLVED_COLOR;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active, resizeCanvas]);

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
        clearCanvas();
        // Re-anchor the canvas to the (possibly remounted) slide.
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
  }, [active, resizeCanvas]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // setTransform is reset by clearRect-with-identity-then-restore; instead
    // multiply out by raw pixel dims.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  // Pointer handlers — bound directly to the canvas via React.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    drawRef.current = {
      drawing: true,
      lastX: e.clientX - rect.left,
      lastY: e.clientY - rect.top,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = drawRef.current;
    if (!state.drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    state.lastX = x;
    state.lastY = y;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawRef.current.drawing = false;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
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
          // Visually transparent; backed by the canvas pixel buffer.
          backgroundColor: "transparent",
          // The brand colour is read by canvas via the resolved literal;
          // expose the variable here for parity with other tools.
          color: MARKER_COLOR,
        }}
      />
    </div>
  );
}
