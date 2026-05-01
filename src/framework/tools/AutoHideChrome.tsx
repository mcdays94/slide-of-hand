/**
 * Auto-hide chrome controller.
 *
 * Doesn't render any visible UI itself. Instead it sets a
 * `data-presenter-idle="true"` attribute on the deck-shell root after
 * 2 seconds of no `mousemove`. CSS rules in `index.css` fade any element
 * marked `data-deck-chrome` (kicker, progress bar, etc.) when that idle
 * attribute is present.
 *
 * The attribute is cleared on `mousemove` OR any `keydown`. Keydown counts
 * as activity because typing keyboard shortcuts is also "active presenting".
 */

import { useEffect } from "react";

export const IDLE_TIMEOUT_MS = 2000;

export interface AutoHideChromeProps {
  /** CSS selector for the element that should carry the idle attribute. */
  rootSelector?: string;
  /** Override timeout for tests. */
  timeoutMs?: number;
}

export function AutoHideChrome({
  rootSelector = "[data-deck-slug]",
  timeoutMs = IDLE_TIMEOUT_MS,
}: AutoHideChromeProps = {}) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(rootSelector);
    if (!root) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const setActive = () => {
      if (root.getAttribute("data-presenter-idle") === "true") {
        root.setAttribute("data-presenter-idle", "false");
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        root.setAttribute("data-presenter-idle", "true");
      }, timeoutMs);
    };

    // Initial state: NOT idle. Schedule the first idle transition.
    root.setAttribute("data-presenter-idle", "false");
    setActive();

    window.addEventListener("mousemove", setActive);
    window.addEventListener("keydown", setActive);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("mousemove", setActive);
      window.removeEventListener("keydown", setActive);
      // Don't leave the attribute behind — chrome should be visible by
      // default when the controller is unmounted (e.g. presenter mode off).
      root.removeAttribute("data-presenter-idle");
    };
  }, [rootSelector, timeoutMs]);

  return null;
}
