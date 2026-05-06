/**
 * Overview mode — slide thumbnail grid.
 *
 * Toggled with `O`. Shows a grid of slides with the current slide highlighted;
 * clicking a tile jumps to that slide and closes the overlay.
 *
 * Tiles render real PNG thumbnails produced by `npm run thumbnails`
 * (`public/thumbnails/<slug>/<NN>.png`). When a thumbnail isn't present
 * (fresh clone, never run, or new slide added since the last build) the tile
 * falls back to the legacy text-only preview — kicker (`01 · cover`) plus
 * slide title — so the grid stays usable without thumbnails. Production
 * deploys never depend on thumbnails being present; they are a UX nicety.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { SlideDef } from "./types";
import { easeEntrance } from "@/lib/motion";

export interface OverviewProps {
  open: boolean;
  /** Deck slug — drives the thumbnail URL `/thumbnails/<slug>/<NN>.png`. */
  slug: string;
  slides: SlideDef[];
  current: number;
  onJump: (slide: number) => void;
  onClose: () => void;
}

interface OverviewTileProps {
  slug: string;
  slide: SlideDef;
  index: number;
  active: boolean;
  onClick: () => void;
}

function OverviewTile({
  slug,
  slide,
  index,
  active,
  onClick,
}: OverviewTileProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const thumbSrc = `/thumbnails/${slug}/${String(index + 1).padStart(2, "0")}.png`;
  const showImage = !imageFailed;

  return (
    <button
      type="button"
      data-interactive
      onClick={onClick}
      className={`cf-card group relative flex aspect-video flex-col justify-between overflow-hidden text-left transition-colors ${
        active
          ? "border-cf-orange ring-2 ring-cf-orange/40"
          : "hover:border-dashed"
      }`}
    >
      {showImage ? (
        <img
          src={thumbSrc}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col justify-between p-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle">
            {String(index + 1).padStart(2, "0")} · {slide.layout ?? "default"}
          </span>
          <span className="line-clamp-2 text-sm font-medium tracking-tight text-cf-text">
            {slide.title || slide.id}
          </span>
        </div>
      )}
    </button>
  );
}

export function Overview({
  open,
  slug,
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
            {slides.map((slide, i) => (
              <OverviewTile
                key={slide.id}
                slug={slug}
                slide={slide}
                index={i}
                active={i === current}
                onClick={() => {
                  onJump(i);
                  onClose();
                }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
