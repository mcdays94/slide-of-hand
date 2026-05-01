/**
 * Slide chrome shell.
 *
 * Wraps the slide's `render()` output with layout-appropriate chrome:
 *
 *   - `cover`   → no chrome (full-bleed hero)
 *   - `section` → no chrome (full-bleed kicker / chapter divider)
 *   - `default` → top-left kicker (sectionLabel + sectionNumber + slide title)
 *                  + bottom progress bar
 *   - `full`    → no chrome (slide owns the entire viewport, e.g. live demos)
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { pageEntrance } from "@/lib/motion";
import type { SlideDef } from "./types";
import { ProgressBar } from "./ProgressBar";

export interface SlideProps {
  slide: SlideDef;
  index: number;
  total: number;
  phase: number;
  onJump?: (slide: number) => void;
  children: ReactNode;
}

export function Slide({
  slide,
  index,
  total,
  phase,
  onJump,
  children,
}: SlideProps) {
  const layout = slide.layout ?? "default";
  const showKicker = layout === "default";
  const showProgress = layout === "default";

  return (
    <motion.section
      key={`${slide.id}-${index}`}
      data-slide-index={index}
      data-slide-layout={layout}
      data-slide-phase={phase}
      data-testid="slide-shell"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={pageEntrance}
      className="relative h-full w-full overflow-hidden bg-cf-bg-100 text-cf-text dark:bg-cf-bg-100 dark:text-cf-text"
    >
      {showKicker && (slide.sectionLabel || slide.title || slide.sectionNumber) && (
        <div
          className="pointer-events-none absolute left-0 top-0 z-10 flex items-baseline gap-3 px-8 pt-6 text-cf-text-muted"
          data-no-advance
        >
          {slide.sectionNumber && (
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-cf-text-subtle">
              {slide.sectionNumber}
            </span>
          )}
          {slide.sectionLabel && (
            <span className="cf-tag">{slide.sectionLabel}</span>
          )}
          {slide.title && (
            <span className="text-sm text-cf-text-muted">{slide.title}</span>
          )}
        </div>
      )}

      <div
        className={
          layout === "full"
            ? "h-full w-full"
            : "flex h-full w-full items-center justify-center px-12 py-16"
        }
      >
        {children}
      </div>

      {showProgress && (
        <ProgressBar total={total} current={index} onJump={onJump} />
      )}
    </motion.section>
  );
}
