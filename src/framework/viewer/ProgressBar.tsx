/**
 * Bottom-of-viewport progress bar.
 *
 * Renders a thin row of segments — one per slide — with the current slide
 * highlighted. Click any segment to jump to that slide.
 *
 * Visibility is governed by the user-configurable `showSlideIndicators`
 * setting (issue #32):
 *
 *   - **ON (default)**: always visible. Current behaviour after PR #40.
 *
 *   - **OFF**: gated by mouse proximity to the bottom edge of the
 *     viewport via `useNearViewportBottom()` — the bar is hidden by
 *     default and fades in when the cursor moves within ~80px of the
 *     bottom edge, then fades out ~800ms after the cursor leaves the
 *     zone. Same proximity behaviour as `<HintBar>`.
 */

import { motion } from "framer-motion";
import { easeStandard } from "@/lib/motion";
import { useSettings } from "./useSettings";
import { useNearViewportBottom } from "./useNearViewportEdge";

export interface ProgressBarProps {
  total: number;
  current: number;
  onJump?: (slide: number) => void;
}

export function ProgressBar({ total, current, onJump }: ProgressBarProps) {
  const { settings } = useSettings();
  const isNear = useNearViewportBottom();
  // Always-visible mode bypasses the proximity gate. The hook is still
  // called every render (Rules of Hooks), but its result is ignored when
  // the setting is on.
  const visible = settings.showSlideIndicators ? true : isNear;

  if (total <= 1) return null;
  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 px-8 pb-3 transition-opacity duration-200 ease-out ${
        visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      data-no-advance
      data-testid="progress-bar"
      data-visible={visible ? "true" : "false"}
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
            tabIndex={visible ? 0 : -1}
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
