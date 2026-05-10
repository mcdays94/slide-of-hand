/**
 * Lightweight Access-status probe for the SPA client.
 *
 * Issue #120. The presenter view (`/decks/<slug>?presenter=1`) is a
 * public route, so any visitor lands on the same page including the
 * speaker-notes editor. Today the editor is fully editable for any
 * visitor — they only edit their own browser's localStorage, so other
 * presenters are unaffected, but the UX is confusing and any future
 * shared-notes API would need server-side gating.
 *
 * This endpoint lets the client know whether the current request has
 * an authenticated Cloudflare Access session, so the editor UI can
 * adapt: editable when authenticated, read-only with a sign-in hint
 * otherwise.
 *
 * The endpoint sits behind Access (the path is `/api/admin/auth-status`,
 * which is covered by the same `/api/admin/*` rule as every other
 * admin API). When called by an authenticated browser, Access adds the
 * `cf-access-authenticated-user-email` header and the request reaches
 * the Worker, which returns `{ authenticated: true, email }`. When
 * called by an unauthenticated browser, Access intercepts and returns
 * its 302 to the login URL — the client uses `redirect: "manual"` so
 * the fetch surfaces an `opaqueredirect` response, which the client
 * treats as `unauthenticated`. No JWT inspection on the Worker side;
 * the existing defense-in-depth `requireAccessAuth()` is enough.
 */
import { getAccessUserEmail, requireAccessAuth } from "./access-auth";

// No bindings required — this endpoint is purely header-driven.
// Empty interface to keep the env-type shape extensible by the
// composing Worker entry, matching the convention used by the other
// route modules.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AuthStatusEnv {}

const AUTH_STATUS_PATH = "/api/admin/auth-status";

export async function handleAuthStatus(
  request: Request,
  _env: AuthStatusEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== AUTH_STATUS_PATH) return null;
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "method not allowed" }),
      {
        status: 405,
        headers: {
          "content-type": "application/json",
          allow: "GET",
          "cache-control": "no-store",
        },
      },
    );
  }

  // Defense-in-depth: even though Access SHOULD intercept any request
  // without a session before it reaches the Worker, we also enforce
  // the auth header here. A 403 from this branch indicates a
  // misconfigured Access app rather than a normal unauthenticated
  // visitor (those see Access's 302 and never reach the Worker).
  const denied = requireAccessAuth(request);
  if (denied) return denied;

  const email = getAccessUserEmail(request);
  return new Response(
    JSON.stringify({ authenticated: true, email }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}
