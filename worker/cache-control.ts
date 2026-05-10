/**
 * Cache-Control rewriting for Static Assets responses.
 *
 * Hashed JS / CSS chunks (`/assets/<hash>.<ext>`) cache forever
 * safely because the hash changes per deploy. But the HTML shell
 * that LOADS those chunks must revalidate on every navigation —
 * otherwise privacy-focused browsers (Zen, Brave with strict
 * caching) can hold onto a stale `index.html` after a deploy and
 * continue requesting bundle hashes that no longer exist,
 * producing the "production looks broken but a hard refresh
 * fixes it" report we hit during the 2026-05-10 mega-session.
 *
 * The fix is to detect `text/html` responses from ASSETS and
 * overwrite their Cache-Control to force revalidation. Non-HTML
 * responses pass through untouched — the binding's default
 * `Cache-Control: public, max-age=31536000, immutable` for hashed
 * assets is exactly right.
 *
 * Split out from `worker/index.ts` so unit tests can exercise it
 * without pulling in `cloudflare:` imports.
 */
export function enforceHtmlNoCache(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("text/html")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-cache, must-revalidate");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
