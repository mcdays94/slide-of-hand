/**
 * Laser pointer overlay.
 *
 * Hold `Q` to activate. A 12px brand-orange dot follows the cursor. Releasing
 * `Q` (or losing focus) hides it.
 *
 * The overlay reads cursor position from the global `useCursorPosition()`
 * tracker so it renders IMMEDIATELY on activation — no requirement for the
 * user to wiggle the mouse first. If the tracker has never observed a
 * pointer event (e.g. fresh tab, keyboard-only navigation) we fall back to
 * the viewport centre on first activation.
 *
 * The overlay is a fixed-position div on top of the deck. It uses
 * `pointer-events: none` so click-to-advance still fires.
 *
 * Best-effort BroadcastChannel sends — slice #5 wires up a presenter-window
 * listener; in the meantime the channel is a no-op. We send the cursor
 * position relative to the slide-shell so the listener can map it back to
 * its own viewport size.
 */

import { useEffect, useRef, useState } from "react";
import { getCursorPosition, useCursorPosition } from "./useCursorPosition";

const LASER_KEY = "q";
const LASER_SIZE = 12;

export interface LaserProps {
  /** BroadcastChannel slug. We send `{ type: "tool", tool: "laser" }` + cursor pings. */
  slug?: string;
  /** Optional callback called when the laser activates / deactivates. */
  onActiveChange?: (active: boolean) => void;
}

function viewportCentre(): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2),
  };
}

export function Laser({ slug, onActiveChange }: LaserProps) {
  const [active, setActive] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Subscribe to cursor moves so the dot follows the cursor while active.
  const livePos = useCursorPosition(active);

  // Open / close channel only when slug changes.
  useEffect(() => {
    if (!slug || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(`reaction-deck-${slug}`);
    channelRef.current = ch;
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [slug]);

  // Notify external observers of active state changes.
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key.toLowerCase() !== LASER_KEY) return;
      // Don't steal keys from form fields.
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
      try {
        channelRef.current?.postMessage({ type: "tool", tool: "laser" });
      } catch {
        /* channel may be closed */
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== LASER_KEY) return;
      setActive(false);
      try {
        channelRef.current?.postMessage({ type: "tool", tool: null });
      } catch {
        /* channel may be closed */
      }
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

  // Best-effort cursor broadcast for the presenter window.
  useEffect(() => {
    if (!active || !livePos) return;
    try {
      channelRef.current?.postMessage({
        type: "tool-cursor",
        tool: "laser",
        x: livePos.x,
        y: livePos.y,
      });
    } catch {
      /* no listener / closed */
    }
  }, [active, livePos]);

  if (!active) return null;

  // Resolve render position. Prefer the live tracked cursor; if the tracker
  // has never observed an event, fall back to a viewport-centre guess so the
  // dot still renders immediately.
  const pos = livePos ?? getCursorPosition() ?? viewportCentre();
  return (
    <div
      data-testid="laser-dot"
      aria-hidden="true"
      style={{
        position: "fixed",
        left: pos.x - LASER_SIZE / 2,
        top: pos.y - LASER_SIZE / 2,
        width: LASER_SIZE,
        height: LASER_SIZE,
        borderRadius: "50%",
        backgroundColor: "var(--color-cf-orange)",
        boxShadow:
          "0 0 12px 4px rgba(255, 72, 1, 0.55), 0 0 2px 1px rgba(255, 255, 255, 0.6) inset",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}
