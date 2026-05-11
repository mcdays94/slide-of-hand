/**
 * `<GitHubConnectRow>` — the Settings-modal row that lets an admin
 * user connect or disconnect their GitHub account for use with the
 * in-Studio AI agent's `commitPatch` tool (issue #131 phase 3).
 *
 * Visual states:
 *   - `"checking"` — neutral placeholder while we probe
 *     `/api/admin/auth/github/status`. Cheap and short-lived.
 *   - `"disconnected"` — "Connect GitHub" link styled as a primary
 *     button. Click navigates the browser to the OAuth start URL
 *     (a top-level navigation is required — the OAuth flow needs
 *     to render GitHub's authorize page as HTML, which `fetch()`
 *     can't do).
 *   - `"connected"` — "Connected as @<username>" status + a small
 *     Disconnect button. Disconnect deletes the stored token on
 *     the Worker side.
 *
 * Gating: this component is rendered only inside admin/presenter
 * surfaces (the parent SettingsModal already gates its mount on
 * `presenterMode` via the caller). It calls Access-gated endpoints,
 * so a public-route mount would just always show "disconnected".
 *
 * Auto-refetch on connect: when the user finishes the OAuth flow,
 * the OAuth callback redirects them back here with a
 * `?github_oauth=connected` query flag. The Settings modal isn't
 * necessarily open at that point — the user lands wherever they
 * were before they hit Connect. If the modal IS open, we read the
 * flag once and trigger a refetch so the status updates instantly.
 */
import { useEffect } from "react";
import { useGitHubOAuth } from "@/lib/use-github-oauth";

interface GitHubConnectRowProps {
  /** Optional override for tests; default uses the real `useGitHubOAuth`. */
  testId?: string;
}

export function GitHubConnectRow({
  testId = "settings-modal-github-connect",
}: GitHubConnectRowProps) {
  const connection = useGitHubOAuth();

  // Pick up the post-OAuth redirect flag and trigger a refetch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("github_oauth");
    if (flag === "connected" || flag === "denied") {
      connection.refetch();
      // Clean the flag out of the URL so a future reload doesn't
      // re-trigger the refetch. Use replaceState (not pushState) so
      // we don't add a history entry.
      params.delete("github_oauth");
      const newSearch = params.toString();
      const newUrl =
        window.location.pathname +
        (newSearch ? `?${newSearch}` : "") +
        window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
    // We only want this to run once on mount — refetch is stable, but
    // adding it to deps would re-fire if the hook re-creates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="flex items-start justify-between gap-4 py-4"
      data-testid={testId}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-cf-text">GitHub</p>
        <p className="mt-1 text-xs text-cf-text-muted">
          Connect your GitHub account so the in-Studio AI agent can commit
          deck changes on your behalf. Each commit is attributed to your
          GitHub identity. Disconnect anytime; revoke at{" "}
          <a
            href="https://github.com/settings/applications"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-cf-border hover:decoration-cf-text"
            data-interactive
          >
            GitHub → Applications
          </a>
          .
        </p>

        {connection.state === "connected" && connection.username && (
          <p
            className="mt-2 inline-flex items-center gap-1.5 rounded border border-cf-orange/40 bg-cf-orange/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-orange"
            data-testid={`${testId}-status-connected`}
          >
            <span aria-hidden="true">✓</span>
            <span>Connected as @{connection.username}</span>
          </p>
        )}

        {connection.state === "checking" && (
          <p
            className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-text-subtle"
            data-testid={`${testId}-status-checking`}
          >
            Checking…
          </p>
        )}
      </div>

      <div className="flex-shrink-0">
        {connection.state === "disconnected" && (
          <a
            href={connection.startUrl()}
            className="cf-btn-primary"
            data-testid={`${testId}-connect`}
            data-interactive
          >
            Connect
          </a>
        )}
        {connection.state === "connected" && (
          <button
            type="button"
            onClick={() => void connection.disconnect()}
            className="cf-btn-ghost"
            data-testid={`${testId}-disconnect`}
            data-interactive
          >
            Disconnect
          </button>
        )}
        {connection.state === "checking" && (
          <button
            type="button"
            disabled
            className="cf-btn-ghost opacity-40"
            data-testid={`${testId}-checking-button`}
            aria-hidden="true"
          >
            …
          </button>
        )}
      </div>
    </div>
  );
}
