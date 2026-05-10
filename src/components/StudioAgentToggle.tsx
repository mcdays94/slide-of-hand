/**
 * `<StudioAgentToggle>` — the sparkle button shown in the EditMode
 * toolbar that opens the in-Studio AI chat panel (issue #131 phase 1).
 *
 * This is a tiny controlled component: the parent owns the open/closed
 * state. We keep the toggle dumb so EditMode can decide what to do
 * with the state (mount the panel under a Suspense, fire analytics,
 * close on save, etc.) without this component having to know about
 * any of that.
 *
 * Visual language:
 *   - Sparkle icon (`lucide-react/Sparkles`) — same icon family already
 *     used by the cf-dynamic-workers deck, so we're not introducing a
 *     new icon vocabulary.
 *   - Same `cf-btn-ghost` shape as the other toolbar buttons (Settings,
 *     Reset, Close) so it visually belongs.
 *   - `aria-expanded` so screen readers announce the toggle state.
 *   - `data-interactive` so the deck's click-to-advance handler (which
 *     EditMode doesn't use, but the toggle could be reused inside a
 *     viewer-mode chrome later) doesn't treat clicks on this button
 *     as a slide advance.
 */
import { Sparkles } from "lucide-react";

export interface StudioAgentToggleProps {
  /** Whether the chat panel is currently open. */
  open: boolean;
  /** Called when the user clicks the toggle. The parent toggles its own state. */
  onToggle: () => void;
}

export function StudioAgentToggle({ open, onToggle }: StudioAgentToggleProps) {
  return (
    <button
      type="button"
      data-interactive
      data-testid="studio-agent-toggle"
      aria-expanded={open}
      aria-label={open ? "Close AI assistant" : "Open AI assistant"}
      title={open ? "Close AI assistant" : "Open AI assistant"}
      onClick={onToggle}
      className="cf-btn-ghost inline-flex items-center gap-1.5"
    >
      <Sparkles
        size={14}
        // The icon picks up the orange accent only when the panel is
        // open — gives the user a quiet "this is active" signal
        // without yelling. Closed state is the standard ghost-button
        // muted look that matches Settings / Reset / Close.
        className={open ? "text-cf-orange" : ""}
        aria-hidden="true"
      />
      <span>AI</span>
    </button>
  );
}
