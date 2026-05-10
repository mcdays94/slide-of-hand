import type { ReactNode } from "react";
import { ChromeBar } from "./ChromeBar";

type Props = {
  /** 1-indexed slide number for the chrome bar. */
  current: number;
  /** Total slides for the chrome bar. */
  total: number;
  variant?: "default" | "backdrop";
  children: ReactNode;
};

/**
 * Deck-local slide frame.
 *
 * The platform `<Slide>` renders each cf247 slide with `layout: "full"`,
 * so the whole stage area is ours. We mirror the source repo's
 * `components/Slide.tsx`: a 16:9 cream stage with dot-pattern
 * background, signature corner brackets, and chrome bars on default
 * slides; black + chrome-less on the backdrop slide.
 *
 * All styles ship via the deck's `styles.css` scoped to `.cf247-slide`.
 */
export function Frame({ current, total, variant = "default", children }: Props) {
  const isBackdrop = variant === "backdrop";

  return (
    <div className={`cf247-slide${isBackdrop ? " cf247-slide--backdrop" : ""}`}>
      {!isBackdrop && <ChromeBar current={current} total={total} />}
      <div className="cf247-slide__inner">{children}</div>
    </div>
  );
}
