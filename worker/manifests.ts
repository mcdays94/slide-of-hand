/**
 * Slide-manifest API — issue #13 / Bucket B2.
 *
 * Three endpoints, all KV-backed:
 *
 *   GET    /api/manifests/<slug>         — public read, edge-cached 60s
 *   POST   /api/admin/manifests/<slug>   — Access-gated write (defense-in-depth: Worker also checks)
 *   DELETE /api/admin/manifests/<slug>   — Access-gated reset (defense-in-depth: Worker also checks)
 *
 * Cloudflare Access guards `/api/admin/*` at the edge (see the
 * `Slide of Hand Admin` Access app's `self_hosted_domains`). As of
 * 2026-05-06 the Worker ALSO validates the `cf-access-authenticated-
 * user-email` header on admin endpoints via `requireAccessAuth()` —
 * defense-in-depth so a misconfigured Access app fails closed instead
 * of open. See `worker/access-auth.ts` for the rationale.
 *
 * Returns:
 *   - a `Response` for any path it owns (200 / 204 / 400 / 403 / 405)
 *   - `null` for paths it does not own (so the caller can fall through to
 *     `env.ASSETS.fetch(request)` or another handler)
 *
 * Mirrors `worker/themes.ts` exactly in shape; the merge logic that
 * actually applies the manifest to the source slide list lives client-
 * side in `src/lib/manifest.tsx` (so source + manifest can drift gently
 * without server-side coordination).
 */

import {
  validateManifestBody,
  isValidSlug,
  MANIFEST_VERSION,
  type Manifest,
} from "../src/lib/manifest";
import { requireAccessAuth } from "./access-auth";

export interface ManifestsEnv {
  MANIFESTS: KVNamespace;
}

const KV_KEY = (slug: string) => `manifest:${slug}`;
const READ_PATH = /^\/api\/manifests\/([^/]+)\/?$/;
const WRITE_PATH = /^\/api\/admin\/manifests\/([^/]+)\/?$/;

const READ_HEADERS = {
  "content-type": "application/json",
  // 60s edge cache — same trade-off as themes.ts. Keeps KV RPS down,
  // browser revalidates because `useDeckManifest` uses cache: 'no-store'.
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

async function handleRead(
  slug: string,
  env: ManifestsEnv,
): Promise<Response> {
  const stored = (await env.MANIFESTS.get(KV_KEY(slug), "json")) as
    | Manifest
    | null;
  // Missing key = no manifest. We return 200 + nullable rather than 404
  // because "no manifest" is the normal default state, not an error.
  return new Response(
    JSON.stringify({ manifest: stored }),
    { status: 200, headers: READ_HEADERS },
  );
}

async function handleWrite(
  slug: string,
  request: Request,
  env: ManifestsEnv,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const validation = validateManifestBody(body);
  if (!validation.ok) {
    return badRequest(validation.error);
  }
  const record: Manifest = {
    version: MANIFEST_VERSION,
    order: validation.value.order,
    overrides: validation.value.overrides,
    updatedAt: new Date().toISOString(),
  };
  await env.MANIFESTS.put(KV_KEY(slug), JSON.stringify(record));
  return new Response(
    JSON.stringify({ manifest: record }),
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

async function handleDelete(
  slug: string,
  env: ManifestsEnv,
): Promise<Response> {
  await env.MANIFESTS.delete(KV_KEY(slug));
  return new Response(null, { status: 204 });
}

/**
 * Route a request against the manifest API surface. Returns a `Response`
 * for paths this handler owns, or `null` for everything else (so the
 * Worker entry can fall through to other handlers / the static assets
 * binding).
 */
export async function handleManifests(
  request: Request,
  env: ManifestsEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  const writeMatch = path.match(WRITE_PATH);
  if (writeMatch) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
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
