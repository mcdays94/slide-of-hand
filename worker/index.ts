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
 *   - `/api/admin/themes/<slug>` (Access-gated write)
 * are handled by `worker/themes.ts`. Cloudflare Access enforces auth at
 * the edge for everything under `/admin/*`; the Worker does not validate
 * JWTs itself.
 */
import { handleThemes, type ThemesEnv } from "./themes";

export interface Env extends ThemesEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const themesResponse = await handleThemes(request, env);
    if (themesResponse) return themesResponse;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
