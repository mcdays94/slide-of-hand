/**
 * cf-dynamic-workers / index — route handler.
 *
 * The live-demo backend for the cf-dynamic-workers deck (slide 08).
 * Ported from the source deck's `worker/index.ts` (issue #167), but
 * with public routes namespaced under `/api/cf-dynamic-workers/*` so
 * they coexist cleanly with the rest of slide-of-hand's API surface.
 *
 * ## Endpoints
 *
 *   - GET  `/api/cf-dynamic-workers/health`          — binding probe.
 *   - POST `/api/cf-dynamic-workers/spawn`           — single isolate.
 *   - POST `/api/cf-dynamic-workers/spawn-many`      — parallel batch.
 *   - POST `/api/cf-dynamic-workers/spawn/globe`     — globe-app spawn.
 *   - ALL  `/api/cf-dynamic-workers/session/:id/*`   — globe session forwarder.
 *   - POST `/__internal/ai-proxy`                    — AI snippet callback.
 *
 * ## Why `/__internal/ai-proxy` is NOT namespaced
 *
 * Only one consumer ever hits it: the AI snippet's spawned isolate,
 * via its SELF-bound `globalOutbound`. The snippet's source code (in
 * `src/decks/public/cf-dynamic-workers/lib/snippets.ts`) hard-codes
 * `fetch("https://parent/__internal/ai-proxy", ...)`. Namespacing the
 * parent's handler to `/__internal/cf-dynamic-workers/ai-proxy` would
 * also require editing the snippet string, which is shown literally on
 * the slide. Keeping the path unprefixed reads cleaner on stage and
 * preserves the deck's pedagogical value.
 *
 * ## Public vs internal surface
 *
 * Public `/api/cf-dynamic-workers/*` is NOT Access-gated — slide 08
 * runs in front of audiences. The endpoints are read-only or
 * audience-visible (spawn an isolate, watch it execute, dispose).
 * Bounded by Worker Loader's own concurrency cap (4 per parent
 * request) so abuse is naturally rate-limited.
 *
 * `/__internal/ai-proxy` is also unauthenticated — the only way to
 * reach it is via the SELF service binding from a spawned isolate,
 * which inherits no external auth context. The path itself reveals
 * the intent ("don't call me from outside the loader").
 */

import { spawn, spawnGlobe, spawnMany, forwardSession } from "./spawn";

export interface CfDynamicWorkersEnv {
  LOADER: WorkerLoader;
  AI: Ai;
  /**
   * Self-service binding. Configured in wrangler.jsonc as
   * `services: [{ binding: "SELF", service: "reaction" }]`. The
   * spawned isolates use this as their `globalOutbound` so they can
   * call back into the parent worker (for the `/__internal/ai-proxy`
   * path or the globe app's HTML template).
   */
  SELF: Fetcher;
}

const PUBLIC_PREFIX = "/api/cf-dynamic-workers/";
const INTERNAL_AI_PROXY = "/__internal/ai-proxy";

interface SpawnRequestBody {
  snippet?: unknown;
  code?: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Both endpoints are response-volatile (a fresh isolate per
      // call) so caching would actively mislead. Set no-store to
      // pre-empt any edge layer that defaults to caching JSON.
      "cache-control": "no-store",
    },
  });
}

/**
 * Light type guard. `SnippetId` is a union literal in the deck-local
 * snippets module; we don't import it here to keep this router's
 * import surface minimal. Validation is done at the spawn module by
 * dictionary lookup against the canonical `SNIPPETS` table.
 */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

export async function handleCfDynamicWorkers(
  request: Request,
  env: CfDynamicWorkersEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // ─── Internal AI proxy ───────────────────────────────────────────
  // Called by the AI snippet's spawned isolate via its
  // SELF-bound globalOutbound. Body: { model, input }. Response: the
  // raw AI binding output. Path unprefixed because the snippet's
  // source code is shown on the slide and the unprefixed form reads
  // cleaner. See file header for the trade-off note.
  if (path === INTERNAL_AI_PROXY) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    let body: { model?: string; input?: unknown };
    try {
      body = (await request.json()) as { model?: string; input?: unknown };
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    if (typeof env.AI === "undefined") {
      return jsonResponse({ error: "ai_binding_unavailable" }, 503);
    }
    try {
      const result = await env.AI.run(
        (body.model ?? "@cf/meta/llama-3.1-8b-instruct") as Parameters<
          Ai["run"]
        >[0],
        body.input as Parameters<Ai["run"]>[1],
      );
      return jsonResponse(result);
    } catch (cause) {
      return jsonResponse(
        {
          error: "ai_run_failed",
          message: cause instanceof Error ? cause.message : String(cause),
        },
        502,
      );
    }
  }

  // Public surface — all under /api/cf-dynamic-workers/.
  if (!path.startsWith(PUBLIC_PREFIX)) return null;
  const sub = path.slice(PUBLIC_PREFIX.length);

  // ─── /api/cf-dynamic-workers/health ──────────────────────────────
  if (sub === "health") {
    return jsonResponse({
      ok: true,
      loaderAvailable: typeof env.LOADER !== "undefined",
      aiAvailable: typeof env.AI !== "undefined",
      selfAvailable: typeof env.SELF !== "undefined",
    });
  }

  // ─── /api/cf-dynamic-workers/spawn ───────────────────────────────
  if (sub === "spawn" && request.method === "POST") {
    let body: SpawnRequestBody;
    try {
      body = (await request.json()) as SpawnRequestBody;
    } catch {
      return jsonResponse(
        { error: "invalid_json", message: "Request body must be JSON." },
        400,
      );
    }
    if (!isString(body.snippet)) {
      return jsonResponse(
        {
          error: "invalid_snippet",
          message: "snippet id is required.",
        },
        400,
      );
    }
    const codeOverride = isString(body.code) && body.code.trim().length > 0
      ? body.code
      : undefined;
    // `spawn` validates the snippet id against SNIPPETS internally
    // and returns an error envelope for unknowns — no need to
    // re-validate here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- spawn does its own validation
    const result = await spawn(env, body.snippet as any, codeOverride);
    return jsonResponse(result);
  }

  // ─── /api/cf-dynamic-workers/spawn-many ──────────────────────────
  if (sub === "spawn-many" && request.method === "POST") {
    let body: { count?: unknown };
    try {
      body = (await request.json()) as { count?: unknown };
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    const count = typeof body.count === "number" ? body.count : 10;
    const result = await spawnMany(env, count);
    return jsonResponse(result);
  }

  // ─── /api/cf-dynamic-workers/spawn/globe ─────────────────────────
  if (sub === "spawn/globe" && request.method === "POST") {
    const result = await spawnGlobe(env);
    return jsonResponse(result);
  }

  // ─── /api/cf-dynamic-workers/session/:id/* ───────────────────────
  if (sub.startsWith("session/")) {
    const rest = sub.slice("session/".length);
    const match = rest.match(/^([A-Za-z0-9_-]+)(\/.*)?$/);
    if (!match) {
      return jsonResponse({ error: "invalid_session_url" }, 400);
    }
    const [, id, subpathRaw] = match;
    const subpath = (subpathRaw ?? "/") + url.search;
    return await forwardSession(env, id, subpath, request);
  }

  // Unmatched route under the namespace — explicit 404 rather than
  // falling through to the SPA. Better signal for the deck's UI.
  return jsonResponse({ error: "not_found", path }, 404);
}
