/**
 * `<GitHubConnectGate>` — app-native modal that intercepts source-backed
 * deck lifecycle actions (Archive / Restore / Delete) when the admin
 * user is not GitHub-connected (issue #251 / PRD #242).
 *
 * Why it exists: source-backed deck lifecycle is implemented as a
 * GitHub draft PR (#247-#249, later slices). Opening a PR requires
 * the user's GitHub OAuth token — Slide of Hand never pushes directly
 * to `main`. If the admin lands on a source-deck action without
 * GitHub connected, we must show an explanatory, app-native gate (not
 * a browser `confirm`) so they understand why and can opt in.
 *
 * Visual language follows `<ConfirmDialog>` / `<TypedSlugConfirmDialog>`:
 *   - `bg-cf-text/30 backdrop-blur-sm` backdrop.
 *   - `border-cf-border bg-cf-bg-100` panel.
 *   - `cf-btn-primary` Connect CTA / Retry button.
 *   - `cf-btn-ghost` Cancel button.
 *
 * The component is intentionally dumb. It owns no internal state
 * besides the Esc handler — the parent supplies `isOpen`, the
 * `intent` shape, the current `connectionState`, the OAuth start URL,
 * and the callbacks. The parent is responsible for clearing the gate
 * after a successful retry / cancel / Connect navigation.
 *
 * Render branches by `connectionState`:
 *   - `"disconnected"` → Connect CTA (`<a href={startUrl}>`) +
 *     explanatory copy. A top-level `<a>` navigation is required
 *     because GitHub's authorize page is HTML rendered server-side.
 *   - `"checking"`     → neutral "Checking GitHub…" placeholder. No
 *     primary CTA — the parent's `useGitHubOAuth` is mid-probe.
 *   - `"connected"`    → Retry CTA. The user finished OAuth (probably
 *     in a separate tab/window); clicking Retry re-invokes the
 *     original action. The parent surfaces any retry error via the
 *     optional `retryError` prop, rendered inline.
 *
 * Test IDs follow the rest of the dialog primitives:
 *   - `github-connect-gate`              — the dialog panel.
 *   - `github-connect-gate-backdrop`     — the backdrop.
 *   - `github-connect-gate-cancel`       — Cancel button.
 *   - `github-connect-gate-connect`      — Connect CTA (disconnected).
 *   - `github-connect-gate-retry`        — Retry button (connected).
 *   - `github-connect-gate-checking`     — checking placeholder.
 *   - `github-connect-gate-error`        — inline retry error.
 */
import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
} from "framer-motion";
import { useEffect } from "react";
import { easeStandard } from "@/lib/motion";
import type { GitHubConnectionState } from "@/lib/use-github-oauth";

export type SourceLifecycleAction = "archive" | "restore" | "delete";

export interface GitHubConnectGateIntent {
  /** Which source-backed lifecycle action triggered the gate. */
  action: SourceLifecycleAction;
  /** Deck slug — kept for accessibility / debugging. */
  slug: string;
  /** Deck title shown in the body copy ("Archive **Hello**?"). */
  title: string;
}

export interface GitHubConnectGateProps {
  /** Whether the gate is currently visible. */
  isOpen: boolean;
  /**
   * The intent the gate intercepted. `null` is unusual but allowed —
   * a parent that opens the gate without an intent will still render
   * neutral copy. The current AdminIndex always supplies an intent.
   */
  intent: GitHubConnectGateIntent | null;
  /** GitHub OAuth connection state from `useGitHubOAuth()`. */
  connectionState: GitHubConnectionState;
  /** OAuth start URL — used as the `href` for the Connect CTA. */
  startUrl: string;
  /** Called when the user dismisses the gate (Cancel, Esc, backdrop). */
  onCancel: () => void;
  /** Called when the user clicks Retry (connectionState === "connected"). */
  onRetry: () => void;
  /**
   * Optional inline error surfaced after a failed Retry. Source-backed
   * archive/restore/delete are not wired in this slice — Retry surfaces
   * a friendly "not yet wired" inline error here.
   */
  retryError?: string | null;
}

const backdropMotion: HTMLMotionProps<"div"> = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15, ease: easeStandard },
};

const panelMotion: HTMLMotionProps<"div"> = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { duration: 0.18, ease: easeStandard },
};

const ACTION_VERB: Record<SourceLifecycleAction, string> = {
  archive: "archive",
  restore: "restore",
  delete: "delete",
};

export function GitHubConnectGate({
  isOpen,
  intent,
  connectionState,
  startUrl,
  onCancel,
  onRetry,
  retryError,
}: GitHubConnectGateProps) {
  // Esc cancels — only while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onCancel]);

  const actionVerb = intent ? ACTION_VERB[intent.action] : "change";
  const deckTitle = intent?.title ?? "this deck";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          {...backdropMotion}
          data-testid="github-connect-gate-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center bg-cf-text/30 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            {...panelMotion}
            role="dialog"
            aria-modal="true"
            data-testid="github-connect-gate"
            data-action={intent?.action}
            className="relative w-full max-w-md rounded-lg border border-cf-border bg-cf-bg-100 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-medium tracking-[-0.02em] text-cf-text">
              Connect GitHub to change source decks
            </h2>
            <div className="mb-5 space-y-3 text-sm text-cf-text-muted">
              <p>
                You asked to <strong>{actionVerb}</strong>{" "}
                <strong>{deckTitle}</strong>. Source-backed deck
                changes are made as GitHub draft PRs.
              </p>
              <p>
                Connect GitHub so Slide of Hand can clone the repo, run
                the Cloudflare Sandbox gate, push a branch, and open
                the PR. Slide of Hand never pushes directly to{" "}
                <code className="rounded bg-cf-bg-200 px-1 py-0.5 font-mono text-[11px]">
                  main
                </code>
                .
              </p>
              {retryError && (
                <p
                  role="alert"
                  data-testid="github-connect-gate-error"
                  className="mt-3 rounded border border-cf-orange/40 bg-cf-orange/10 px-3 py-2 text-xs text-cf-orange"
                >
                  {retryError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                data-interactive
                data-testid="github-connect-gate-cancel"
                onClick={onCancel}
                className="cf-btn-ghost"
              >
                Cancel
              </button>

              {connectionState === "disconnected" && (
                <a
                  href={startUrl}
                  data-interactive
                  data-testid="github-connect-gate-connect"
                  className="cf-btn-primary"
                >
                  Connect GitHub
                </a>
              )}

              {connectionState === "connected" && (
                <button
                  type="button"
                  data-interactive
                  data-testid="github-connect-gate-retry"
                  onClick={onRetry}
                  className="cf-btn-primary"
                >
                  Retry action
                </button>
              )}

              {connectionState === "checking" && (
                <span
                  data-testid="github-connect-gate-checking"
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle"
                >
                  Checking GitHub…
                </span>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
