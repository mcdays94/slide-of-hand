/**
 * React hook for the GitHub OAuth connection status.
 *
 * Polls `/api/admin/auth/github/status` once on mount + on demand
 * via the returned `refetch`. The status drives the Settings UI's
 * "Connect GitHub" / "Connected as @<username>" row. See
 * `worker/github-oauth.ts` for the endpoint contract and trust model.
 *
 * State machine:
 *   - `"checking"` — initial state, before the probe resolves.
 *     Render as a neutral / loading placeholder.
 *   - `"connected"` — the user has a stored GitHub token. `username`,
 *     `scopes`, and `connectedAt` are populated.
 *   - `"disconnected"` — the user has no stored token, or the
 *     probe was redirected by Access (treat as not-connected).
 *
 * `disconnect()` calls `POST /api/admin/auth/github/disconnect` and
 * flips the local state to `"disconnected"` on success. Callers can
 * call `refetch()` after kicking off a connect flow (the connect
 * redirect lives on the OAuth `start` endpoint, so the SPA opens it
 * in a popup OR navigates to it directly — both paths land back here
 * with a `?github_oauth=connected` query flag that the consumer can
 * pick up and trigger a refetch).
 */
import { useCallback, useEffect, useState } from "react";

const STATUS_PATH = "/api/admin/auth/github/status";
const DISCONNECT_PATH = "/api/admin/auth/github/disconnect";
const START_PATH = "/api/admin/auth/github/start";

export type GitHubConnectionState = "checking" | "connected" | "disconnected";

export interface GitHubConnection {
  state: GitHubConnectionState;
  username: string | null;
  scopes: string[];
  connectedAt: number | null;
  refetch: () => void;
  disconnect: () => Promise<void>;
  /**
   * Returns the OAuth start URL with `returnTo` set to the current
   * `window.location.pathname + search`. Consumers can put it on an
   * `<a href={...}>` so a user click triggers a top-level navigation
   * (the OAuth flow requires a real browser redirect; a `fetch()` won't
   * work because GitHub renders its authorize page as HTML).
   */
  startUrl: () => string;
}

interface StatusResponse {
  connected: boolean;
  username?: string;
  userId?: number;
  scopes?: string[];
  connectedAt?: number;
}

export function useGitHubOAuth(): GitHubConnection {
  const [state, setState] = useState<GitHubConnectionState>("checking");
  const [username, setUsername] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);

  const refetch = useCallback(() => {
    let canceled = false;
    async function go() {
      setState("checking");
      try {
        const resp = await fetch(STATUS_PATH, {
          method: "GET",
          redirect: "manual",
          credentials: "include",
        });
        if (canceled) return;
        if (resp.type === "opaqueredirect" || !resp.ok) {
          setState("disconnected");
          setUsername(null);
          setScopes([]);
          setConnectedAt(null);
          return;
        }
        const body = (await resp.json()) as StatusResponse;
        if (canceled) return;
        if (body.connected) {
          setState("connected");
          setUsername(body.username ?? null);
          setScopes(body.scopes ?? []);
          setConnectedAt(body.connectedAt ?? null);
        } else {
          setState("disconnected");
          setUsername(null);
          setScopes([]);
          setConnectedAt(null);
        }
      } catch {
        if (canceled) return;
        // Network error — treat as disconnected so the UI prompts a
        // reconnect rather than spinning forever.
        setState("disconnected");
        setUsername(null);
        setScopes([]);
        setConnectedAt(null);
      }
    }
    void go();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const cleanup = refetch();
    return cleanup;
  }, [refetch]);

  const disconnect = useCallback(async () => {
    try {
      const resp = await fetch(DISCONNECT_PATH, {
        method: "POST",
        redirect: "manual",
        credentials: "include",
      });
      if (resp.type === "opaqueredirect" || !resp.ok) {
        // Access kicked us out, or the Worker errored. Trigger a
        // refetch so the UI re-syncs to the actual state.
        refetch();
        return;
      }
      setState("disconnected");
      setUsername(null);
      setScopes([]);
      setConnectedAt(null);
    } catch {
      // Network error. Re-sync.
      refetch();
    }
  }, [refetch]);

  const startUrl = useCallback(() => {
    const returnTo =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "/admin";
    return `${START_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  return {
    state,
    username,
    scopes,
    connectedAt,
    refetch,
    disconnect,
    startUrl,
  };
}
