/**
 * `<ToCEdgeHandle>` — a small floating button that fades in on the
 * left or right edge of the deck viewport when the cursor is within
 * proximity of that edge (issue #210). Click opens the ToC sidebar
 * from the matching side.
 *
 * Purely presentational; the proximity logic lives in
 * `useToCEdgeHover` and is wired up in `<Deck>`. Animations source
 * easings from `@/lib/motion` per AGENTS.md.
 *
 * Visual: 24×40 px monochrome button anchored mid-height, with a
 * small chevron glyph (`⟨` / `⟩`) hinting which way the sidebar
 * will open. Subtle border + muted text colour from the design
 * tokens — fits the "subtle is the brand" chrome aesthetic.
 */

import { AnimatePresence, motion } from "framer-motion";
import { easeEntrance } from "@/lib/motion";

export interface ToCEdgeHandleProps {
  visible: boolean;
  side: "left" | "right";
  onClick: () => void;
}

export function ToCEdgeHandle({ visible, side, onClick }: ToCEdgeHandleProps) {
  const isLeft = side === "left";
  const offset = isLeft ? -8 : 8;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          // The wrapper carries `data-no-advance` so the deck's
          // click-to-advance handler ignores everything inside,
          // including the button's bounding area.
          data-no-advance
          data-testid={`toc-edge-handle-${side}-wrap`}
          // Positioning: `fixed` so the handle sits relative to
          // the viewport, not the deck inner div (the deck letter-
          // boxes inside a 16:9 viewport, so `absolute` to the
          // deck root would put the handles inside the letter-
          // boxes instead of at the screen edge).
          //
          // Tailwind:
          //   - `top-1/2 -translate-y-1/2` vertical center
          //   - `left-0` / `right-0` anchor the chosen edge
          //   - `z-40` above slide content, below modals (z-50)
          className={`fixed top-1/2 z-40 -translate-y-1/2 ${
            isLeft ? "left-0" : "right-0"
          }`}
          initial={{ opacity: 0, x: offset }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: offset }}
          transition={{ duration: 0.18, ease: easeEntrance }}
        >
          <button
            type="button"
            data-interactive
            data-testid={`toc-edge-handle-${side}`}
            aria-label={
              isLeft
                ? "Open slides from left"
                : "Open slides from right"
            }
            onClick={onClick}
            className={`flex h-10 w-6 items-center justify-center border border-cf-border bg-cf-bg-100/90 text-cf-text-muted shadow-sm backdrop-blur-sm transition-colors hover:bg-cf-bg-200 hover:text-cf-text ${
              isLeft
                ? "rounded-r border-l-0"
                : "rounded-l border-r-0"
            }`}
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {isLeft ? "\u27E9" : "\u27E8"}
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
