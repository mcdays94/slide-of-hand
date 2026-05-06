/**
 * `<TopToolbar>` — mouse-proximity navigation chrome at the top of the
 * deck viewer (issue #31).
 *
 * Hidden by default; fades in when the cursor is within 80px of the
 * viewport top edge, and fades out 800ms after the cursor leaves the
 * zone. See `useNearViewportTop()` for the proximity logic.
 *
 * Renders TWO clusters:
 *
 *   - **Always-visible (left cluster):** Home (→ /), Studio (→ /admin).
 *     Useful from any deck-viewer route, public or admin.
 *
 *   - **Context-dependent (right cluster):**
 *     - When viewer is in PRESENTER mode (admin route): Theme (T),
 *       Slides (M), Analytics. Theme + Slides synthesise the existing
 *       `t` / `m` keypress so `<Deck>`'s keyboard handler does the work.
 *       Analytics is a real `<Link>` to `/admin/decks/<slug>/analytics`.
 *     - When viewer is on the PUBLIC route: a single "Open in Studio"
 *       link to `/admin/decks/<slug>?slide=N&phase=K` so the author can
 *       jump straight to the admin viewer at the slide they're looking
 *       at.
 *
 * All buttons carry `data-no-advance` (the bar) and `data-interactive`
 * (the inputs) so a click doesn't bubble into `<Deck>`'s click-to-
 * advance handler and a keypress on a focused button doesn't trigger a
 * deck shortcut.
 */
import { useCallback, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePresenterMode } from "@/framework/presenter/mode";
import { useNearViewportTop } from "./useNearViewportEdge";

export interface TopToolbarProps {
  slug: string;
  /** Current slide index (0-based). Drives the Open-in-Studio deep link. */
  currentSlide: number;
  /** Current phase index (0-based). Drives the Open-in-Studio deep link. */
  currentPhase: number;
}

/**
 * Synthesises a keydown for `key` so existing `<Deck>` shortcuts fire.
 *
 * Dispatched on `document.body` (NOT `window`) so the event's `target`
 * is a real `Element` — `<Deck>`'s handler narrows with
 * `target instanceof Element` before calling `.closest()`, and a
 * `Window` target (the result of `window.dispatchEvent(...)`) would
 * fail the instanceof check and skip the data-interactive gate. We
 * bubble the event up so the existing window-level keydown listener
 * still receives it.
 */
function dispatchSyntheticKey(key: string) {
  if (typeof document === "undefined") return;
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

function HomeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function StudioIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <line x1="8" x2="21" y1="6" y2="6" />
      <line x1="8" x2="21" y1="12" y2="12" />
      <line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6" y2="6" />
      <line x1="3" x2="3.01" y1="12" y2="12" />
      <line x1="3" x2="3.01" y1="18" y2="18" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <line x1="12" x2="12" y1="20" y2="10" />
      <line x1="18" x2="18" y1="20" y2="4" />
      <line x1="6" x2="6" y1="20" y2="16" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

interface BarButtonProps {
  onClick?: () => void;
  to?: string;
  title: string;
  ariaLabel?: string;
  children: ReactNode;
  testId?: string;
}

/**
 * Visual style shared by every top-bar affordance. `cf-btn-ghost` from
 * the design tokens, plus a bit of horizontal padding to keep the icon
 * + label legible at this scale.
 */
function BarButton({
  onClick,
  to,
  title,
  ariaLabel,
  children,
  testId,
}: BarButtonProps) {
  const className =
    "cf-btn-ghost no-underline gap-1.5 px-3 py-1.5 text-[10px] tracking-[0.2em]";
  if (to) {
    return (
      <Link
        to={to}
        title={title}
        aria-label={ariaLabel ?? title}
        data-interactive
        data-testid={testId}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      data-interactive
      data-testid={testId}
      className={className}
    >
      {children}
    </button>
  );
}

export function TopToolbar({
  slug,
  currentSlide,
  currentPhase,
}: TopToolbarProps) {
  const presenterMode = usePresenterMode();
  const isNear = useNearViewportTop();

  const onTheme = useCallback(() => {
    dispatchSyntheticKey("t");
  }, []);
  const onSlides = useCallback(() => {
    dispatchSyntheticKey("m");
  }, []);
  const onSettings = useCallback(() => {
    dispatchSyntheticKey("s");
  }, []);

  // Build the deep link to the admin viewer at the current cursor.
  const studioDeepLink = `/admin/decks/${encodeURIComponent(
    slug,
  )}?slide=${currentSlide}&phase=${currentPhase}`;

  return (
    <div
      data-no-advance
      data-testid="top-toolbar"
      data-visible={isNear ? "true" : "false"}
      className={`fixed left-0 right-0 top-0 z-40 flex items-center justify-between gap-2 border-b border-cf-border bg-cf-bg-100/95 px-4 py-2 backdrop-blur-[2px] transition-opacity duration-200 ease-out ${
        isNear ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      {/* Left cluster — always visible */}
      <div className="flex items-center gap-1.5">
        <BarButton to="/" title="Home" testId="top-toolbar-home">
          <HomeIcon />
          <span>Home</span>
        </BarButton>
        <BarButton to="/admin" title="Studio" testId="top-toolbar-studio">
          <StudioIcon />
          <span>Studio</span>
        </BarButton>
        <BarButton
          onClick={onSettings}
          title="Settings (S)"
          testId="top-toolbar-settings"
        >
          <SettingsIcon />
          <span>Settings</span>
        </BarButton>
      </div>

      {/* Right cluster — context-dependent */}
      <div className="flex items-center gap-1.5">
        {presenterMode ? (
          <>
            <BarButton
              onClick={onTheme}
              title="Theme overrides (T)"
              testId="top-toolbar-theme"
            >
              <PaletteIcon />
              <span>Theme</span>
            </BarButton>
            <BarButton
              onClick={onSlides}
              title="Slide manager (M)"
              testId="top-toolbar-slides"
            >
              <ListIcon />
              <span>Slides</span>
            </BarButton>
            <BarButton
              to={`/admin/decks/${encodeURIComponent(slug)}/analytics`}
              title="Analytics"
              testId="top-toolbar-analytics"
            >
              <ChartIcon />
              <span>Analytics</span>
            </BarButton>
          </>
        ) : (
          <BarButton
            to={studioDeepLink}
            title="Open this slide in Studio"
            testId="top-toolbar-open-in-studio"
          >
            <ExternalLinkIcon />
            <span>Open in Studio</span>
          </BarButton>
        )}
      </div>
    </div>
  );
}
