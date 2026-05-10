/**
 * Defense-in-depth Access JWT validation for `/api/admin/*` endpoints.
 *
 * Cloudflare Access is configured to gate `/api/admin/*` paths in the
 * dashboard (see `docs/deploy.md` and the Access app `Slide of Hand
 * Admin`). When Access intercepts a request, it sets the
 * `cf-access-authenticated-user-email` header (and optionally a JWT in
 * `cf-access-jwt-assertion`) before the request reaches the Worker.
 *
 * ## Why this helper exists
 *
 * Earlier versions of the Worker (PRs #22, #24, #26) relied solely on the
 * Access app to gate `/api/admin/*`. This was fragile: the Access app's
 * `self_hosted_domains` list is configured separately from the Worker
 * routes, and a misconfiguration silently fails open — the Worker
 * happily processes any request that reaches it. We discovered this
 * exact failure mode on 2026-05-06 when the `/api/admin/*` paths were
 * NOT covered by the Access app's `/admin/*` rules (see
 * `skill-observations/log.md` Observation #8 for the post-mortem). The
 * fix added the missing rules to the Access app, but defense-in-depth
 * dictates that the Worker should ALSO validate the auth signal so a
 * future misconfiguration fails closed instead of open.
 *
 * ## What the helper does
 *
 * `requireAccessAuth(request)` returns:
 *   - `null` when the request carries `cf-access-authenticated-user-email`
 *     with a non-empty value — i.e. Access intercepted the request and
 *     authenticated the caller. The handler should proceed.
 *   - A `403 Forbidden` `Response` when the header is absent or empty —
 *     i.e. the request bypassed Access (either misconfiguration, direct
 *     Worker access via `*.workers.dev` not gated by Access, or a
 *     spoofing attempt). The handler should return this response without
 *     doing any work.
 *
 * ## What the helper does NOT do
 *
 * - It does NOT validate the Access JWT signature. If a caller crafts a
 *   request with a forged `cf-access-authenticated-user-email` header,
 *   this helper accepts it. The protection model assumes Cloudflare's
 *   edge — the only path into a CF Worker — strips client-set
 *   `cf-access-*` headers and only re-adds them after a successful
 *   Access challenge. This is documented Cloudflare behaviour. A
 *   future hardening could verify the JWT signature against
 *   `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, but for
 *   v1 the trust-the-edge model is sufficient.
 *
 * - It does NOT enforce a specific user (everyone in the Access policy is
 *   currently allowed). To restrict to specific emails, layer that check
 *   on top by reading the email value and comparing against an allow-list.
 */

const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";

/**
 * Service-token client ID header (#131 phase 1). Set by Cloudflare
 * Access when a request authenticates with a service token (the
 * `CF-Access-Client-Id` / `CF-Access-Client-Secret` pair) rather than
 * an interactive user login. Service tokens are how scripts, CI, and
 * agents (including this Worker's own admin API consumers) hit Access-
 * protected endpoints without a browser session.
 *
 * Service tokens do NOT set the email header — they have no user
 * identity. So `requireAccessAuth` must accept either signal: the
 * presence of EITHER `cf-access-authenticated-user-email` OR
 * `cf-access-client-id` is sufficient evidence that Access vetted
 * the request.
 *
 * Trust model: same as the email header — Cloudflare strips client-set
 * `cf-access-*` headers at the edge and only re-adds them after a
 * successful Access challenge. JWT signature verification is a future
 * hardening, deferred per the existing header comment block.
 */
const ACCESS_CLIENT_ID_HEADER = "cf-access-client-id";

const FORBIDDEN_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

/**
 * Validates that the request was authenticated by Cloudflare Access.
 * Accepts either:
 *   - `cf-access-authenticated-user-email` — interactive user login
 *   - `cf-access-client-id` — service-token authentication
 *
 * Returns a 403 `Response` if neither header is present, or `null`
 * if the request should proceed. Pattern:
 * `const denied = requireAccessAuth(req); if (denied) return denied;`
 */
export function requireAccessAuth(request: Request): Response | null {
  const email = request.headers.get(ACCESS_EMAIL_HEADER);
  const clientId = request.headers.get(ACCESS_CLIENT_ID_HEADER);
  const hasEmail = !!email && email.trim() !== "";
  const hasClientId = !!clientId && clientId.trim() !== "";
  if (!hasEmail && !hasClientId) {
    return new Response(
      JSON.stringify({
        error:
          "forbidden — this endpoint requires Cloudflare Access authentication",
      }),
      { status: 403, headers: FORBIDDEN_HEADERS },
    );
  }
  return null;
}

/**
 * Optional helper: read the authenticated user's email when available.
 * Returns the value of `cf-access-authenticated-user-email`, or `null`
 * if the header is absent. Useful for audit-logging which user made a
 * given write. Callers should still call `requireAccessAuth()` first to
 * gate the request.
 */
export function getAccessUserEmail(request: Request): string | null {
  const email = request.headers.get(ACCESS_EMAIL_HEADER);
  return email && email.trim() !== "" ? email.trim() : null;
}
