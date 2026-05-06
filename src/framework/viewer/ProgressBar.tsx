/**
 * Bottom-of-viewport progress bar.
 *
 * Renders a thin row of segments — one per slide — with the current slide
 * highlighted. Click any segment to jump to that slide.
 *
 * Always visible, regardless of layout or idle state (issue #30). The
 * parent `<Slide>` mounts this on every layout, and we no longer carry
 * `data-deck-chrome` so the auto-hide-on-idle controller leaves us alone.
 * A future settings-modal toggle to hide the bar entirely is tracked by
 * issue #32 and is out of scope here.
 */

import { motion } from "framer-motion";
import { easeStandard } from "@/lib/motion";

export interface ProgressBarProps {
  total: number;
  current: number;
  onJump?: (slide: number) => void;
}

export function ProgressBar({ total, current, onJump }: ProgressBarProps) {
  if (total <= 1) return null;
  return (
    <div
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 px-8 pb-3"
      data-no-advance
      data-testid="progress-bar"
    >
      {Array.from({ length: total }, (_, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <button
            key={i}
            type="button"
            data-interactive
            aria-label={`Jump to slide ${i + 1}`}
            aria-current={active}
            onClick={() => onJump?.(i)}
            className="group relative flex-1 cursor-pointer py-3 focus:outline-none"
          >
            <motion.span
              className="block h-[3px] w-full rounded-full"
              animate={{
                backgroundColor: active
                  ? "var(--color-cf-orange)"
                  : done
                    ? "var(--color-cf-text-muted)"
                    : "var(--color-cf-border)",
                opacity: active ? 1 : done ? 0.55 : 0.4,
              }}
              transition={{ duration: 0.25, ease: easeStandard }}
            />
          </button>
        );
      })}
    </div>
  );
}
