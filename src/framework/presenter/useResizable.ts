/**
 * `useResizable` — drag-to-resize panel hook.
 *
 * Adapted from cf-slides' `studio/useResizable.ts` (per-issue waiver
 * granted on #36) and reshaped to fit Slide of Hand's localStorage
 * namespace. Used by the presenter window's notes panel splitter.
 *
 * Returns:
 *   - `width` — the current width in px, clamped to [minWidth, maxWidth].
 *   - `onMouseDown(e, direction)` — pass to a splitter element's
 *     `onMouseDown`. Direction `1` means dragging the right edge of the
 *     panel (mouse moves right → panel grows). Direction `-1` means
 *     dragging the left edge of a right-anchored panel (mouse moves
 *     left → panel grows).
 *
 * Persistence: the latest width is written to localStorage at
 * `slide-of-hand-presenter-resize:<storageKey>`. SSR-safe: storage and
 * window access are guarded.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseResizableOptions {
  /** Suffix for the localStorage key. The full key is namespaced. */
  storageKey: string;
  /** Default width when nothing is persisted yet. */
  defaultWidth: number;
  /** Lower bound on the resizable width. */
  minWidth: number;
  /** Upper bound on the resizable width. */
  maxWidth: number;
}

export interface UseResizableResult {
  width: number;
  /** Pass to a splitter element. `direction` defaults to 1 (right edge). */
  onMouseDown: (
    event: React.MouseEvent,
    direction?: 1 | -1,
  ) => void;
}

const STORAGE_PREFIX = "slide-of-hand-presenter-resize:";

function storageKeyFor(key: string): string {
  return STORAGE_PREFIX + key;
}

function readPersistedWidth(
  key: string,
  defaultWidth: number,
  minWidth: number,
  maxWidth: number,
): number {
  if (typeof window === "undefined") return defaultWidth;
  try {
    const raw = window.localStorage.getItem(storageKeyFor(key));
    if (raw == null) return defaultWidth;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return defaultWidth;
    if (parsed < minWidth || parsed > maxWidth) return defaultWidth;
    return parsed;
  } catch {
    return defaultWidth;
  }
}

export function useResizable(opts: UseResizableOptions): UseResizableResult {
  const { storageKey, defaultWidth, minWidth, maxWidth } = opts;

  const [width, setWidth] = useState<number>(() =>
    readPersistedWidth(storageKey, defaultWidth, minWidth, maxWidth),
  );

  // Latest values, captured by ref so the window-level handlers don't
  // need to be re-installed on every state change.
  const widthRef = useRef(width);
  widthRef.current = width;

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const direction = useRef<1 | -1>(1);
  const minRef = useRef(minWidth);
  const maxRef = useRef(maxWidth);
  minRef.current = minWidth;
  maxRef.current = maxWidth;

  const onMouseDown = useCallback(
    (event: React.MouseEvent, dir: 1 | -1 = 1) => {
      event.preventDefault();
      dragging.current = true;
      startX.current = event.clientX;
      startWidth.current = widthRef.current;
      direction.current = dir;
      if (typeof document !== "undefined") {
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
    },
    [],
  );

  // One global mousemove/mouseup pair while mounted. Refs feed it the
  // current drag state without re-binding.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = (e.clientX - startX.current) * direction.current;
      const next = Math.max(
        minRef.current,
        Math.min(maxRef.current, startWidth.current + delta),
      );
      setWidth(next);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (typeof document !== "undefined") {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      try {
        window.localStorage.setItem(
          storageKeyFor(storageKey),
          String(widthRef.current),
        );
      } catch {
        /* private mode / quota — fall through */
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [storageKey]);

  return { width, onMouseDown };
}
