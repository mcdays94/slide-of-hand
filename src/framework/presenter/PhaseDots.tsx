/**
 * `<PhaseDots>` — phase indicator strip beneath the current-slide preview.
 *
 * Renders one dot per phase. The active dot is wider (10px) and orange;
 * passed phases share the orange but stay 4px; future phases are muted.
 * Returns `null` when there's only one phase — single-phase slides don't
 * benefit from the indicator.
 */
import type { ReactElement } from "react";

export interface PhaseDotsProps {
  /** Total number of phases for the current slide. */
  total: number;
  /** Currently-active phase index (0-based). */
  current: number;
}

export function PhaseDots({
  total,
  current,
}: PhaseDotsProps): ReactElement | null {
  if (!Number.isFinite(total) || total <= 1) return null;
  return (
    <div
      data-testid="presenter-phase-dots"
      className="flex items-center gap-1.5"
      aria-label={`Phase ${current + 1} of ${total}`}
    >
      <span className="cf-tag !tracking-[0.2em]">phase</span>
      {Array.from({ length: total }).map((_, i) => {
        const isActive = i === current;
        const reached = i <= current;
        return (
          <span
            key={i}
            data-testid={`presenter-phase-dot-${i}`}
            data-active={isActive ? "true" : "false"}
            aria-hidden
            className={`h-1 rounded-full transition-all duration-200 ease-out ${
              reached ? "bg-cf-orange" : "bg-cf-border"
            } ${isActive ? "w-2.5" : "w-1"}`}
          />
        );
      })}
    </div>
  );
}
