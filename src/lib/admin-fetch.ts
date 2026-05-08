/**
 * Shared admin-write helpers — used by hooks that POST/DELETE to
 * `/api/admin/*` from the browser.
 *
 * `wrangler dev` does NOT run Cloudflare Access locally, so the
 * `cf-access-authenticated-user-email` header is never set in dev — and
 * `requireAccessAuth` (defense-in-depth in the Worker) refuses writes
 * without it. To unblock save-flow probes locally, this module detects
 * localhost and injects a placeholder header so the round-trip succeeds.
 *
 * In production the browser does NOT set this header. Cloudflare Access
 * at the edge populates it after auth, and `requireAccessAuth` reads
 * whatever Access put there. Forging this header in production would
 * NOT bypass Access — the edge strips client-set `cf-access-*` headers
 * before the request reaches the Worker.
 *
 * The original copy of this helper lives in `useElementOverrides.ts`
 * (`adminWriteHeaders`); this module exists so Slice 6+ hooks
 * (`useDeckEditor`) don't drift from that single source of truth. A
 * follow-up commit can refactor `useElementOverrides` to use this
 * module too.
 */

/**
 * Build the headers for an admin write. Adds `content-type: application/json`
 * by default; in dev (localhost / `*.localhost` / 127.0.0.1) also injects
 * a placeholder Access email so the Worker's `requireAccessAuth` returns
 * null and the request proceeds.
 */
export function adminWriteHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...extra,
  };
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocalhost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".localhost");
    if (isLocalhost) {
      headers["cf-access-authenticated-user-email"] = "dev@local";
    }
  }
  return headers;
}
