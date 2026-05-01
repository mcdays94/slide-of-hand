/**
 * Presenter-tools composition wrapper.
 *
 * Mounts laser, magnifier, marker, and the auto-hide chrome controller as
 * a single bundle. Internally gated by `usePresenterMode()` PLUS a
 * `?presenter-mode=1` URL override (so this slice can be probed before the
 * admin route from slice #7 lands). When neither gate is on, this renders
 * `null` and no listeners are attached.
 *
 * Override mechanism: when the URL carries `?presenter-mode=1`, we ALSO
 * install a module-level auto-mount that injects a fresh `<PresenterTools />`
 * onto `document.body`. This is needed because `<PresenterAffordances />`
 * gates on `usePresenterMode()` and would otherwise short-circuit before
 * <PresenterTools /> ever rendered. The auto-mount path is purely for local
 * probing and does nothing in normal admin flow.
 *
 * While marker mode is active, we add a `data-marker-active="true"`
 * attribute to the deck root so other tools / styles can react if they need
 * to. Click-to-advance suppression itself is handled by wrapping the marker
 * canvas in `<div data-no-advance>` (see `Marker.tsx`).
 */

import { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePresenterMode } from "@/framework/presenter/mode";
import { Laser } from "./Laser";
import { Magnifier } from "./Magnifier";
import { Marker } from "./Marker";
import { AutoHideChrome } from "./AutoHideChrome";

/**
 * Read the override from `location.search`. Exported for tests / probes.
 *
 * Returns `true` when the URL carries `?presenter-mode=1` (or `?presenter`),
 * `false` otherwise. SSR-safe: returns `false` when `window` is missing.
 */
export function readPresenterModeOverride(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("presenter-mode");
    if (v === "1" || v === "true") return true;
    return params.has("presenter");
  } catch {
    return false;
  }
}

export function PresenterTools() {
  const presenterMode = usePresenterMode();
  const override = useMemo(() => readPresenterModeOverride(), []);
  const enabled = presenterMode || override;

  // Track marker-active so we can mirror it to the deck root for downstream
  // styles. The Marker component owns the actual mode flag.
  const [markerActive, setMarkerActive] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const root = document.querySelector<HTMLElement>("[data-deck-slug]");
    if (!root) return;
    if (markerActive) {
      root.setAttribute("data-marker-active", "true");
    } else {
      root.removeAttribute("data-marker-active");
    }
    return () => {
      root.removeAttribute("data-marker-active");
    };
  }, [enabled, markerActive]);

  // Resolve slug for the Laser broadcast (best-effort).
  const slug = useMemo(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.querySelector<HTMLElement>("[data-deck-slug]");
    return root?.getAttribute("data-deck-slug") ?? undefined;
  }, [enabled]); // re-resolve when the gate flips on

  if (!enabled) return null;

  return (
    <>
      <AutoHideChrome />
      <Laser slug={slug} />
      <Magnifier />
      <Marker onActiveChange={setMarkerActive} />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// URL-override auto-mount.
//
// `<PresenterAffordances />` early-returns null when `usePresenterMode()` is
// false, so embedded `<PresenterTools />` never renders. To support a
// `?presenter-mode=1` probing override (used for visual verification before
// slice #7's admin route lands), we attach a sibling root at body level. The
// child copy reads the same URL override and renders the toolset directly.
// ──────────────────────────────────────────────────────────────────────────

const AUTO_MOUNT_HOST_ID = "reaction-presenter-tools-override";
let autoMountRoot: Root | null = null;

function ensureAutoMount() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!readPresenterModeOverride()) return;
  if (document.getElementById(AUTO_MOUNT_HOST_ID)) return;
  const host = document.createElement("div");
  host.id = AUTO_MOUNT_HOST_ID;
  document.body.appendChild(host);
  autoMountRoot = createRoot(host);
  autoMountRoot.render(<PresenterTools />);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureAutoMount, { once: true });
  } else {
    // Defer to next tick so React's main root has finished mounting first.
    setTimeout(ensureAutoMount, 0);
  }
}
