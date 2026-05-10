/**
 * Client-side Cloudflare Access status probe.
 *
 * Issue #120. Used by the public-but-Access-aware presenter view to
 * decide whether to show speaker-notes editing UI. The hook fetches
 * `/api/admin/auth-status` (an Access-gated endpoint that returns
 * lightweight JSON when the caller has a valid session) and surfaces
 * one of three states:
 *
 *   - `"checking"` — initial state, before the probe resolves. Treat
 *     as read-only to avoid a flash of editable UI.
 *   - `"authenticated"` — the probe returned `{ authenticated: true }`,
 *     so the caller has a valid Access session and can edit.
 *   - `"unauthenticated"` — the probe was redirected by Access (visible
 *     to fetch as `response.type === "opaqueredirect"` thanks to the
 *     `redirect: "manual"` mode) or returned a non-2xx, so editing is
 *     read-only and we should prompt the user to sign in.
 *
 * The hook is single-shot per mount. Auth state is unlikely to change
 * within a session; on a longer-running session a manual reload
 * re-runs the probe, which is acceptable for v1.
 */
import { useEffect, useState } from "react";

export type AccessAuthStatus = "checking" | "authenticated" | "unauthenticated";

const AUTH_STATUS_PATH = "/api/admin/auth-status";

export function useAccessAuth(): AccessAuthStatus {
  const [status, setStatus] = useState<AccessAuthStatus>("checking");

  useEffect(() => {
    let canceled = false;
    async function check() {
      try {
        const resp = await fetch(AUTH_STATUS_PATH, {
          method: "GET",
          // `redirect: "manual"` ensures Access's 302 to its login URL
          // surfaces as an opaque-redirect response we can detect,
          // rather than the browser silently following the redirect
          // and us getting back the login page's HTML body.
          redirect: "manual",
          // Send cookies so Access's session cookie (if any) reaches
          // the edge.
          credentials: "include",
        });
        if (canceled) return;
        // `opaqueredirect` is the manual-redirect signal. Any non-OK
        // status (including the defense-in-depth 403 from the Worker
        // when Access misconfigures) also counts as unauthenticated.
        if (resp.type === "opaqueredirect" || !resp.ok) {
          setStatus("unauthenticated");
          return;
        }
        const json = (await resp.json()) as { authenticated?: boolean };
        setStatus(json?.authenticated === true ? "authenticated" : "unauthenticated");
      } catch {
        if (!canceled) setStatus("unauthenticated");
      }
    }
    check();
    return () => {
      canceled = true;
    };
  }, []);

  return status;
}
