/**
 * `<Filmstrip>` — compact horizontal strip of slide-number chips.
 *
 * Each chip is a button. Clicking a chip calls `onJump(index)`, which the
 * presenter window wires to a `navigate` BroadcastMessage. The active
 * slide is highlighted in cf-orange; other chips read as muted.
 *
 * The component takes a list of `slides` purely so it can compute counts
 * + ids; we don't render slide content here.
 */
import type { SlideDef } from "@/framework/viewer/types";

export interface FilmstripProps {
  slides: SlideDef[];
  current: number;
  onJump: (index: number) => void;
}

export function Filmstrip({ slides, current, onJump }: FilmstripProps) {
  return (
    <div
      data-testid="presenter-filmstrip"
      className="flex gap-1.5 overflow-x-auto pb-1"
      role="navigation"
      aria-label="Jump to slide"
    >
      {slides.map((slide, i) => {
        const isActive = i === current;
        return (
          <button
            key={slide.id}
            type="button"
            onClick={() => onJump(i)}
            data-testid={`presenter-filmstrip-${i}`}
            data-active={isActive ? "true" : "false"}
            title={slide.title || slide.id}
            aria-label={`Jump to slide ${i + 1}: ${slide.title || slide.id}`}
            aria-current={isActive ? "true" : undefined}
            className={`flex h-[22px] w-9 flex-shrink-0 items-center justify-center rounded font-mono text-[8px] leading-none transition-colors ${
              isActive
                ? "bg-cf-orange text-cf-bg-100"
                : "bg-cf-bg-200 text-cf-text-subtle hover:bg-cf-bg-300 hover:text-cf-text-muted"
            }`}
          >
            {String(i + 1).padStart(2, "0")}
          </button>
        );
      })}
    </div>
  );
}
