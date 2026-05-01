/**
 * Laser pointer overlay.
 *
 * Hold `Q` to activate. A 12px brand-orange dot follows the cursor. Releasing
 * `Q` (or losing focus) hides it.
 *
 * The overlay is rendered as a fixed-position div on top of the deck. It uses
 * `pointer-events: none` so the underlying click-to-advance still fires.
 *
 * Best-effort BroadcastChannel sends — slice #5 wires up a presenter-window
 * listener; in the meantime the channel is a no-op. We send the cursor
 * position relative to the slide-shell so the listener can map it back to its
 * own viewport size.
 */

import { useEffect, useRef, useState } from "react";

const LASER_KEY = "q";
const LASER_SIZE = 12;

interface CursorPos {
  x: number;
  y: number;
}

export interface LaserProps {
  /** BroadcastChannel slug. We send `{ type: "tool", tool: "laser" }` + cursor pings. */
  slug?: string;
}

export function Laser({ slug }: LaserProps) {
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState<CursorPos | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

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
      setPos(null);
      try {
        channelRef.current?.postMessage({ type: "tool", tool: null });
      } catch {
        /* channel may be closed */
      }
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
      // Best-effort cursor broadcast; slice #5's presenter window may listen.
      try {
        channelRef.current?.postMessage({
          type: "tool-cursor",
          tool: "laser",
          x: e.clientX,
          y: e.clientY,
        });
      } catch {
        /* no listener / closed */
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [active]);

  if (!active || !pos) return null;
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
