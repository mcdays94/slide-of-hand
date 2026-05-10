/**
 * Magnifier overlay — liquid-glass / barrel-refraction port from cf-slides.
 *
 * Hold `W` to activate. While held:
 *
 *   - **Lens**: a circular div with `backdrop-filter: url(#liquid-glass-filter)`
 *     applied. The filter (defined inline as an SVG `<filter>`) does:
 *       1. Barrel refraction via `<feDisplacementMap>` driven by a radial
 *          displacement map PNG (`/displacement-map.png`).
 *       2. Per-channel chromatic aberration (red and blue channels are
 *          displaced differently from green; recombined via `<feBlend>`),
 *          masked to the rim only via a radial alpha gradient.
 *       3. Subtle edge blur on the rim only (Gaussian blur masked to edges).
 *
 *   - **Zoom layer (z-index -1, behind the lens)**: a DOM clone of the
 *     current slide, scaled by 2.5×, positioned so the cursor's spot in the
 *     original maps to the centre of the lens. This provides actual
 *     magnification — the backdrop-filter only refracts; it doesn't zoom.
 *
 *   - **Handle**: a 45°-rotated bar emerging from the bottom-right of the
 *     lens; sized proportionally to the lens radius.
 *
 *   - **Scroll-wheel resize**: while active, mouse wheel scrolling resizes
 *     the lens radius between 60px and 260px in 10px steps. Up = bigger,
 *     down = smaller. Preserves the cursor centre.
 *
 * Activation: hold `W`. Release `W` deactivates. Window blur (alt-tab)
 * also deactivates so a stuck-active state after losing focus is
 * impossible.
 *
 * Cursor position is read from the global `useCursorPosition()` tracker
 * so the lens renders at the cursor location IMMEDIATELY on activation
 * — no need to move the mouse first. Falls back to viewport centre if
 * no cursor position has ever been observed.
 *
 * Filter ID `slide-of-hand-magnifier-liquid-glass` is unique enough to
 * coexist with any other filter on the page.
 */

import { useEffect, useRef, useState } from "react";
import { getCursorPosition, useCursorPosition } from "./useCursorPosition";
import {
  getToolScope,
  hasExplicitToolScope,
  isCursorInScope,
  normalizeCursorToScope,
} from "./useToolScope";

const MAGNIFIER_KEY = "w";
const MAGNIFIER_DEFAULT_RADIUS = 100;
const MAGNIFIER_MIN_RADIUS = 60;
const MAGNIFIER_MAX_RADIUS = 260;
const MAGNIFIER_RADIUS_STEP = 10;
const MAGNIFIER_ZOOM = 2.5;

const FILTER_ID = "slide-of-hand-magnifier-liquid-glass";

interface CursorPos {
  x: number;
  y: number;
}

function viewportCentre(): CursorPos {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2),
  };
}

export interface MagnifierProps {
  /** Optional callback called when the magnifier activates / deactivates. */
  onActiveChange?: (active: boolean) => void;
  /** BroadcastChannel slug. When set + scoping is in effect, magnifier
   *  broadcasts normalized cursor positions for audience-side mirroring. */
  slug?: string;
}

export function Magnifier({ onActiveChange, slug }: MagnifierProps = {}) {
  const [active, setActive] = useState(false);
  const [radius, setRadius] = useState(MAGNIFIER_DEFAULT_RADIUS);
  const livePos = useCursorPosition(active);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  // Open / close the broadcast channel only when slug changes.
  useEffect(() => {
    if (!slug || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(`slide-of-hand-deck-${slug}`);
    channelRef.current = ch;
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [slug]);

  // Broadcast `tool` start/stop and normalized cursor while active.
  useEffect(() => {
    try {
      channelRef.current?.postMessage({
        type: "tool",
        tool: active ? "magnifier" : null,
      });
    } catch {
      /* channel may be closed */
    }
  }, [active]);

  useEffect(() => {
    if (!active || !livePos) return;
    if (!hasExplicitToolScope()) return;
    const scope = getToolScope();
    if (!isCursorInScope(livePos, scope)) return;
    const norm = normalizeCursorToScope(livePos, scope);
    if (!norm) return;
    try {
      channelRef.current?.postMessage({
        type: "cursor",
        tool: "magnifier",
        x: norm.x,
        y: norm.y,
      });
    } catch {
      /* no listener / closed */
    }
  }, [active, livePos]);

  // ── W hold-to-activate ───────────────────────────────────────────────
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
    };
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

  // ── Scroll-wheel resize while active ────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta =
        e.deltaY < 0 ? MAGNIFIER_RADIUS_STEP : -MAGNIFIER_RADIUS_STEP;
      setRadius((prev) =>
        Math.max(
          MAGNIFIER_MIN_RADIUS,
          Math.min(MAGNIFIER_MAX_RADIUS, prev + delta),
        ),
      );
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [active]);

  if (!active) return null;

  // Item E (#111): when an explicit scope is set (e.g. inside
  // <PresenterWindow>), hide the magnifier when the cursor leaves the
  // scope. Re-entering re-shows it.
  if (hasExplicitToolScope() && !isCursorInScope(livePos, getToolScope())) {
    return null;
  }

  const pos = livePos ?? getCursorPosition() ?? viewportCentre();

  // The DOM clone needs the slide's bounding rect to position correctly
  // (so the cursor in the original maps to the lens centre when scaled).
  // Item E (#111): when scoped, clone the scope element instead of the
  // slide-shell so the magnifier shows what's under the cursor inside
  // the scoped panel.
  const slideEl =
    typeof document !== "undefined"
      ? (getToolScope() ??
        document.querySelector<HTMLElement>("[data-testid='slide-shell']"))
      : null;
  const slideRect = slideEl?.getBoundingClientRect();
  const cw = slideRect?.width ?? 0;
  const ch = slideRect?.height ?? 0;
  const slideLeft = slideRect?.left ?? 0;
  const slideTop = slideRect?.top ?? 0;

  // Cursor coordinates inside the slide's coordinate space (not viewport).
  const cursorInSlideX = pos.x - slideLeft;
  const cursorInSlideY = pos.y - slideTop;

  return (
    <>
      {/* ─── SVG liquid-glass filter (rendered once, hidden) ───────────
       * Refraction (feDisplacementMap on a radial displacement map) +
       * per-channel chromatic aberration on the rim only + edge blur. */}
      <svg
        width="0"
        height="0"
        style={{ position: "absolute" }}
        aria-hidden="true"
      >
        <defs>
          <filter
            id={FILTER_ID}
            primitiveUnits="objectBoundingBox"
            colorInterpolationFilters="sRGB"
          >
            {/* Radial displacement map — barrel refraction. */}
            <feImage
              href="/displacement-map.png"
              x="0"
              y="0"
              width="1"
              height="1"
              result="map"
            />

            {/* Radial edge mask: transparent centre → opaque edges.
                Used to confine aberration + blur to the rim only.        */}
            <feImage
              href={
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E" +
                "%3Cdefs%3E%3CradialGradient id='g'%3E" +
                "%3Cstop offset='0' stop-color='white' stop-opacity='0'/%3E" +
                "%3Cstop offset='.4' stop-color='white' stop-opacity='0'/%3E" +
                "%3Cstop offset='.78' stop-color='white' stop-opacity='1'/%3E" +
                "%3Cstop offset='1' stop-color='white' stop-opacity='1'/%3E" +
                "%3C/radialGradient%3E%3C/defs%3E" +
                "%3Crect width='256' height='256' fill='url(%23g)'/%3E%3C/svg%3E"
              }
              x="0"
              y="0"
              width="1"
              height="1"
              result="edgeMask"
            />

            {/* 1. Apply refraction to the source. */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale="0.12"
              xChannelSelector="R"
              yChannelSelector="G"
              result="refracted"
            />

            {/* 2. Per-channel chromatic aberration. Red gets less
                 displacement, blue gets more — recombine via screen blend. */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale="0.10"
              xChannelSelector="R"
              yChannelSelector="G"
              result="dispR"
            />
            <feColorMatrix
              in="dispR"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="redOnly"
            />
            <feColorMatrix
              in="refracted"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="greenOnly"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale="0.14"
              xChannelSelector="R"
              yChannelSelector="G"
              result="dispB"
            />
            <feColorMatrix
              in="dispB"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="blueOnly"
            />
            <feBlend in="redOnly" in2="greenOnly" mode="screen" result="rg" />
            <feBlend in="rg" in2="blueOnly" mode="screen" result="aberrated" />

            {/* 3. Mask aberration to edges only; keep clean refracted centre. */}
            <feComposite
              in="aberrated"
              in2="edgeMask"
              operator="in"
              result="aberratedEdges"
            />
            <feComponentTransfer in="edgeMask" result="centerMask">
              <feFuncA type="table" tableValues="1 0" />
            </feComponentTransfer>
            <feComposite
              in="refracted"
              in2="centerMask"
              operator="in"
              result="sharpCenter"
            />
            <feComposite
              in="sharpCenter"
              in2="aberratedEdges"
              operator="over"
              result="combined"
            />

            {/* 4. Subtle edge blur on top of the aberrated result. */}
            <feGaussianBlur
              in="combined"
              stdDeviation="0.010"
              result="blurred"
            />
            <feComposite
              in="blurred"
              in2="edgeMask"
              operator="in"
              result="blurryEdges"
            />
            <feComposite
              in="combined"
              in2="centerMask"
              operator="in"
              result="crispCenter"
            />
            <feComposite in="crispCenter" in2="blurryEdges" operator="over" />
          </filter>
        </defs>
      </svg>

      {/* ─── DOM clone layer (z-index -1, behind the lens) ───────────
       * Provides actual magnification: the slide is cloned, scaled 2.5×,
       * and positioned so the cursor's location in the original maps to
       * the centre of the lens. The lens above this then refracts + adds
       * chromatic aberration via backdrop-filter.                       */}
      {slideEl && (
        <div
          aria-hidden="true"
          data-testid="magnifier-zoom-layer"
          style={{
            position: "fixed",
            left: pos.x - radius,
            top: pos.y - radius,
            width: radius * 2,
            height: radius * 2,
            borderRadius: "50%",
            overflow: "hidden",
            pointerEvents: "none",
            zIndex: 9996,
          }}
        >
          <div
            style={{
              position: "absolute",
              width: cw,
              height: ch,
              left: radius - cursorInSlideX * MAGNIFIER_ZOOM,
              top: radius - cursorInSlideY * MAGNIFIER_ZOOM,
              transform: `scale(${MAGNIFIER_ZOOM})`,
              transformOrigin: "0 0",
              pointerEvents: "none",
              filter: "contrast(1.05) saturate(1.1)",
              backgroundColor: "var(--color-cf-bg-100)",
            }}
            ref={(el) => {
              if (!el) return;
              el.innerHTML = "";
              const clone = slideEl.cloneNode(true) as HTMLElement;
              clone.style.pointerEvents = "none";
              // Strip canvases (e.g. marker overlay) — they don't clone
              // their pixel buffer, leaving an empty canvas that visually
              // distracts.
              clone.querySelectorAll("canvas").forEach((c) => c.remove());
              el.appendChild(clone);
            }}
          />
        </div>
      )}

      {/* ─── Lens (backdrop-filter applies the SVG filter) ───────────
       * Refracts whatever is visible behind it (which is the zoom layer
       * above plus, if any, the rest of the page). The lens itself is a
       * thin glass — slight white background + rim/specular highlights. */}
      <div
        aria-hidden="true"
        data-testid="magnifier-lens"
        style={{
          position: "fixed",
          left: pos.x - radius,
          top: pos.y - radius,
          width: radius * 2,
          height: radius * 2,
          borderRadius: "50%",
          overflow: "hidden",
          border: "2px solid rgba(255,255,255,0.5)",
          boxShadow:
            "0 0 0 1px rgba(82,16,0,0.15), " +
            "0 8px 32px rgba(0,0,0,0.25), " +
            "0 2px 8px rgba(0,0,0,0.12)",
          backdropFilter: `url(#${FILTER_ID})`,
          WebkitBackdropFilter: `url(#${FILTER_ID})`,
          background: "rgba(255,255,255,0.04)",
          pointerEvents: "none",
          zIndex: 9997,
        }}
      >
        {/* Glass rim */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "9999px",
            pointerEvents: "none",
            background:
              "radial-gradient(circle, transparent 50%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.18) 78%, rgba(140,120,100,0.22) 90%, rgba(82,16,0,0.12) 100%)",
            boxShadow:
              "inset 0 2px 8px rgba(255,255,255,0.4), inset 0 -2px 6px rgba(0,0,0,0.15), inset 0 0 20px rgba(255,255,255,0.08)",
          }}
        />

        {/* Primary specular highlight (top-left) */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "8%",
            left: "15%",
            width: "40%",
            height: "25%",
            borderRadius: "50%",
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.15) 40%, transparent 100%)",
            transform: "rotate(-25deg)",
            filter: "blur(2px)",
            pointerEvents: "none",
          }}
        />

        {/* Secondary specular (bottom-right) */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "12%",
            right: "15%",
            width: "22%",
            height: "14%",
            borderRadius: "50%",
            background:
              "linear-gradient(315deg, rgba(255,255,255,0.2) 0%, transparent 100%)",
            transform: "rotate(15deg)",
            filter: "blur(1px)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* ─── Handle ─── */}
      <div
        aria-hidden="true"
        data-testid="magnifier-handle"
        style={{
          position: "fixed",
          left: pos.x + Math.round(radius * 0.62),
          top: pos.y + Math.round(radius * 0.62),
          width: Math.max(42, Math.round(radius * 0.58)),
          height: Math.max(10, Math.round(radius * 0.12)),
          borderRadius: "6px",
          background:
            "linear-gradient(to right, rgba(82,16,0,0.5), rgba(82,16,0,0.35))",
          transform: "rotate(45deg)",
          transformOrigin: "left center",
          boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          pointerEvents: "none",
          zIndex: 9997,
        }}
      />
    </>
  );
}
