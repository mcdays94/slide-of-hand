/**
 * Tool-active pill.
 *
 * Small fixed-position indicator in the top-right of the viewport showing
 * which presenter tool is currently engaged (laser / magnify / marker).
 * Disappears the moment the tool deactivates — there is no fade-out, by
 * design: presenters need an unambiguous "is the tool on?" answer.
 *
 * Styling: warm-cream surface with translucent backdrop, uppercase mono
 * kicker, brand-orange dot for the laser indicator. All design tokens
 * sourced from CSS variables / Tailwind utilities, never literal hex.
 */

import { motion } from "framer-motion";
import { easeStandard } from "@/lib/motion";

export type ActiveTool = "laser" | "magnifier" | "marker" | null;

export interface ToolActivePillProps {
  tool: ActiveTool;
}

interface PillContent {
  icon: string;
  label: string;
  iconColor?: string;
}

function describe(tool: ActiveTool): PillContent | null {
  switch (tool) {
    case "laser":
      return { icon: "●", label: "LASER", iconColor: "var(--color-cf-orange)" };
    case "magnifier":
      return { icon: "⌕", label: "MAGNIFY" };
    case "marker":
      return { icon: "✏", label: "MARKER" };
    default:
      return null;
  }
}

export function ToolActivePill({ tool }: ToolActivePillProps) {
  const content = describe(tool);
  if (!content) return null;
  return (
    <motion.div
      data-testid="tool-active-pill"
      data-tool={tool ?? ""}
      aria-live="polite"
      aria-hidden="false"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12, ease: easeStandard }}
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 10000,
        pointerEvents: "none",
      }}
      className="inline-flex items-center gap-2 rounded-full border border-cf-border bg-cf-bg-100/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-cf-text shadow-[0_4px_12px_rgba(0,0,0,0.08)] backdrop-blur"
    >
      <span
        aria-hidden="true"
        style={{
          color: content.iconColor ?? "currentColor",
          fontSize: "12px",
          lineHeight: 1,
        }}
      >
        {content.icon}
      </span>
      <span>{content.label}</span>
    </motion.div>
  );
}
