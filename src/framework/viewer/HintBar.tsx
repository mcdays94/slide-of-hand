/**
 * Bottom keyboard hint bar.
 *
 * A thin row of mono text just above the `<ProgressBar />` listing the
 * keyboard shortcuts available in the current viewer mode. Lives in the
 * auto-hide chrome group (`data-deck-chrome="hints"`) so the existing
 * `AutoHideChrome` controller fades it after 2s of cursor inactivity and
 * restores it on `mousemove` / `keydown`.
 *
 * Context-aware: P / Q / W / E (presenter window, laser, magnifier, marker)
 * are only rendered when `usePresenterMode()` is `true`. The public viewer
 * keeps the navigation set only — those keys do nothing without the
 * `<PresenterAffordances />` stack mounted.
 *
 * Visual identity:
 *   - mono, ~10–12px, `text-cf-text-subtle`
 *   - middle-dot `·` separator between groups
 *   - centred, full-width row, sits above the progress bar (`bottom-7`)
 */

import { usePresenterMode } from "@/framework/presenter/mode";

interface Hint {
  /** Key affordance label, e.g. `← →` or `F`. */
  keys: string;
  /** Human-readable action. */
  label: string;
}

/** Shortcuts that work in any viewer (public or presenter). */
const PUBLIC_HINTS: Hint[] = [
  { keys: "← →", label: "navigate" },
  { keys: "F", label: "fullscreen" },
  { keys: "D", label: "dark" },
  { keys: "O", label: "overview" },
  { keys: "?", label: "help" },
];

/** Shortcuts that only work when presenter affordances are mounted. */
const PRESENTER_HINTS: Hint[] = [
  { keys: "P", label: "presenter" },
  { keys: "Q", label: "laser" },
  { keys: "W", label: "magnify" },
  { keys: "E", label: "marker" },
];

export function HintBar() {
  const presenterMode = usePresenterMode();
  const hints = presenterMode
    ? [...PUBLIC_HINTS, ...PRESENTER_HINTS]
    : PUBLIC_HINTS;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-7 z-10 flex justify-center px-8"
      data-no-advance
      data-deck-chrome="hints"
      data-testid="hint-bar"
    >
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-cf-text-subtle">
        {hints.map((hint, i) => (
          <span key={hint.keys} className="inline-flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="text-cf-text-subtle/60">
                ·
              </span>
            )}
            <span className="text-cf-text-muted">{hint.keys}</span>
            <span>{hint.label}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
