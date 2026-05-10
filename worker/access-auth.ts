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
 * Service-token client ID header. Set by callers, MAY be forwarded by
 * Cloudflare Access to the origin (the behaviour is undocumented and
 * has been observed to vary). Kept as an accepted signal here for
 * defence in depth — Access strips client-set `cf-access-*` headers,
 * so if the header is present at all it was added by Access.
 */
const ACCESS_CLIENT_ID_HEADER = "cf-access-client-id";

/**
 * Cloudflare Access JWT assertion. Set by Access on EVERY validated
 * request — interactive user logins AND service tokens. This is the
 * canonical signal that a request passed Access; the user-email and
 * client-id headers are only set for specific auth flows.
 *
 * Trust model: same as the other `cf-access-*` headers. Access strips
 * any client-set `cf-access-*` headers at the edge and only re-adds
 * them after a successful auth challenge. Verifying the JWT signature
 * against the team's Access JWKS would be a future hardening; for v1
 * we trust the edge to gate header presence correctly.
 *
 * Why service tokens land here, not on `cf-access-client-id`: empirical
 * testing on 2026-05-10 showed Access does NOT forward
 * `cf-access-client-id` to the origin for service-token requests
 * (verified via `wrangler tail`). The only `cf-access-*` headers the
 * Worker actually receives for a service-token request are
 * `cf-access-jwt-assertion` and the `CF_Authorization` cookie. So this
 * is the load-bearing signal for service-token auth.
 */
const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

const FORBIDDEN_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

/**
 * Validates that the request was authenticated by Cloudflare Access.
 * Accepts any of three signals (any one is sufficient):
 *   - `cf-access-authenticated-user-email` — interactive user login
 *   - `cf-access-jwt-assertion` — set on every Access-validated request
 *     (works for both interactive logins and service tokens)
 *   - `cf-access-client-id` — service-token request (rarely forwarded
 *     by Access, kept for defence in depth)
 *
 * Returns a 403 `Response` if none of the three signals are present,
 * or `null` if the request should proceed. Pattern:
 * `const denied = requireAccessAuth(req); if (denied) return denied;`
 */
export function requireAccessAuth(request: Request): Response | null {
  const email = request.headers.get(ACCESS_EMAIL_HEADER);
  const clientId = request.headers.get(ACCESS_CLIENT_ID_HEADER);
  const jwt = request.headers.get(ACCESS_JWT_HEADER);
  const hasEmail = !!email && email.trim() !== "";
  const hasClientId = !!clientId && clientId.trim() !== "";
  const hasJwt = !!jwt && jwt.trim() !== "";
  if (!hasEmail && !hasClientId && !hasJwt) {
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
