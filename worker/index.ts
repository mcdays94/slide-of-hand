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

export interface Env
  extends ThemesEnv,
    ManifestsEnv,
    AnalyticsEnv,
    ElementOverridesEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
