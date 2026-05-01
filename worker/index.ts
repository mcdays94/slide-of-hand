/**
 * ReAction Worker entry.
 *
 * v1 is a pure Static Assets app — every request is delegated to the
 * `ASSETS` binding, which serves the bundled SPA from `dist/`. The
 * `not_found_handling: single-page-application` setting in `wrangler.jsonc`
 * makes the assets binding fall back to `index.html` for unknown paths so
 * that React Router's path-based URLs work on hard refresh.
 *
 * No auth code lives here — `/admin/*` will be gated by Cloudflare Access at
 * the edge in a later slice (see PRD § Security).
 *
 * Future slices may add API endpoints (e.g. `/api/...`) by intercepting
 * matching paths before falling through to `env.ASSETS.fetch(request)`.
 */
export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
