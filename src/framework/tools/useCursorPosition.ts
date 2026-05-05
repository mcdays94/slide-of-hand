/**
 * Global cursor-position tracker.
 *
 * The presenter tools (laser + magnifier) need to render IMMEDIATELY when
 * they activate, even before the user moves the cursor. The previous design
 * attached a `mousemove` listener only after activation, so the overlay
 * didn't appear until the next move.
 *
 * Fix: attach a single window-level `mousemove` listener at module load that
 * keeps a ref to the most recent cursor position. Components subscribe via
 * the `useCursorPosition()` hook, which:
 *
 *   - Returns the current cursor position synchronously (or null if no
 *     pointer event has been observed yet).
 *   - When `subscribe = true`, re-renders the component on every move so the
 *     overlay follows the cursor.
 *
 * SSR-safe: when `window` is missing, the listener is not attached and the
 * hook returns `null`.
 *
 * Test seam: `__resetCursorPositionForTest()` clears the cached position so
 * unit tests can restart from a clean slate.
 */

import { useEffect, useState } from "react";

export interface CursorPos {
  x: number;
  y: number;
}

let latest: CursorPos | null = null;
const subscribers = new Set<(p: CursorPos) => void>();
let listenerAttached = false;

function onMove(e: MouseEvent) {
  latest = { x: e.clientX, y: e.clientY };
  for (const s of subscribers) s(latest);
}

function ensureListener() {
  if (listenerAttached) return;
  if (typeof window === "undefined") return;
  window.addEventListener("mousemove", onMove, { passive: true });
  listenerAttached = true;
}

// Attach eagerly on import in browser environments. Tests that need to
// reset can call `__resetCursorPositionForTest()`.
if (typeof window !== "undefined") {
  ensureListener();
}

/** Return the most recently observed cursor position, or null. Synchronous. */
export function getCursorPosition(): CursorPos | null {
  return latest;
}

/**
 * React hook returning the current cursor position.
 *
 * @param subscribe — when true (default), re-renders the consumer on every
 *   `mousemove`. Set to false if you only need the static snapshot at mount
 *   time and want to avoid the re-render cost.
 */
export function useCursorPosition(subscribe: boolean = true): CursorPos | null {
  const [pos, setPos] = useState<CursorPos | null>(latest);

  useEffect(() => {
    ensureListener();
    if (!subscribe) return;
    const fn = (p: CursorPos) => setPos(p);
    subscribers.add(fn);
    // Re-sync in case a move happened between render and effect.
    if (latest) setPos(latest);
    return () => {
      subscribers.delete(fn);
    };
  }, [subscribe]);

  return pos;
}

/** Test helper — reset module state. Not for production use. */
export function __resetCursorPositionForTest() {
  latest = null;
  subscribers.clear();
}
