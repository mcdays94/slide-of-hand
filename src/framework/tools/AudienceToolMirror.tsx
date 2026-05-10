/**
 * Audience-side tool mirror.
 *
 * Item F (#111). When the presenter holds a tool over the presenter
 * window's scoped panel, the same overlay should appear on the actual
 * audience-facing deck (a separate browser tab/window). The presenter
 * broadcasts:
 *
 *   - `{ type: "tool", tool: "laser" | "magnifier" | "marker" | null }`
 *   - `{ type: "cursor", tool, x, y }` where x/y are 0..1 normalized
 *     to the presenter's tool-scope rect.
 *
 * This component mounts ONLY on the audience side (NOT in presenter
 * mode). It subscribes to those broadcasts, maps the normalized
 * coordinate to the audience's slide-shell rect, and renders a fixed-
 * position laser dot / magnifier-lens stand-in / marker dot at the
 * mapped point.
 *
 * Constraint from the brief: the audience window must NOT itself be
 * running in presenter mode (the URL `?presenter=1` distinguishes them).
 * `<Deck>` already gates `<PresenterAffordances>` on presenter mode;
 * this component is mounted in the inverse position so audience-only
 * decks subscribe.
 */
import { useEffect, useState } from "react";
import { useDeckBroadcast } from "@/framework/presenter/broadcast";
import {
  denormalizeCursorFromScope,
  getToolScope,
} from "./useToolScope";

interface AudienceToolMirrorProps {
  /** Deck slug — used to resolve the broadcast channel name. */
  slug: string;
}

type ActiveTool = "laser" | "magnifier" | "marker" | null;

const LASER_SIZE = 16;
const MAGNIFIER_RADIUS = 80;

export function AudienceToolMirror({ slug }: AudienceToolMirrorProps) {
  const [tool, setTool] = useState<ActiveTool>(null);
  const [norm, setNorm] = useState<{ x: number; y: number } | null>(null);

  useDeckBroadcast(slug, (msg) => {
    if (msg.type === "tool") {
      setTool(msg.tool);
      if (msg.tool === null) setNorm(null);
    } else if (msg.type === "cursor") {
      setTool(msg.tool);
      setNorm({ x: msg.x, y: msg.y });
    }
  });

  // Translate normalized coordinates to viewport pixels using the
  // audience's slide-shell as the target rect. We re-resolve on every
  // render rather than caching — slide changes / fullscreen toggles
  // change the rect.
  const scope = getToolScope();
  const screen = norm ? denormalizeCursorFromScope(norm, scope) : null;

  // Auto-clear when tool is null OR the cursor message is stale (no
  // recent updates implied by `null` norm). The `tool` state stays
  // null between strokes; nothing to render.
  useEffect(() => {
    if (tool === null) setNorm(null);
  }, [tool]);

  if (!tool || !screen) return null;

  if (tool === "laser") {
    return (
      <div
        data-testid="audience-laser-mirror"
        aria-hidden="true"
        style={{
          position: "fixed",
          left: screen.x - LASER_SIZE / 2,
          top: screen.y - LASER_SIZE / 2,
          width: LASER_SIZE,
          height: LASER_SIZE,
          borderRadius: "50%",
          backgroundColor: "var(--color-cf-orange)",
          boxShadow:
            "0 0 14px 5px rgba(255, 72, 1, 0.55), 0 0 2px 1px rgba(255, 255, 255, 0.6) inset",
          pointerEvents: "none",
          zIndex: 9999,
        }}
      />
    );
  }

  if (tool === "magnifier") {
    // Audience doesn't get the full liquid-glass refraction (that
    // requires cloning the slide). Just render a circle + ring so the
    // audience knows where the presenter is focused.
    return (
      <div
        data-testid="audience-magnifier-mirror"
        aria-hidden="true"
        style={{
          position: "fixed",
          left: screen.x - MAGNIFIER_RADIUS,
          top: screen.y - MAGNIFIER_RADIUS,
          width: MAGNIFIER_RADIUS * 2,
          height: MAGNIFIER_RADIUS * 2,
          borderRadius: "50%",
          border: "2px solid rgba(255, 72, 1, 0.6)",
          boxShadow:
            "0 0 0 1px rgba(82,16,0,0.15), inset 0 0 30px rgba(255, 72, 1, 0.08)",
          background:
            "radial-gradient(circle at center, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 70%)",
          pointerEvents: "none",
          zIndex: 9997,
        }}
      />
    );
  }

  if (tool === "marker") {
    // The audience renders a simple dot at the marker position. A full
    // stroke trail would require buffering per-event coordinates with
    // pointer-down/up events; that's a larger lift and we defer it.
    return (
      <div
        data-testid="audience-marker-mirror"
        aria-hidden="true"
        style={{
          position: "fixed",
          left: screen.x - 4,
          top: screen.y - 4,
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#FF4801",
          pointerEvents: "none",
          zIndex: 9997,
        }}
      />
    );
  }

  return null;
}
