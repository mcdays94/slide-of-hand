/**
 * Decorative dot-pattern layer. Place absolutely inside a relatively-
 * positioned container as ambient texture.
 */
export function DotPattern({
  className = "",
  fade = "none",
}: {
  className?: string;
  fade?: "none" | "edges" | "top" | "bottom";
}) {
  const maskStyles: Record<string, string | undefined> = {
    none: undefined,
    edges:
      "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
    top: "linear-gradient(to bottom, black, transparent)",
    bottom: "linear-gradient(to top, black, transparent)",
  };
  return (
    <div
      className={`cf-dot-pattern absolute inset-0 ${className}`.trim()}
      aria-hidden="true"
      style={{
        WebkitMaskImage: maskStyles[fade],
        maskImage: maskStyles[fade],
      }}
    />
  );
}
