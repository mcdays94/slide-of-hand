/**
 * Element-overrides API — issue #43 / Element inspector Slice 1.
 *
 * Three endpoints, all KV-backed:
 *
 *   GET    /api/element-overrides/<slug>         — public read
 *   POST   /api/admin/element-overrides/<slug>   — Access-gated write (defense-in-depth: Worker also checks)
 *   DELETE /api/admin/element-overrides/<slug>   — Access-gated reset (defense-in-depth: Worker also checks)
 *
 * Mirrors `worker/themes.ts` and `worker/manifests.ts` in shape.
 *
 * ## Why `Cache-Control: private, max-age=60` for the read?
 *
 * Themes/manifests use `public, max-age=60` because their content is
 * deck-wide and identical for every viewer of a given slug. Element
 * overrides ARE also deck-wide today, but the inspector workflow expects
 * fast iteration: an author inspects an element, saves an override,
 * reloads, and expects to see it. A `public` cache header lets a CDN
 * (Cloudflare's edge cache or any intermediary) hold a stale list for up
 * to 60s across users — which is fine for theme tokens but creates a
 * confusing "did my save land?" UX for inspector edits.
 *
 * `private, max-age=60` keeps the per-browser cache (so the audience
 * doesn't hammer KV during a talk) but prevents shared CDN caching, so
 * an author who saves + reloads sees their change land on the next
 * fetch. The trade-off is a higher KV read RPS than themes — acceptable
 * because override lists are small and reads are cheap.
 *
 * Cloudflare Access guards `/api/admin/*` at the edge, but the Worker
 * ALSO validates the `cf-access-authenticated-user-email` header via
 * `requireAccessAuth()` — defense-in-depth so a misconfigured Access app
 * fails closed instead of open. See `worker/access-auth.ts` for the
 * full rationale.
 *
 * Returns:
 *   - a `Response` for any path it owns (200 / 204 / 400 / 403 / 405)
 *   - `null` for paths it does not own (so the caller can fall through
 *     to other handlers / the static assets binding)
 */

import { isValidSlug } from "../src/lib/theme-tokens";
import { requireAccessAuth } from "./access-auth";

export interface ElementOverridesEnv {
  ELEMENT_OVERRIDES: KVNamespace;
}

/**
 * Single override entry. `slideId` is the `SlideDef.id` (kebab-case)
 * that scopes the selector; `selector` is a CSS selector resolved
 * relative to `[data-slide-index="N"]` on the rendered slide; the
 * `fingerprint` captures the matched element's tag + visible text at
 * save time so the runtime applier can verify it found the right node
 * before mutating classes; `classOverrides` is the list of
 * `{ from, to }` swap pairs the runtime applies.
 */
export interface ElementOverride {
  slideId: string;
  selector: string;
  fingerprint: { tag: string; text: string };
  classOverrides: Array<{ from: string; to: string }>;
}

export interface ElementOverridesPayload {
  overrides: ElementOverride[];
}

const KV_KEY = (slug: string) => `element-overrides:${slug}`;
const READ_PATH = /^\/api\/element-overrides\/([^/]+)\/?$/;
const WRITE_PATH = /^\/api\/admin\/element-overrides\/([^/]+)\/?$/;

const READ_HEADERS = {
  "content-type": "application/json",
  // See file header for why this is `private` (not `public`) — short
  // version: prevent shared CDN caching so author save/reload feels
  // instant; per-browser cache is still fine for the audience.
  "cache-control": "private, max-age=60",
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

/**
 * Slide IDs are kebab-case (same shape as deck slugs — see
 * `theme-tokens.ts` `SLUG_REGEX`). Reuse the validator so the rule
 * stays in one place.
 */
function isValidSlideId(value: unknown): value is string {
  return typeof value === "string" && isValidSlug(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOverride(
  raw: unknown,
  index: number,
): { ok: true; value: ElementOverride } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: `overrides[${index}] must be an object` };
  }
  if (!isValidSlideId(raw.slideId)) {
    return {
      ok: false,
      error: `overrides[${index}].slideId must be a kebab-case slide id`,
    };
  }
  if (typeof raw.selector !== "string" || raw.selector.length === 0) {
    return {
      ok: false,
      error: `overrides[${index}].selector must be a non-empty string`,
    };
  }
  if (!isPlainObject(raw.fingerprint)) {
    return {
      ok: false,
      error: `overrides[${index}].fingerprint must be an object`,
    };
  }
  if (typeof raw.fingerprint.tag !== "string") {
    return {
      ok: false,
      error: `overrides[${index}].fingerprint.tag must be a string`,
    };
  }
  if (typeof raw.fingerprint.text !== "string") {
    return {
      ok: false,
      error: `overrides[${index}].fingerprint.text must be a string`,
    };
  }
  if (!Array.isArray(raw.classOverrides)) {
    return {
      ok: false,
      error: `overrides[${index}].classOverrides must be an array`,
    };
  }
  for (let j = 0; j < raw.classOverrides.length; j++) {
    const swap = raw.classOverrides[j];
    if (!isPlainObject(swap)) {
      return {
        ok: false,
        error: `overrides[${index}].classOverrides[${j}] must be an object`,
      };
    }
    if (typeof swap.from !== "string" || typeof swap.to !== "string") {
      return {
        ok: false,
        error: `overrides[${index}].classOverrides[${j}] must have string {from, to}`,
      };
    }
  }
  return {
    ok: true,
    value: {
      slideId: raw.slideId,
      selector: raw.selector,
      fingerprint: {
        tag: raw.fingerprint.tag,
        text: raw.fingerprint.text,
      },
      classOverrides: (raw.classOverrides as Array<Record<string, string>>).map(
        (swap) => ({ from: swap.from, to: swap.to }),
      ),
    },
  };
}

function validatePayload(
  raw: unknown,
):
  | { ok: true; value: ElementOverridesPayload }
  | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "body must be an object" };
  }
  if (!Array.isArray(raw.overrides)) {
    return { ok: false, error: "body.overrides must be an array" };
  }
  const overrides: ElementOverride[] = [];
  for (let i = 0; i < raw.overrides.length; i++) {
    const result = validateOverride(raw.overrides[i], i);
    if (!result.ok) return result;
    overrides.push(result.value);
  }
  return { ok: true, value: { overrides } };
}

async function handleRead(
  slug: string,
  env: ElementOverridesEnv,
): Promise<Response> {
  const stored = (await env.ELEMENT_OVERRIDES.get(KV_KEY(slug), "json")) as
    | ElementOverridesPayload
    | null;
  // Missing key = no overrides. Return `{ overrides: [] }` rather than
  // 404 so the client can render unconditionally without branching on
  // "not found vs empty".
  const payload: ElementOverridesPayload = stored ?? { overrides: [] };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: READ_HEADERS,
  });
}

async function handleWrite(
  slug: string,
  request: Request,
  env: ElementOverridesEnv,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const validation = validatePayload(body);
  if (!validation.ok) {
    return badRequest(validation.error);
  }
  const record: ElementOverridesPayload = { overrides: validation.value.overrides };
  await env.ELEMENT_OVERRIDES.put(KV_KEY(slug), JSON.stringify(record));
  return new Response(JSON.stringify(record), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

async function handleDelete(
  slug: string,
  env: ElementOverridesEnv,
): Promise<Response> {
  await env.ELEMENT_OVERRIDES.delete(KV_KEY(slug));
  return new Response(null, { status: 204 });
}

/**
 * Route a request against the element-overrides API surface. Returns a
 * `Response` for paths this handler owns, or `null` for everything else
 * (so the Worker entry can fall through to other handlers / the static
 * assets binding).
 */
export async function handleElementOverrides(
  request: Request,
  env: ElementOverridesEnv,
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
