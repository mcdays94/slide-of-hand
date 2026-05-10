/**
 * Cache-Control rewriting for Static Assets responses.
 *
 * Two responsibilities, applied in tandem to every response from the
 * `env.ASSETS` binding:
 *
 *   1. **HTML shell — revalidate on every load.** Privacy-focused
 *      browsers (Zen, Brave-strict) hold onto a stale `index.html`
 *      after a deploy and continue requesting bundle hashes that no
 *      longer exist, producing the "production looks broken but a
 *      hard refresh fixes it" report we hit during the 2026-05-10
 *      mega-session. Force `Cache-Control: no-cache, must-revalidate`
 *      so the browser always asks first.
 *
 *   2. **Hashed `/assets/<hash>.<ext>` chunks — cache forever.** Vite
 *      hashes the filename, so the URL changes whenever the contents
 *      change. That makes the asset safely immutable. We set
 *      `Cache-Control: public, max-age=31536000, immutable` so
 *      browsers don't even bother revalidating across navigations.
 *      Cloudflare's edge cache also honours this.
 *
 * Anything else (e.g. `/thumbnails/<slug>/<N>.png`, `/index.html`'s
 * referenced fonts, etc.) is left alone — the Static Assets binding's
 * defaults are fine for non-versioned assets.
 *
 * This module is wired in via `worker/index.ts`'s response pipeline.
 * The `run_worker_first: true` setting in `wrangler.jsonc` ensures
 * the Worker runs (and this rewriter fires) for every asset request,
 * not just SPA fallbacks. See that file's `assets` block for why.
 *
 * Split out from `worker/index.ts` so unit tests can exercise these
 * functions without pulling in `cloudflare:` imports.
 */

/**
 * `/assets/<hash>.<ext>` — Vite's hashed-asset output convention.
 * Filename always includes a content hash so the URL changes when
 * the bytes change. Safe to cache as immutable.
 */
const HASHED_ASSET_PATH = /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{6,}\.[a-z]+(?:\.map)?$/;

const IMMUTABLE_ONE_YEAR = "public, max-age=31536000, immutable";
const HTML_NO_CACHE = "no-cache, must-revalidate";

export function isHashedAssetPath(pathname: string): boolean {
  return HASHED_ASSET_PATH.test(pathname);
}

/**
 * Force revalidation on every HTML response from the ASSETS binding.
 * No-op on non-HTML responses. Returns the same Response object
 * unchanged in the no-op case so the rest of the pipeline can
 * short-circuit cheaply.
 */
export function enforceHtmlNoCache(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("text/html")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", HTML_NO_CACHE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Set immutable, year-long Cache-Control on Vite's hashed-asset
 * responses. The decision is path-driven, not content-type-driven,
 * so we need the request URL alongside the response.
 *
 * No-op for non-hashed paths — preserves the binding's defaults for
 * things like `/thumbnails/*` and any future static content that
 * isn't fingerprinted.
 */
export function enforceHashedAssetImmutable(
  request: Request,
  response: Response,
): Response {
  const url = new URL(request.url);
  if (!isHashedAssetPath(url.pathname)) {
    return response;
  }
  // Only 200 responses are safe to mark immutable. A 404 from the
  // assets binding (e.g. file deleted in a deploy) must NOT be
  // cached for a year.
  if (response.status !== 200) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", IMMUTABLE_ONE_YEAR);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Apply the full Cache-Control pipeline. The two transforms are
 * mutually exclusive (a path is either hashed-asset or HTML — never
 * both), so order is just a clarity choice.
 */
export function applyCacheControl(
  request: Request,
  response: Response,
): Response {
  const afterAssets = enforceHashedAssetImmutable(request, response);
  return enforceHtmlNoCache(afterAssets);
}
