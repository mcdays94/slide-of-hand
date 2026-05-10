/**
 * Cloudflare wordmark — official lockup, served from `/public/cloudflare-logo.png`.
 *
 * The PNG is the authoritative version (cloud mark + "Cloudflare" text) used
 * everywhere the deck shows Cloudflare branding (slide header, title slide,
 * thanks slide, decorative anchors).
 *
 * Sized via `height` prop. Width auto-scales to preserve the ~3:1 aspect
 * ratio of the source asset.
 */
export function CloudflareWordmark({
  height = 32,
  className = "",
  alt = "Cloudflare",
}: {
  /** CSS height in px. Default 32. */
  height?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/cf-code-mode/cloudflare-logo.png"
      alt={alt}
      style={{ height, width: "auto" }}
      className={`block select-none ${className}`.trim()}
      draggable={false}
    />
  );
}
