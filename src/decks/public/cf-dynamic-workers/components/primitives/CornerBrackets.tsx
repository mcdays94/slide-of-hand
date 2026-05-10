import type { CSSProperties, ReactNode } from "react";

/**
 * Wraps children with the design system's signature 8x8 corner brackets.
 * Apply on any container that should read as "elevated card".
 *
 * Note: the parent must have `position: relative` (the wrapper sets it
 * automatically via .cf-corner-brackets).
 *
 * The `style` prop is merged with the internal bracket-inset variable so
 * callers can layer in extra properties (box-shadow halos, custom border
 * colours, etc.) without forking the component.
 */
export function CornerBrackets({
  children,
  className = "",
  inset = -4,
  style,
}: {
  children: ReactNode;
  className?: string;
  /** Bracket inset in px (negative = brackets sit OUTSIDE the box). */
  inset?: number;
  /** Optional extra inline styles merged onto the wrapper. */
  style?: CSSProperties;
}) {
  const bracketStyle: CSSProperties = {
    ...style,
    ...({
      "--cf-bracket-inset": `${inset}px`,
    } as CSSProperties),
  };
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
