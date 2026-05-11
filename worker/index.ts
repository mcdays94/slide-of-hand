/**
 * Slide of Hand Worker entry.
 *
 * Most requests fall through to the `ASSETS` binding, which serves the
 * bundled SPA from `dist/`. The `not_found_handling: single-page-application`
 * setting in `wrangler.jsonc` makes the assets binding fall back to
 * `index.html` for unknown paths so React Router's path-based URLs work
 * on hard refresh.
 *
 * `/api/*` is intercepted before assets:
 *   - `/api/themes/<slug>` (public read) and
 *     `/api/admin/themes/<slug>` (Access-gated write) — `worker/themes.ts`
 *   - `/api/manifests/<slug>` (public read) and
 *     `/api/admin/manifests/<slug>` (Access-gated write) — `worker/manifests.ts`
 *   - `/api/beacon` (public ingestion) and
 *     `/api/admin/analytics/<slug>` (Access-gated read) — `worker/analytics.ts`
 *   - `/api/element-overrides/<slug>` (public read) and
 *     `/api/admin/element-overrides/<slug>` (Access-gated write) — `worker/element-overrides.ts`
 *   - `/api/decks*` (public read + admin write) — `worker/decks.ts` (issue #57)
 *   - `/images/*` (public serve) and `/api/admin/images/*`
 *     (Access-gated upload/index) — `worker/images.ts` (issue #58)
 *   - `/api/admin/agents/*` (Access-gated WebSocket + HTTP) —
 *     `worker/agent.ts` (issue #131 / in-Studio AI agent phase 1)
 *
 * Cloudflare Access enforces auth at the edge for everything under
 * `/admin/*`; the Worker does not validate JWTs itself.
 */
import { handleThemes, type ThemesEnv } from "./themes";
import { handleManifests, type ManifestsEnv } from "./manifests";
import { handleAnalytics, type AnalyticsEnv } from "./analytics";
import {
  handleElementOverrides,
  type ElementOverridesEnv,
} from "./element-overrides";
import { handleDecks, type DecksEnv } from "./decks";
import { handleImages, type ImagesEnv } from "./images";
import { handleAuthStatus, type AuthStatusEnv } from "./auth-status";
import { handleAgent, type AgentEnv } from "./agent";
import { handleGitHubOAuth, type GitHubOAuthEnv } from "./github-oauth";
import { handleSandboxSmoke, type SandboxSmokeEnv } from "./sandbox-smoke";
import { applyCacheControl } from "./cache-control";

// Re-export the agent DO class so wrangler can find it from the same
// module as the default handler. Cloudflare requires the Durable
// Object class to be exported from the Worker entry point.
export { DeckAuthorAgent } from "./agent";

// Re-export the Sandbox class (issue #131 phase 3c). The Sandbox SDK
// requires its `Sandbox` DO class to be exported from the Worker
// entry point so the Cloudflare runtime can resolve the binding
// declared in `wrangler.jsonc`. The class itself is defined inside
// `@cloudflare/sandbox` — we just re-surface it.
export { Sandbox } from "@cloudflare/sandbox";

export interface Env
  extends ThemesEnv,
    ManifestsEnv,
    AnalyticsEnv,
    ElementOverridesEnv,
    DecksEnv,
    ImagesEnv,
    AuthStatusEnv,
    AgentEnv,
    GitHubOAuthEnv,
    SandboxSmokeEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const authStatusResponse = await handleAuthStatus(request, env);
    if (authStatusResponse) return authStatusResponse;
    const themesResponse = await handleThemes(request, env);
    if (themesResponse) return themesResponse;
    const manifestsResponse = await handleManifests(request, env);
    if (manifestsResponse) return manifestsResponse;
    const analyticsResponse = await handleAnalytics(request, env);
    if (analyticsResponse) return analyticsResponse;
    const elementOverridesResponse = await handleElementOverrides(
      request,
      env,
    );
    if (elementOverridesResponse) return elementOverridesResponse;
    const decksResponse = await handleDecks(request, env);
    if (decksResponse) return decksResponse;
    const imagesResponse = await handleImages(request, env);
    if (imagesResponse) return imagesResponse;
    // Agent route (issue #131 phase 1). Must run BEFORE the ASSETS
    // fallback because it serves WebSocket upgrades and JSON, not
    // static files.
    const agentResponse = await handleAgent(request, env);
    if (agentResponse) return agentResponse;
    // GitHub OAuth flow (issue #131 phase 3 prep). Per-user GitHub
    // connection for the agent's `commitPatch` tool. See
    // `worker/github-oauth.ts` for the trust model.
    const githubOAuthResponse = await handleGitHubOAuth(request, env);
    if (githubOAuthResponse) return githubOAuthResponse;
    // Sandbox smoke endpoint (issue #131 phase 3c). Access-gated
    // diagnostic for the Cloudflare Sandbox infrastructure — see
    // `worker/sandbox-smoke.ts` for why this lives as a permanent
    // endpoint rather than a one-off bring-up script.
    const sandboxSmokeResponse = await handleSandboxSmoke(request, env);
    if (sandboxSmokeResponse) return sandboxSmokeResponse;

    // All non-API paths fall through to the Static Assets binding.
    // The binding's `not_found_handling: single-page-application`
    // (see wrangler.jsonc) makes 404s fall back to `index.html` so
    // React Router's path-based URLs survive a hard refresh.
    //
    // `applyCacheControl` rewrites Cache-Control on the response:
    // HTML shell → `no-cache, must-revalidate` so privacy browsers
    // don't pin stale bundle hashes; hashed-asset chunks →
    // `public, max-age=31536000, immutable` so browsers + CDN
    // caches keep them forever (the URL hash changes per deploy).
    // See `worker/cache-control.ts` for full rationale.
    //
    // With `run_worker_first: true` in `wrangler.jsonc`, this code
    // path fires for every request — including `/` and
    // `/assets/<hash>.<ext>` — not just SPA fallbacks.
    return applyCacheControl(request, await env.ASSETS.fetch(request));
  },
} satisfies ExportedHandler<Env>;
