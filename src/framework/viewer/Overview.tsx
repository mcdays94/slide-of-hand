/**
 * Overview mode — slide thumbnail grid.
 *
 * Toggled with `O`. Shows a grid of slides with the current slide highlighted;
 * clicking a tile jumps to that slide and closes the overlay.
 *
 * The thumbnails render a tiny preview (slide id + title) rather than a true
 * pixel-perfect snapshot — pixel snapshots would require html2canvas or a
 * second reactive render of every slide, both of which are out of scope for
 * this slice. A future slice can swap in real thumbnails.
 */

import { AnimatePresence, motion } from "framer-motion";
import type { SlideDef } from "./types";
import { easeEntrance } from "@/lib/motion";

export interface OverviewProps {
  open: boolean;
  slides: SlideDef[];
  current: number;
  onJump: (slide: number) => void;
  onClose: () => void;
}

export function Overview({
  open,
  slides,
  current,
  onJump,
  onClose,
}: OverviewProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overview"
          data-testid="overview"
          data-no-advance
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: easeEntrance }}
          className="absolute inset-0 z-50 flex items-center justify-center bg-cf-bg-100/95 px-12 py-16 backdrop-blur-sm"
        >
          <button
            type="button"
            aria-label="Close overview"
            data-interactive
            onClick={onClose}
            className="absolute right-6 top-6 cf-btn-ghost"
          >
            Esc
          </button>
          <div className="grid w-full max-w-6xl grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {slides.map((slide, i) => {
              const active = i === current;
              return (
                <button
                  key={slide.id}
                  type="button"
                  data-interactive
                  onClick={() => {
                    onJump(i);
                    onClose();
                  }}
                  className={`cf-card group flex aspect-video flex-col justify-between p-3 text-left transition-colors ${
                    active
                      ? "border-cf-orange ring-2 ring-cf-orange/40"
                      : "hover:border-dashed"
                  }`}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle">
                    {String(i + 1).padStart(2, "0")} · {slide.layout ?? "default"}
                  </span>
                  <span className="line-clamp-2 text-sm font-medium tracking-tight text-cf-text">
                    {slide.title || slide.id}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
