/**
 * `useToCEdgeHover` — proximity hook driving the floating ToC edge
 * handles (`<ToCEdgeHandle>`) on the left and right of the deck
 * viewport (issue #210).
 *
 * Returns `{ leftHover, rightHover }`. A flag is `true` while the
 * cursor is within `THRESHOLD` px of the matching viewport edge AND
 * none of the suppression flags are set. Otherwise both flags are
 * `false`.
 *
 * Suppression rules:
 *   - `toolActive` — Magnifier / Laser / Marker is engaged. Tool
 *     UX takes priority; floating chrome would compete with the
 *     overlay cursor.
 *   - `modalOpen` — Overview / KeyboardHelp / SettingsModal /
 *     ThemeSidebar / ElementInspector is open. We don't want
 *     edge handles peeking out from under a modal.
 *   - `sidebarOpen` — the ToC sidebar is already mounted. Showing
 *     a "click to open" handle next to an open sidebar is silly.
 *   - `fullscreen` — in fullscreen mode browsers can fire
 *     `mousemove` with sub-pixel positions just inside the
 *     viewport edge (especially around multi-monitor setups +
 *     hi-DPI displays). To suppress that flicker we tighten the
 *     proximity threshold to 0 — only `clientX === 0` or
 *     `clientX === innerWidth - 1` qualifies in fullscreen.
 *
 * Listener is registered once per consumer; SSR-safe (no-op when
 * `window` is missing).
 */

import { useEffect, useState } from "react";

const THRESHOLD = 12;

export interface UseToCEdgeHoverArgs {
  /** Magnifier / Laser / Marker currently engaged. */
  toolActive: boolean;
  /** Any modal overlay open (Overview, Help, Settings, ThemeSidebar, ElementInspector). */
  modalOpen: boolean;
  /** ToC sidebar already mounted on either side. */
  sidebarOpen: boolean;
  /** Document is in fullscreen mode. */
  fullscreen: boolean;
}

export interface UseToCEdgeHoverResult {
  leftHover: boolean;
  rightHover: boolean;
}

export function useToCEdgeHover({
  toolActive,
  modalOpen,
  sidebarOpen,
  fullscreen,
}: UseToCEdgeHoverArgs): UseToCEdgeHoverResult {
  const [state, setState] = useState<UseToCEdgeHoverResult>({
    leftHover: false,
    rightHover: false,
  });

  const suppressed = toolActive || modalOpen || sidebarOpen;

  useEffect(() => {
    // When a suppression flag flips on, clear immediately so a
    // tool / modal opening doesn't leave a stale `true` hovering.
    if (suppressed) {
      setState((s) =>
        s.leftHover || s.rightHover
          ? { leftHover: false, rightHover: false }
          : s,
      );
    }
  }, [suppressed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (suppressed) return;

    const onMove = (e: MouseEvent) => {
      // In fullscreen, only literal-edge positions qualify so
      // sub-pixel proximity quirks don't flicker the handle. The
      // last addressable pixel column is `innerWidth - 1`.
      const nearLeft = fullscreen
        ? e.clientX === 0
        : e.clientX < THRESHOLD;
      const nearRight = fullscreen
        ? e.clientX === window.innerWidth - 1
        : e.clientX > window.innerWidth - THRESHOLD;

      setState((prev) => {
        const leftHover = nearLeft;
        const rightHover = !nearLeft && nearRight;
        if (prev.leftHover === leftHover && prev.rightHover === rightHover) {
          return prev;
        }
        return { leftHover, rightHover };
      });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
    };
  }, [suppressed, fullscreen]);

  return state;
}
