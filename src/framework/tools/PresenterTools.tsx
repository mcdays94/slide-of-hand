/**
 * Presenter-tools composition wrapper.
 *
 * Mounts laser, magnifier, marker, and the auto-hide chrome controller as
 * a single bundle. **Audience-side presentation aids — available on every
 * deck viewer regardless of authentication.** A presenter giving a talk on
 * the public URL needs `Q` (laser) / `W` (magnifier) / `E` (marker) to
 * highlight content; gating these on Cloudflare Access would force them
 * to sign in before opening their own public deck.
 *
 * Originally (slice #6) this gated on `usePresenterMode()` so the public
 * viewer at `/decks/<slug>` showed audience-only chrome. The 2026-05-10
 * "tools globally available" decision flipped `<PresenterModeProvider>`
 * to `enabled={true}` on the public route — which then doubled as an
 * accidental admin-chrome gate (fixed in PRs #164/#165). The route's
 * `enabled` is now `auth-driven` again, BUT the tools themselves should
 * stay always-on. They live OUTSIDE `<PresenterAffordances>` now (which
 * is auth-gated; it still hosts the P-key presenter-window trigger),
 * mounted directly by `<Deck>`.
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

import { useEffect, useState } from "react";
import { Laser } from "./Laser";
import { Magnifier } from "./Magnifier";
import { Marker } from "./Marker";
import { AutoHideChrome } from "./AutoHideChrome";
import { ToolActivePill, type ActiveTool } from "./ToolActivePill";

export function PresenterTools() {
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
  }, [activeTool, markerActive]);

  // Resolve slug for tool broadcasts (Laser / Magnifier / Marker).
  // The slug source is the `[data-deck-slug]` attribute on the host's deck
  // root (or PresenterWindow). On first paint the attribute may not have
  // committed yet — poll for up to ~1s and store in state so children
  // re-render with the slug once it's available.
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
  }, [slug]);

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
