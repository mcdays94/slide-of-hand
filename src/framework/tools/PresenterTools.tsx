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
 * Active-tool surface area (issue #10):
 *   - Each tool reports its active state via `onActiveChange`.
 *   - We mirror the *currently engaged* tool to the deck root as a
 *     `data-tool-active="laser" | "magnifier" | "marker"` attribute. CSS
 *     scopes `cursor: none` (laser/magnifier) and `cursor: crosshair`
 *     (marker) on that attribute. See `src/styles/index.css`.
 *   - Marker mode also gets a legacy `data-marker-active="true"` mirror for
 *     downstream styles wired up before issue #10.
 *   - A `<ToolActivePill />` is rendered top-right whenever a tool is on.
 */

import { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePresenterMode } from "@/framework/presenter/mode";
import { Laser } from "./Laser";
import { Magnifier } from "./Magnifier";
import { Marker } from "./Marker";
import { AutoHideChrome } from "./AutoHideChrome";
import { ToolActivePill, type ActiveTool } from "./ToolActivePill";

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

  const [laserActive, setLaserActive] = useState(false);
  const [magnifierActive, setMagnifierActive] = useState(false);
  const [markerActive, setMarkerActive] = useState(false);

  // Resolve the "single active tool" used for the data-tool-active attribute
  // and the pill. If multiple tools somehow report active simultaneously we
  // prioritise marker (toggled, deliberate) > magnifier > laser.
  const activeTool: ActiveTool = markerActive
    ? "marker"
    : magnifierActive
      ? "magnifier"
      : laserActive
        ? "laser"
        : null;

  // Mirror activeTool + legacy markerActive flag onto the deck root so CSS
  // can scope cursor visibility.
  useEffect(() => {
    if (!enabled) return;
    const root = document.querySelector<HTMLElement>("[data-deck-slug]");
    if (!root) return;
    if (activeTool) {
      root.setAttribute("data-tool-active", activeTool);
    } else {
      root.removeAttribute("data-tool-active");
    }
    if (markerActive) {
      root.setAttribute("data-marker-active", "true");
    } else {
      root.removeAttribute("data-marker-active");
    }
    return () => {
      root.removeAttribute("data-tool-active");
      root.removeAttribute("data-marker-active");
    };
  }, [enabled, activeTool, markerActive]);

  // Resolve slug for tool broadcasts (Laser / Magnifier / Marker).
  // The slug source is the `[data-deck-slug]` attribute on the host's deck
  // root (or PresenterWindow). When this PresenterTools instance was
  // mounted via the URL-override auto-mount, the React main tree may not
  // have committed yet, so the attribute can be temporarily missing. Poll
  // for up to ~1s and store in state so children re-render with the slug
  // once it's available.
  const [slug, setSlug] = useState<string | undefined>(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.querySelector<HTMLElement>("[data-deck-slug]");
    return root?.getAttribute("data-deck-slug") ?? undefined;
  });
  useEffect(() => {
    if (slug) return;
    if (typeof document === "undefined") return;
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      const root = document.querySelector<HTMLElement>("[data-deck-slug]");
      const found = root?.getAttribute("data-deck-slug") ?? undefined;
      if (found) {
        setSlug(found);
        return;
      }
      attempts++;
      if (attempts >= 30) return; // give up after ~1s
      window.setTimeout(tick, 33);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [slug, enabled]);

  if (!enabled) return null;

  return (
    <>
      <AutoHideChrome />
      <Laser slug={slug} onActiveChange={setLaserActive} />
      <Magnifier slug={slug} onActiveChange={setMagnifierActive} />
      <Marker slug={slug} onActiveChange={setMarkerActive} />
      <ToolActivePill tool={activeTool} />
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

const AUTO_MOUNT_HOST_ID = "slide-of-hand-presenter-tools-override";
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
