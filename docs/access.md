# Cloudflare Access — gated paths + app setup

Authoritative reference for the Access-protected surface of the Slide of Hand Worker, plus a copy-paste-ready Cloudflare API payload for re-creating the Access app from scratch.

Companion to [`docs/deploy.md`](deploy.md). `deploy.md` covers the **dashboard-driven** Access setup as a step in the first-time deploy. This doc covers the **API-driven** equivalent (for scripting, disaster recovery, or fresh-environment provisioning) and the full inventory of paths the Worker expects Access to gate.

> **Scope.** This doc describes the live production deployment at `slideofhand.lusostreams.com`. Local `wrangler dev` does NOT enforce Access — every `/admin/*` and `/api/admin/*` path is reachable in dev without a JWT. See `worker/agent.ts` lines 688–745 for the localhost dev fallback that lets the Studio chat the agent without a real Access session.

---

## 1. Architecture overview

- **Access enforces at the Cloudflare edge.** A request to `slideofhand.lusostreams.com/<path>` that matches a configured Access self-hosted domain is intercepted by Cloudflare's edge BEFORE it reaches the Worker. Unauthenticated browsers get a 302 to the team's `*.cloudflareaccess.com` login. Service-token requests with valid `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers are exchanged for a JWT and passed through.
- **The Worker validates defence-in-depth via `requireAccessAuth()`.** Defined in [`worker/access-auth.ts`](../worker/access-auth.ts); accepts any one of three headers as a sufficient signal that Access let the request through: `cf-access-jwt-assertion`, `cf-access-authenticated-user-email`, or `cf-access-client-id`. Missing all three → `403 Forbidden`. This pair (edge-level Access + Worker-level header check) is what failed-open behaviour during the 2026-05-06 Access misconfiguration (skill log Observation #8) is designed to prevent: the Access app's path list is configured separately from the Worker routes, so if a future edit drops `/api/admin/*` from the Access app, the Worker still rejects the request.
- **2026-05-10 empirical finding.** On **service-token** auth flows, only `cf-access-jwt-assertion` is reliably forwarded by Access. `cf-access-authenticated-user-email` only appears on **interactive cookie** flows (a real human logged in via the IdP). `cf-access-client-id` is NOT forwarded for service-token requests, despite the widely-circulated assumption that it is — verified via `wrangler tail`. See `~/.config/opencode/AGENTS.md` ("Cloudflare Access service tokens forward `cf-access-jwt-assertion`, NOT `cf-access-client-id`") for the underlying observation. The Worker's three-signal check works for both flow types because at least one signal will always be present: email for browser users, JWT for service tokens.
- **Two authentication flows.**
  - **Interactive cookie flow.** A human visits `/admin` in a browser. Access serves a login page, the IdP authenticates, Access drops a `CF_Authorization` cookie. Subsequent requests carry the cookie and Access forwards `cf-access-authenticated-user-email` + `cf-access-jwt-assertion` to the Worker.
  - **Service-token flow (machine-to-machine).** An automated probe or external tool sends `CF-Access-Client-Id: <id>.access` + `CF-Access-Client-Secret: <secret>` headers. Access validates, mints a short-lived JWT, and forwards `cf-access-jwt-assertion` to the Worker. NO email header, NO client-id header at the origin.
- **Routes that opt out of Access.** The public site is intentionally NOT gated: `/`, `/decks/<slug>`, the SPA assets at `/assets/*`, the public REST reads (`GET /api/themes/<slug>`, `GET /api/manifests/<slug>`, `GET /api/decks`, `GET /api/decks/<slug>`, `GET /api/element-overrides/<slug>`, `GET /images/<key>`), the analytics ingestion endpoint (`POST /api/beacon`), and the audience-visible demo backends (`/api/cf-code-mode/*`, `/api/cf-dynamic-workers/*`). See the table below for the canonical list.
- **Access app NEVER deploys via Wrangler.** Access lives in the Cloudflare Zero Trust dashboard (or the `/accounts/<id>/access/apps` API). `npm run deploy` does NOT touch it. After this doc's payload is POSTed once, every subsequent Worker deploy leaves the Access config untouched. Conversely, editing the Access app does NOT require a Worker redeploy.

---

## 2. Path inventory

Every URL pattern handled by the Worker, in the order `worker/index.ts` dispatches them. The "Protected?" column refers to the **expected** state — both edge-level Access AND the Worker-level `requireAccessAuth` check where applicable.

| Path | Method(s) | Protected? | Handler | Notes |
|---|---|---|---|---|
| `/api/admin/auth-status` | GET | Yes (Access + Worker check) | `worker/auth-status.ts` | Probe the SPA uses to detect whether the current browser has a live Access session. Used by the speaker-notes editor (issue #120) to decide editable-vs-readonly. |
| `/api/themes/<slug>` | GET, HEAD | No (public) | `worker/themes.ts` | Audience read of per-deck theme overrides from KV. |
| `/api/admin/themes/<slug>` | POST | Yes (Access + Worker check) | `worker/themes.ts` | Author writes theme overrides. |
| `/api/manifests/<slug>` | GET, HEAD | No (public) | `worker/manifests.ts` | Audience read of per-deck slide manifest. |
| `/api/admin/manifests/<slug>` | POST | Yes (Access + Worker check) | `worker/manifests.ts` | Author writes manifest (slide reorder, hide/unhide, runtime). |
| `/api/beacon` | POST | No (public) | `worker/analytics.ts` | Audience-side beacon ingestion. No PII; aggregated counts only. |
| `/api/admin/analytics/<slug>` | GET, HEAD | Yes (Access + Worker check) | `worker/analytics.ts` | Author reads analytics rollups. |
| `/api/element-overrides/<slug>` | GET, HEAD | No (public) | `worker/element-overrides.ts` | Audience read of per-slide element overrides. |
| `/api/admin/element-overrides/<slug>` | POST | Yes (Access + Worker check) | `worker/element-overrides.ts` | Author writes element overrides. |
| `/api/decks` | GET, HEAD | No (public) | `worker/decks.ts` | Audience list of KV-backed decks. |
| `/api/decks/<slug>` | GET, HEAD | No (public) | `worker/decks.ts` | Audience read of a single deck. |
| `/api/admin/decks` | GET, HEAD | Yes (Access + Worker check) | `worker/decks.ts` | Author list (includes drafts). |
| `/api/admin/decks/<slug>` | GET, HEAD, POST, DELETE | Yes (Access + Worker check) | `worker/decks.ts` | Author CRUD on a single deck. |
| `/images/<key>` | GET, HEAD | No (public) | `worker/images.ts` | Audience-visible image serve from R2. |
| `/api/admin/images/<slug>` | GET, HEAD, POST | Yes (Access + Worker check) | `worker/images.ts` | Author upload + index per deck. |
| `/api/admin/images/<slug>/<hash>` | DELETE | Yes (Access + Worker check) | `worker/images.ts` | Author delete by content hash. |
| `/api/admin/agents/*` | GET (WebSocket upgrade), POST, … | Yes (Access + Worker check) | `worker/agent.ts` → `DeckAuthorAgent` Durable Object | In-Studio AI agent surface (issue #131). Handles both HTTP and WebSocket via `routeAgentRequest` from the `agents` SDK. Local-dev allows a `?cf-access-auth-email=…` query-param fallback for WebSocket handshakes that cannot carry headers — gated by a `cf-connecting-ip` loopback check so production cannot exercise it. |
| `/api/admin/auth/github/start` | GET | Yes (Access + Worker check) | `worker/github-oauth.ts` | Begin per-user GitHub OAuth flow for the agent's `commitPatch` tool. Requires a real user email (no service tokens). |
| `/api/admin/auth/github/callback` | GET | Yes (Access + Worker check) | `worker/github-oauth.ts` | GitHub OAuth callback. |
| `/api/admin/auth/github/status` | GET | Yes (Access + Worker check) | `worker/github-oauth.ts` | Probe whether the current Access user has a linked GitHub account. |
| `/api/admin/auth/github/disconnect` | POST | Yes (Access + Worker check) | `worker/github-oauth.ts` | Revoke the user's stored GitHub token. |
| `/api/admin/sandbox/_smoke` | GET, POST | Yes (Access + Worker check) | `worker/sandbox-smoke.ts` | Diagnostic for the Cloudflare Sandbox SDK binding (issue #131 phase 3c). |
| `/api/admin/skills/cloudflare-deck-template` | GET | Yes (Access + Worker check) | `worker/skill-composer.ts` | Serves a composed Markdown skill describing the deck-authoring contract. Consumed by external AI harnesses (Opencode / Claude Code / Codex) via service token. |
| `/api/admin/mcp-servers` | GET, POST | Yes (Access + Worker check) | `worker/mcp-servers.ts` | Per-user MCP server registry collection (issue #168 Wave 6). |
| `/api/admin/mcp-servers/<id>` | GET, PATCH, DELETE | Yes (Access + Worker check) | `worker/mcp-servers.ts` | Per-user MCP server registry item. |
| `/api/admin/setup/deck-starter` | POST | Yes (Access + Worker check) | `worker/deck-starter-setup.ts` | Idempotent one-shot that creates the deck-starter Artifacts repo. Service-token auth is fine for this. |
| `/api/admin/_diag/artifacts` | GET, POST | Yes (Access + Worker check) | `worker/diag-artifacts.ts` | Diagnostic for the ARTIFACTS binding. Service-token auth recommended for automated probes. |
| `/api/admin/_diag/worker-loader` | GET, POST | Yes (Access + Worker check) | `worker/diag-worker-loader.ts` | Diagnostic for the LOADER binding. Service-token auth recommended for automated probes. |
| `/api/cf-dynamic-workers/*` | GET, POST | No (public) | `worker/cf-dynamic-workers/index.ts` | Live-demo backend for slide 08 of a public deck. Includes `/health`, `/spawn`, `/spawn-many`, `/spawn/globe`, `/session/<id>/*`. |
| `/__internal/ai-proxy` | POST | No (public, but unprefixed) | `worker/cf-dynamic-workers/index.ts` | Loopback endpoint that spawned dynamic isolates call via `SELF`-bound globalOutbound to reach the AI binding. Unprefixed because the snippet source is shown on the slide — the cleaner path reads better in the demo. Path is path-public but functionally only callable from a spawned isolate. |
| `/api/cf-code-mode/*` | GET, POST | No (public) | `worker/cf-code-mode/index.ts` | Live-demo backend for slide 12 (MCP-vs-Code-Mode side-by-side). Includes `/health`, `/models`, `/prompts`, `/run-mcp` (SSE), `/run-code-mode` (SSE), `/__codemode` (test). |
| `/preview/*` | GET | **Not currently gated** (STUB returns 501) | `worker/preview-route.ts` | **⚠ Surprise:** the file header says "Admin-gated via `requireAccessAuth`" but the path is NOT under `/admin` / `/api/admin`, so Access does not gate it at the edge, AND the current stub does NOT call `requireAccessAuth`. The stub returns 501 for every request, so there is no leak today, but when Worker A wires up the body it MUST add `requireAccessAuth` AND the path pattern MUST be added to the Access app's domain list — OR the path needs to move under `/api/admin/preview/*`. Tracked indirectly under issue #168 Wave 1 / Worker A. |
| `/admin/*` | GET (SPA) | Yes (Access at edge only) | Static Assets binding → `index.html` | The admin SPA shell. Access gates at the edge so an unauthenticated browser sees the login page; the React app behind it is just `index.html` and the bundled JS. No Worker code runs (well — `applyCacheControl` does, but it sees a request that already passed Access). |
| `/decks/<slug>` | GET (SPA) | No (public) | Static Assets binding → `index.html` | Audience deck viewer. SPA route — React Router resolves the slug client-side and reads from `/api/decks/<slug>`. |
| `/` | GET (SPA) | No (public) | Static Assets binding → `index.html` | Public deck index. |
| `/assets/<hash>.<ext>` | GET | No (public) | Static Assets binding | Vite-hashed JS/CSS/font bundles. |
| Everything else | GET | No (public) | Static Assets binding (`not_found_handling: single-page-application` → `index.html`) | SPA fallback for any path React Router owns. |

**Counts.** 21 Access-gated routes (16 distinct URL patterns at the Worker level + the `/admin/*` SPA covered at the edge + auth-status + the four GitHub-OAuth subroutes). 13 public routes / patterns. 1 unprotected surprise (`/preview/*`) that is currently a 501 stub.

---

## 3. Access app configuration template

The production Access app covers two URL patterns under one app: the SPA shell (`/admin/*`) AND the admin API surface (`/api/admin/*`). A single app with multiple `self_hosted_domains` is the simpler, recommended structure — both patterns share the same identity rules, the same session duration, and the same allow-list, so splitting them into two apps would just duplicate maintenance.

> **Why one app, not two.** Cloudflare's Access self-hosted application supports multiple `domain` / `self_hosted_domains` entries, each matching a `hostname/path` prefix independently. Listing both `slideofhand.lusostreams.com/admin` and `slideofhand.lusostreams.com/api/admin` in the same app means: same policies, same IdPs, same session duration apply uniformly. Splitting into two apps is only worth doing if the API surface needs different (looser or stricter) rules — e.g. a separate "machine-only" app for `/api/admin/*` that allows service tokens but not human IdP logins. For this codebase the rules are the same, so one app is correct. The 2026-05-06 misconfiguration that motivated the Worker-level `requireAccessAuth` check (skill log Observation #8) was caused by the API surface NOT being listed at all in the single app, not by single-vs-multiple-apps.

### Access app payload

```json
{
  "name": "Slide of Hand Admin",
  "domain": "slideofhand.lusostreams.com/admin",
  "self_hosted_domains": [
    "slideofhand.lusostreams.com/admin",
    "slideofhand.lusostreams.com/api/admin"
  ],
  "type": "self_hosted",
  "session_duration": "24h",
  "auto_redirect_to_identity": false,
  "allowed_idps": ["<REPLACE_ME_IDP_UUID>"],
  "cors_headers": {
    "allowed_methods": ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    "allow_credentials": true
  },
  "policies": [
    {
      "name": "Allow admins by email",
      "decision": "allow",
      "include": [
        { "email": { "email": "<REPLACE_ME_ADMIN_EMAIL>" } }
      ]
    },
    {
      "name": "Allow service tokens",
      "decision": "non_identity",
      "include": [
        { "service_token": { "token_id": "<REPLACE_ME_SERVICE_TOKEN_ID>" } }
      ]
    }
  ]
}
```

Field notes:
- `domain` is the primary pattern; `self_hosted_domains` adds any additional `hostname/path` patterns covered by the same rules. Both must appear in `self_hosted_domains` (the primary `domain` is NOT auto-included in some Access API versions, so listing it explicitly is the safe choice).
- `session_duration` of `"24h"` matches the production setup. Shorter sessions are friendlier for shared machines; longer is friendlier for the author.
- `auto_redirect_to_identity: false` shows the IdP picker. Set to `true` only if there's exactly one IdP and skipping the picker is desirable.
- `allowed_idps` is a list of IdP UUIDs from `/accounts/<id>/access/identity_providers`. Leaving it empty allows ALL configured IdPs on the account, which is usually NOT what you want.
- The `"non_identity"` policy is what authorises **service-token** callers — service tokens have no identity (no email), so they must be explicitly allowed by a non-identity-decision rule. Without this policy, service-token requests get a 403 at the edge.

### `curl` to create the app

```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/<REPLACE_ME_ACCOUNT_ID>/access/apps" \
  -H "Authorization: Bearer <REPLACE_ME_CF_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d @access-app.json
```

The API token needs at least `Account.Access: Apps and Policies — Edit` on the target account. Read-only tokens can `GET` an existing app's config (useful for capturing the current production payload to redact and check in here as the next iteration of this doc):

```bash
curl -sS \
  -H "Authorization: Bearer <REPLACE_ME_CF_API_TOKEN>" \
  "https://api.cloudflare.com/client/v4/accounts/<REPLACE_ME_ACCOUNT_ID>/access/apps" \
  | jq '.result[] | select(.name == "Slide of Hand Admin")'
```

### Updating an existing app

`POST` creates a new app; to update the live one, use `PUT /accounts/<id>/access/apps/<app_id>` with the same JSON body. The `app_id` comes from the GET above (`.result[].id`).

---

## 4. Service-token usage

External automation (CI probes, scripted diagnostics, AI harnesses calling `/api/admin/skills/...`) authenticates via a **service token**. Service tokens are created in **Zero Trust → Access → Service Auth → Service Tokens → Create Service Token**; the dashboard returns a `Client ID` and a `Client Secret`. The Client Secret is shown ONCE — save it in your secret store immediately.

Once the service token is attached to the Access app's `non_identity` policy (see payload above), callers authenticate with two request headers:

```
CF-Access-Client-Id:     <CLIENT_ID>.access
CF-Access-Client-Secret: <CLIENT_SECRET>
```

The `.access` suffix on the Client ID is mandatory and is part of the Client ID as displayed in the dashboard.

Cloudflare's edge validates these headers, mints a short-lived JWT, and forwards `cf-access-jwt-assertion` to the Worker. The Worker's `requireAccessAuth` accepts the JWT as a sufficient auth signal (see [`worker/access-auth.ts`](../worker/access-auth.ts)). `cf-access-authenticated-user-email` is NOT set for service-token requests, and `cf-access-client-id` is NOT reliably forwarded — the JWT is the only header that lands at the origin for this flow.

Example service-token call:

```bash
curl -sS \
  -H "CF-Access-Client-Id: <REPLACE_ME>.access" \
  -H "CF-Access-Client-Secret: <REPLACE_ME>" \
  "https://slideofhand.lusostreams.com/api/admin/_diag/artifacts"
```

A 403 response from the Worker (rather than the edge) with body `{"error":"forbidden — this endpoint requires Cloudflare Access authentication"}` means the edge let the request through but no recognised `cf-access-*` header arrived — usually a sign that the service token is attached to a different Access app, or the policy rule is `decision: allow` instead of `decision: non_identity`.

---

## 5. Operational notes

### Token rotation

Suggested cadence: **rotate service-token Client Secrets every 90 days**, or immediately on any of:
- A workstation that held the secret is lost / decommissioned.
- A CI provider that held the secret reports any kind of credential exposure.
- Personnel turnover where the rotated-out person had access to the secret.

To rotate: create a new service token in the dashboard, attach it to the Access app policy alongside the old one, update all callers to the new credentials, verify, then remove the old token from the policy. Cloudflare keeps both valid during the overlap so there is no downtime.

Interactive cookie sessions inherit the `session_duration` from the Access app (24h in this config). Users will re-authenticate at most once per day. There is no per-user "force re-auth" knob short of revoking the IdP session or shortening the app's `session_duration`.

### Detaching the Access app in an emergency

If Access is misconfigured in a way that prevents the maintainer from reaching the admin Studio (e.g. accidentally removed all `allow` policies, or the IdP is broken), the dashboard path is:

1. **Zero Trust → Access → Applications → Slide of Hand Admin → "..." menu → Delete**.

Deleting the app removes the edge-level gate. **The Worker's `requireAccessAuth` defence-in-depth check will then reject every `/api/admin/*` request with a 403** because no `cf-access-*` headers will reach the Worker — the API surface fails closed. The SPA at `/admin/*` will load (it's just `index.html`), but every API call it makes will fail. This is the intended behaviour: deleting Access does NOT expose the admin API.

To re-enable: POST the payload from §3 again. The app is recreated with a new ID; the service-token references inside `policies[].include[].service_token.token_id` need to point at IDs that still exist (service tokens survive an app deletion, so their IDs remain valid).

A less-destructive emergency option: **disable** the Access app (don't delete) via **Applications → Slide of Hand Admin → Edit → Disable application**. Same effect (gate removed), and re-enabling is one click.

### Auth-bypass paths

Everything NOT covered by the Access app's `self_hosted_domains` list bypasses Access at the edge. Per the path inventory in §2, this means:

- `/` and the SPA assets (`/assets/*`, favicon, etc.) — intended.
- `/decks/<slug>` — intended (audience viewer).
- `GET /api/themes/<slug>`, `GET /api/manifests/<slug>`, `GET /api/decks`, `GET /api/decks/<slug>`, `GET /api/element-overrides/<slug>`, `GET /images/<key>` — intended public reads.
- `POST /api/beacon` — intended public analytics ingestion.
- `/api/cf-dynamic-workers/*`, `/__internal/ai-proxy`, `/api/cf-code-mode/*` — intended public demo backends.
- `/preview/*` — **unintended for the eventual implementation** but currently safe because the handler is a 501 stub. See the surprise note in §2.

When adding a new admin-only endpoint to the Worker, the checklist is:
1. Add the URL pattern under `/api/admin/<feature>` so it matches the existing Access rule.
2. Call `requireAccessAuth` first thing in the handler.
3. Verify both layers in a test: a request with no `cf-access-*` headers → 403; a request with `cf-access-jwt-assertion: x` → handler runs.

If the URL pattern cannot live under `/api/admin/*` for some reason, the Access app's `self_hosted_domains` list must be updated to include the new pattern. Do this in the same PR that lands the route, not as a follow-up — the misconfiguration window is exactly the failure mode the 2026-05-06 incident exposed.

---

## See also

- [`worker/access-auth.ts`](../worker/access-auth.ts) — server-side `requireAccessAuth` + `getAccessUserEmail` helpers.
- [`src/components/RequireAdminAccess.tsx`](../src/components/RequireAdminAccess.tsx) — client-side Access gate component used by the Studio routes.
- [`docs/deploy.md`](deploy.md) — first-time deploy runbook (dashboard-driven Access setup).
- [`~/.config/opencode/AGENTS.md`](https://github.com/mcdays94/dotfiles) — personal rules including the "service tokens forward `cf-access-jwt-assertion`, NOT `cf-access-client-id`" empirical note (cited in §1).
- [Cloudflare Access — Self-hosted applications](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) — vendor docs.
- [Cloudflare Access — Service tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/) — vendor docs.
