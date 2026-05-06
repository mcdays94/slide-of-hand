/**
 * `useNearViewportTop()` / `useNearViewportBottom()` — proximity hooks for
 * mouse-near-edge chrome (issue #31, #30).
 *
 * Returns `true` while the cursor is within `threshold` px of the
 * respective viewport edge, and stays `true` for `hideAfterMs` after the
 * cursor leaves the zone (so a slight wobble or a deliberate-but-slow
 * approach doesn't flicker).
 *
 * Listener is registered once per consumer (no re-register on state flip).
 * SSR-safe: returns `false` and does nothing when `window` is missing.
 */

import { useEffect, useState } from "react";

interface NearEdgeOptions {
  /** Distance from the edge (px) within which the cursor counts as "near". */
  threshold?: number;
  /** Delay (ms) before flipping back to `false` after the cursor leaves. */
  hideAfterMs?: number;
}

const DEFAULT_THRESHOLD = 80;
const DEFAULT_HIDE_DELAY = 800;

function useNearViewportEdge(
  edge: "top" | "bottom",
  { threshold = DEFAULT_THRESHOLD, hideAfterMs = DEFAULT_HIDE_DELAY }: NearEdgeOptions = {},
): boolean {
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const onMove = (e: MouseEvent) => {
      const inZone =
        edge === "top"
          ? e.clientY <= threshold
          : e.clientY >= window.innerHeight - threshold;

      if (inZone) {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        setIsNear(true);
      } else if (hideTimer === null) {
        // Outside zone: schedule the hide. Subsequent outside-zone moves
        // don't reset the timer — first leave wins.
        hideTimer = setTimeout(() => {
          setIsNear(false);
          hideTimer = null;
        }, hideAfterMs);
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [edge, threshold, hideAfterMs]);

  return isNear;
}

export function useNearViewportTop(opts?: NearEdgeOptions): boolean {
  return useNearViewportEdge("top", opts);
}

export function useNearViewportBottom(opts?: NearEdgeOptions): boolean {
  return useNearViewportEdge("bottom", opts);
}
