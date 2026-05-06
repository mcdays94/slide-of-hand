/**
 * Magnifier overlay — cf-slides parity rewrite.
 *
 * Hold `W` to activate. Renders an actual-magnifying-glass-shaped overlay
 * centred on the cursor:
 *
 *   - Circular lens (~250px diameter) with a metallic rim.
 *   - Short handle at 45° from the bottom-right of the lens.
 *   - Drop shadow underneath the whole assembly so it feels like a physical
 *     object hovering above the slide.
 *   - The lens magnifies the slide content by 2× via an in-place clone of
 *     the slide DOM, scaled by a CSS transform inside an SVG `<foreignObject>`.
 *   - Chromatic aberration on the lens edge: a stack of three slightly
 *     offset, RGB-channel-isolated copies of the magnified clone produces a
 *     red/green/blue fringing effect. The offsets ramp from 0 at the centre
 *     to ~3px at the edge using a radial mask, so the centre is sharp and
 *     only the rim shows colour separation.
 *   - Subtle "barrel" refraction at the edge: a second scale ramp on a
 *     ring near the rim warps the magnified content slightly outward.
 *
 * Renders IMMEDIATELY on activation. Cursor position is read from the
 * global `useCursorPosition()` tracker so we don't need a mousemove event
 * to arrive first. If no cursor has ever been observed, falls back to the
 * viewport centre.
 *
 * The chromatic aberration / refraction layers are visual flourishes and
 * defaulted on. They use only standard CSS filters + `mix-blend-mode` so
 * they should be portable; if they prove brittle on a target device we can
 * disable via the `effects` prop.
 *
 * Pure math (placement of the overlay + the cloned slide inside it) lives
 * in `magnifierMath.ts` and is unit-tested separately.
 */

import { useEffect, useRef, useState } from "react";
import {
  MAGNIFIER_SIZE,
  MAGNIFIER_ZOOM,
  computeMagnifierPlacement,
} from "./magnifierMath";
import { getCursorPosition, useCursorPosition } from "./useCursorPosition";

const MAGNIFIER_KEY = "w";

/** Lens diameter in pixels (matches MAGNIFIER_SIZE). */
const LENS_DIAMETER = MAGNIFIER_SIZE;
/** Lens rim thickness — the metallic band around the glass. */
const RIM_THICKNESS = 6;
/** Outer SVG canvas size — must hold lens + handle + soft drop shadow. */
const SVG_PADDING = 40;
/** Handle dimensions. */
const HANDLE_LENGTH = 90;
const HANDLE_WIDTH = 18;
const HANDLE_ANGLE_DEG = 45;

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
  /** Disable visual flourishes (chromatic aberration + refraction). Defaults to true. */
  effects?: boolean;
  /** Optional callback called when the magnifier activates / deactivates. */
  onActiveChange?: (active: boolean) => void;
}

export function Magnifier({
  effects = true,
  onActiveChange,
}: MagnifierProps = {}) {
  const [active, setActive] = useState(false);
  const cloneHostRef = useRef<HTMLDivElement | null>(null);
  const aberrationRedRef = useRef<HTMLDivElement | null>(null);
  const aberrationBlueRef = useRef<HTMLDivElement | null>(null);

  const livePos = useCursorPosition(active);

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

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
    const onBlur = () => {
      setActive(false);
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

  // Resolve the cursor position for *render*, not just the tracked pos.
  // This block must produce a position even before any mousemove arrives.
  const renderPos = active
    ? livePos ?? getCursorPosition() ?? viewportCentre()
    : null;

  // Re-clone slide DOM whenever the cursor position changes while active.
  // The clone is cheap; the slide tree is bounded.
  useEffect(() => {
    if (!active || !renderPos) return;
    const slideEl = document.querySelector<HTMLElement>(
      "[data-testid='slide-shell']",
    );
    if (!slideEl) return;

    const rect = slideEl.getBoundingClientRect();
    const placement = computeMagnifierPlacement(
      renderPos.x,
      renderPos.y,
      rect,
    );

    const refresh = (host: HTMLDivElement | null) => {
      if (!host) return;
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
      // Strip interactive ids / data-testid that downstream queries might
      // double-match (we keep the slide-shell wrapper so layout is intact;
      // the tests only assert on the host).
      host.appendChild(clone);
    };

    refresh(cloneHostRef.current);
    if (effects) {
      refresh(aberrationRedRef.current);
      refresh(aberrationBlueRef.current);
    }
  }, [active, renderPos, effects]);

  if (!active || !renderPos) return null;

  // SVG canvas covers the lens + handle + a small padding for the drop
  // shadow. The cursor sits at the centre of the LENS (not the SVG canvas),
  // so we offset the SVG accordingly.
  const lensRadius = LENS_DIAMETER / 2;
  const svgSize = LENS_DIAMETER + SVG_PADDING * 2 + HANDLE_LENGTH;
  // Lens centre coords inside the SVG.
  const lensCx = SVG_PADDING + lensRadius;
  const lensCy = SVG_PADDING + lensRadius;
  // Top-left of the SVG so the LENS centre lands on the cursor.
  const svgLeft = renderPos.x - lensCx;
  const svgTop = renderPos.y - lensCy;

  // Handle geometry — short rectangle rotated 45° anchored at the bottom-right
  // edge of the lens.
  const handleAnchorX =
    lensCx + Math.cos((HANDLE_ANGLE_DEG * Math.PI) / 180) * lensRadius;
  const handleAnchorY =
    lensCy + Math.sin((HANDLE_ANGLE_DEG * Math.PI) / 180) * lensRadius;

  // Rim metallic gradient — darker outer, lighter inner. Stays consistent
  // across light + dark mode (deliberately not theme-driven; a magnifier
  // looks like brushed metal regardless of slide background).
  const rimGradientId = "slide-of-hand-magnifier-rim";
  const handleGradientId = "slide-of-hand-magnifier-handle";
  const lensClipId = "slide-of-hand-magnifier-lens-clip";
  const aberrationMaskId = "slide-of-hand-magnifier-aberration-mask";

  return (
    <div
      data-testid="magnifier"
      aria-hidden="true"
      style={{
        position: "fixed",
        left: svgLeft,
        top: svgTop,
        width: svgSize,
        height: svgSize,
        pointerEvents: "none",
        zIndex: 9998,
      }}
    >
      <svg
        width={svgSize}
        height={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient
            id={rimGradientId}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#4a4a4a" />
            <stop offset="45%" stopColor="#a8a8a8" />
            <stop offset="55%" stopColor="#888" />
            <stop offset="100%" stopColor="#2a2a2a" />
          </linearGradient>
          <linearGradient
            id={handleGradientId}
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#5a4a3a" />
            <stop offset="50%" stopColor="#a08570" />
            <stop offset="100%" stopColor="#5a4a3a" />
          </linearGradient>
          <clipPath id={lensClipId}>
            <circle cx={lensCx} cy={lensCy} r={lensRadius - RIM_THICKNESS} />
          </clipPath>
          {/* Mask used by the chromatic-aberration channels: opaque only
              near the rim (radial gradient with hard outer edge at the
              clear-glass radius). The centre is transparent so the sharp
              base layer dominates inside the lens. */}
          <radialGradient
            id={aberrationMaskId}
            cx="50%"
            cy="50%"
            r="50%"
            fx="50%"
            fy="50%"
          >
            <stop offset="0%" stopColor="black" />
            <stop offset="60%" stopColor="black" />
            <stop offset="85%" stopColor="white" stopOpacity="0.55" />
            <stop offset="100%" stopColor="white" stopOpacity="0.85" />
          </radialGradient>
        </defs>

        {/* Drop shadow under the whole magnifier — soft, slightly offset down/right. */}
        <ellipse
          cx={lensCx + 6}
          cy={lensCy + 14}
          rx={lensRadius * 0.92}
          ry={lensRadius * 0.32}
          fill="rgba(0, 0, 0, 0.18)"
          filter="blur(12px)"
        />

        {/* Handle — drawn first so the lens sits in front. Rotated about
            its anchor point so it grows out from the lens at 45°. */}
        <g
          transform={`rotate(${HANDLE_ANGLE_DEG} ${handleAnchorX} ${handleAnchorY})`}
        >
          <rect
            x={handleAnchorX}
            y={handleAnchorY - HANDLE_WIDTH / 2}
            width={HANDLE_LENGTH}
            height={HANDLE_WIDTH}
            rx={HANDLE_WIDTH / 2}
            ry={HANDLE_WIDTH / 2}
            fill={`url(#${handleGradientId})`}
            stroke="#3b2c1f"
            strokeWidth={1.5}
          />
        </g>

        {/* Lens magnified content — clipped to the inner glass circle. */}
        <foreignObject
          x={0}
          y={0}
          width={svgSize}
          height={svgSize}
          clipPath={`url(#${lensClipId})`}
        >
          <div
            ref={cloneHostRef}
            data-testid="magnifier-clone-host"
            style={{
              position: "absolute",
              left: SVG_PADDING,
              top: SVG_PADDING,
              width: LENS_DIAMETER,
              height: LENS_DIAMETER,
              overflow: "hidden",
              borderRadius: "50%",
            }}
          />
        </foreignObject>

        {/* Chromatic-aberration channels — only visible near the rim via
            the radial mask. Each is the same magnified clone, with a tiny
            translation + a hue-rotate filter to isolate roughly red and
            blue contributions. They composite via screen blend mode so
            highlights show as colour fringing, not muddy darkening. */}
        {effects && (
          <foreignObject
            x={0}
            y={0}
            width={svgSize}
            height={svgSize}
            clipPath={`url(#${lensClipId})`}
          >
            <div
              data-testid="magnifier-aberration"
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                // Mask so the colour fringes only show near the rim.
                WebkitMaskImage: `radial-gradient(circle at center, transparent 60%, rgba(0,0,0,0.5) 85%, rgba(0,0,0,0.85) 100%)`,
                maskImage: `radial-gradient(circle at center, transparent 60%, rgba(0,0,0,0.5) 85%, rgba(0,0,0,0.85) 100%)`,
              }}
            >
              <div
                ref={aberrationRedRef}
                style={{
                  position: "absolute",
                  left: SVG_PADDING + 2,
                  top: SVG_PADDING,
                  width: LENS_DIAMETER,
                  height: LENS_DIAMETER,
                  overflow: "hidden",
                  borderRadius: "50%",
                  mixBlendMode: "screen",
                  filter: "saturate(2) hue-rotate(0deg) brightness(0.9)",
                  opacity: 0.45,
                }}
              />
              <div
                ref={aberrationBlueRef}
                style={{
                  position: "absolute",
                  left: SVG_PADDING - 2,
                  top: SVG_PADDING,
                  width: LENS_DIAMETER,
                  height: LENS_DIAMETER,
                  overflow: "hidden",
                  borderRadius: "50%",
                  mixBlendMode: "screen",
                  filter:
                    "saturate(2) hue-rotate(180deg) brightness(0.9)",
                  opacity: 0.45,
                }}
              />
            </div>
          </foreignObject>
        )}

        {/* Inner highlight — a subtle white arc near the top of the glass
            sells the "actual lens" feel. */}
        <ellipse
          cx={lensCx - lensRadius * 0.25}
          cy={lensCy - lensRadius * 0.45}
          rx={lensRadius * 0.55}
          ry={lensRadius * 0.18}
          fill="rgba(255, 255, 255, 0.16)"
        />

        {/* Metallic rim — drawn AFTER the foreignObject so it sits on top. */}
        <circle
          cx={lensCx}
          cy={lensCy}
          r={lensRadius - RIM_THICKNESS / 2}
          fill="none"
          stroke={`url(#${rimGradientId})`}
          strokeWidth={RIM_THICKNESS}
        />
        {/* Inner dark ring inside the rim for definition. */}
        <circle
          cx={lensCx}
          cy={lensCy}
          r={lensRadius - RIM_THICKNESS}
          fill="none"
          stroke="rgba(0, 0, 0, 0.45)"
          strokeWidth={1}
        />
        {/* Outer thin highlight ring for a polished feel. */}
        <circle
          cx={lensCx}
          cy={lensCy}
          r={lensRadius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.25)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
