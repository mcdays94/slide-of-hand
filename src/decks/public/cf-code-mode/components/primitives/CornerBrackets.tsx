import type { ReactNode } from "react";

/**
 * Wraps children with the design system's signature 8x8 corner brackets.
 * Apply on any container that should read as "elevated card".
 *
 * Note: the parent must have `position: relative` (the wrapper sets it
 * automatically via .cf-corner-brackets).
 */
export function CornerBrackets({
  children,
  className = "",
  inset = -4,
}: {
  children: ReactNode;
  className?: string;
  /** Bracket inset in px (negative = brackets sit OUTSIDE the box). */
  inset?: number;
}) {
  const bracketStyle = {
    "--cf-bracket-inset": `${inset}px`,
  } as React.CSSProperties;
  return (
    <div className={`cf-corner-brackets ${className}`.trim()} style={bracketStyle}>
      <span
        className="cf-corner-bracket"
        style={{ top: inset, left: inset }}
      />
      <span
        className="cf-corner-bracket"
        style={{ top: inset, right: inset }}
      />
      <span
        className="cf-corner-bracket"
        style={{ bottom: inset, left: inset }}
      />
      <span
        className="cf-corner-bracket"
        style={{ bottom: inset, right: inset }}
      />
      {children}
    </div>
  );
}
