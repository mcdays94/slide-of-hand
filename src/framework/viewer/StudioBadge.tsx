/**
 * Top-left STUDIO badge.
 *
 * Rendered only when `usePresenterMode()` is `true` (i.e. the viewer was
 * mounted via `/admin/decks/<slug>` or with the `?presenter-mode=1`
 * dev override). Signals to the author that they are in the elevated mode
 * where presenter shortcuts (P/Q/W/E) are wired up.
 *
 * Part of the auto-hide chrome group via `data-deck-chrome="studio-badge"`,
 * so it fades in/out alongside the kicker, hint bar, and progress bar.
 *
 * Visual identity: `cf-tag` utility (uppercase mono pill), tinted with
 * `text-cf-orange` to match the brand accent colour, no fill.
 */

import { usePresenterMode } from "@/framework/presenter/mode";

export function StudioBadge() {
  const presenterMode = usePresenterMode();
  if (!presenterMode) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-20 px-8 pt-2"
      data-no-advance
      data-deck-chrome="studio-badge"
      data-testid="studio-badge"
    >
      <span className="cf-tag text-cf-orange">Studio</span>
    </div>
  );
}
