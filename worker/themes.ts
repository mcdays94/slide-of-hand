/**
 * Theme override API — issue #12 / Bucket B1.
 *
 * Three endpoints, all KV-backed:
 *
 *   GET    /api/themes/<slug>         — public read, edge-cached 60s
 *   POST   /api/admin/themes/<slug>   — Access-gated write
 *   DELETE /api/admin/themes/<slug>   — Access-gated reset
 *
 * Cloudflare Access guards `/admin/*` at the edge, so this Worker code
 * does NOT validate JWTs. We optionally ignore `cf-access-authenticated-
 * user-email` for v1; an audit hook can hang off it later.
 *
 * `handleThemes()` returns:
 *   - a `Response` for any path it owns (200 / 204 / 400 / 405)
 *   - `null` for paths it does not own (so the caller can fall through to
 *     `env.ASSETS.fetch(request)`).
 */

import {
  validateTokens,
  isValidSlug,
  type ThemeOverride,
} from "../src/lib/theme-tokens";

export interface ThemesEnv {
  THEMES: KVNamespace;
}

const KV_KEY = (slug: string) => `theme:${slug}`;
const READ_PATH = /^\/api\/themes\/([^/]+)\/?$/;
const WRITE_PATH = /^\/api\/admin\/themes\/([^/]+)\/?$/;

const READ_HEADERS = {
  "content-type": "application/json",
  // 60s edge cache keeps save-to-visible latency low while shielding KV
  // from RPS spikes. Browsers ALSO cache for 60s, which is acceptable
  // for v1 (admin Save → Reload may be stale up to 60s; documented).
  "cache-control": "public, max-age=60",
};

const NO_STORE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: NO_STORE_HEADERS,
  });
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: { ...NO_STORE_HEADERS, allow: allowed.join(", ") },
  });
}

async function handleRead(slug: string, env: ThemesEnv): Promise<Response> {
  const stored = (await env.THEMES.get(KV_KEY(slug), "json")) as
    | ThemeOverride
    | null;
  if (!stored) {
    // Missing key = no override. We return 200 + nullable fields rather
    // than 404 because "no override" is the normal default state, not
    // an error condition.
    return new Response(
      JSON.stringify({ tokens: null, updatedAt: null }),
      { status: 200, headers: READ_HEADERS },
    );
  }
  return new Response(
    JSON.stringify({ tokens: stored.tokens, updatedAt: stored.updatedAt }),
    { status: 200, headers: READ_HEADERS },
  );
}

async function handleWrite(
  slug: string,
  request: Request,
  env: ThemesEnv,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    return badRequest("body must be an object");
  }
  const tokens = validateTokens((body as { tokens?: unknown }).tokens);
  if (!tokens) {
    return badRequest(
      "tokens must contain exactly cf-bg-100, cf-text, cf-orange, cf-border (each #RRGGBB)",
    );
  }
  const record: ThemeOverride = {
    version: 1,
    tokens,
    updatedAt: new Date().toISOString(),
  };
  await env.THEMES.put(KV_KEY(slug), JSON.stringify(record));
  return new Response(
    JSON.stringify({ tokens: record.tokens, updatedAt: record.updatedAt }),
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

async function handleDelete(
  slug: string,
  env: ThemesEnv,
): Promise<Response> {
  await env.THEMES.delete(KV_KEY(slug));
  return new Response(null, { status: 204 });
}

/**
 * Route a request against the theme API surface. Returns a `Response` for
 * paths this handler owns, or `null` for everything else (so the Worker
 * entry can fall through to the static assets binding).
 */
export async function handleThemes(
  request: Request,
  env: ThemesEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  const writeMatch = path.match(WRITE_PATH);
  if (writeMatch) {
    const slug = decodeURIComponent(writeMatch[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");
    if (request.method === "POST") return handleWrite(slug, request, env);
    if (request.method === "DELETE") return handleDelete(slug, env);
    return methodNotAllowed(["POST", "DELETE"]);
  }

  const readMatch = path.match(READ_PATH);
  if (readMatch) {
    const slug = decodeURIComponent(readMatch[1]);
    if (!isValidSlug(slug)) return badRequest("invalid slug");
    if (request.method === "GET" || request.method === "HEAD") {
      return handleRead(slug, env);
    }
    return methodNotAllowed(["GET", "HEAD"]);
  }

  return null;
}
