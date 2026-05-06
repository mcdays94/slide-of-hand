/**
 * Inline lucide-style icons used by the presenter window.
 *
 * Mirrors the pattern in `framework/viewer/TopToolbar.tsx` — plain `<svg>`
 * elements with `currentColor` strokes so the buttons inherit text color
 * via Tailwind utilities. We do NOT depend on `lucide-react`.
 */

export interface IconProps {
  /** Override default size (16). */
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    xmlns: "http://www.w3.org/2000/svg" as const,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor" as const,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

export function ChevronLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function PauseIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

export function PlayIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

export function CloseIcon({ size = 11, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function PlusIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function MinusIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M5 12h14" />
    </svg>
  );
}
