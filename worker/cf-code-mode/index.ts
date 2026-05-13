/**
 * cf-code-mode / index — route handler.
 *
 * The live-demo backend for the cf-code-mode deck (slide 12 — the
 * traditional-MCP vs Code-Mode side-by-side comparison). Ported from
 * the source deck's `worker/index.ts` (issue #167), with public
 * routes namespaced under `/api/cf-code-mode/*` so they coexist
 * cleanly with the rest of slide-of-hand's API surface (in particular
 * the cf-dynamic-workers endpoints from #192 also use a per-deck
 * namespace).
 *
 * ## Endpoints
 *
 *   - GET  `/api/cf-code-mode/health`         binding probe.
 *   - GET  `/api/cf-code-mode/models`         demo model catalogue.
 *   - GET  `/api/cf-code-mode/prompts`        demo prompt presets.
 *   - POST `/api/cf-code-mode/run-mcp`        traditional MCP run (SSE).
 *   - POST `/api/cf-code-mode/run-code-mode`  Code Mode run (SSE).
 *
 * The /run-* endpoints stream Server-Sent Events so the deck can paint
 * tokens, tool calls, and counters as they happen — see
 * `worker/cf-code-mode/lib/sse.ts` for the helper that wraps
 * `ReadableStream` into an `EventSource`-friendly Response.
 *
 * ## CodemodeFetcher export
 *
 * The Code Mode path uses Cloudflare's Worker Loader custom-binding
 * feature: the parent worker exports a `WorkerEntrypoint` class
 * (`CodemodeFetcher`, in `lib/dynamic-code-runner.ts`), the loader
 * creates a stub via `ctx.exports.CodemodeFetcher(...)` and passes
 * it to the spawned isolate as its `globalOutbound`. The spawned
 * isolate then makes "tool calls" by calling methods on that stub —
 * which routes back into the parent for real execution.
 *
 * For this to work the class MUST be exported from the worker entry
 * module (`worker/index.ts`). That re-export is wired separately, not
 * here.
 *
 * ## Secrets
 *
 *   - `CF_API_TOKEN` (Worker secret) — Cloudflare API token used by
 *     `lib/cf-api.ts` to list zones / DNS records / WAF rules. Slide
 *     of Hand already provisions this secret for analytics
 *     (Analytics Read scope); cf-code-mode needs additional scopes
 *     (Zone Read, DNS Read, Rulesets Read at minimum) to run the
 *     demo end-to-end. The endpoints deploy + smoke regardless;
 *     specific MCP tool calls will fail with auth errors until the
 *     production token scopes are expanded.
 *   - `AI_GATEWAY_TOKEN` (optional Worker secret) — bearer for the
 *     cf-code-mode gateway. When set the AI calls go through
 *     `env.AI.gateway(id).run()` with `cf-aig-authorization`
 *     headers. When unset the binding's internal auth handles it.
 *     Distinct from Slide of Hand's `CF_AI_GATEWAY_TOKEN` (which
 *     authenticates the `slide-of-hand-agent` gateway used by the
 *     in-Studio agent) — different gateway, different token.
 */

import { DEMO_MODELS, DEFAULT_MODEL_ID, findModel } from "./lib/models";
import { DEMO_PROMPTS } from "./lib/prompts";
import { sseStream } from "./lib/sse";
import { runMcp } from "./lib/run-mcp";
import { runCodeMode } from "./lib/run-code-mode";
import { AI_GATEWAY_ID, gatewayStatus, gatewayLastError } from "./lib/ai-call";
import type { Env as CfCodeModeRawEnv } from "./types";

/**
 * Re-export the env type under a Slide-of-Hand-specific name so the
 * top-level `Env` in `worker/index.ts` can extend it cleanly. The raw
 * `Env` from `./types` references `AI`, `ASSETS`, `LOADER`,
 * `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `AI_GATEWAY_TOKEN` — all of which
 * Slide of Hand already provisions (some as bindings via
 * `wrangler.jsonc`, others as optional Worker secrets via
 * `wrangler secret put`).
 */
export type CfCodeModeEnv = CfCodeModeRawEnv;

const PUBLIC_PREFIX = "/api/cf-code-mode/";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleCfCodeMode(
  request: Request,
  env: CfCodeModeEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith(PUBLIC_PREFIX)) return null;
  const sub = path.slice(PUBLIC_PREFIX.length);

  // ─── /api/cf-code-mode/health ────────────────────────────────────
  if (sub === "health") {
    return jsonResponse({
      ok: true,
      hasAi: typeof env.AI !== "undefined",
      hasLoader: typeof env.LOADER !== "undefined",
      hasCfApiToken:
        typeof env.CF_API_TOKEN === "string" && env.CF_API_TOKEN.length > 0,
      hasAiGatewayToken:
        typeof env.AI_GATEWAY_TOKEN === "string" &&
        env.AI_GATEWAY_TOKEN.length > 0,
      aiGatewayMethodAvailable:
        typeof (env.AI as unknown as { gateway?: unknown })?.gateway ===
        "function",
      defaultModel: DEFAULT_MODEL_ID,
      aiGateway: {
        id: AI_GATEWAY_ID,
        status: gatewayStatus(),
        lastError: gatewayLastError(),
      },
      time: new Date().toISOString(),
    });
  }

  // ─── /api/cf-code-mode/models ────────────────────────────────────
  if (sub === "models") {
    return jsonResponse({
      models: DEMO_MODELS,
      defaultModelId: DEFAULT_MODEL_ID,
    });
  }

  // ─── /api/cf-code-mode/prompts ───────────────────────────────────
  if (sub === "prompts") {
    return jsonResponse({ prompts: DEMO_PROMPTS });
  }

  // ─── /api/cf-code-mode/run-mcp ───────────────────────────────────
  if (sub === "run-mcp" && request.method === "POST") {
    return handleRun(request, env, ctx, "mcp");
  }

  // ─── /api/cf-code-mode/run-code-mode ─────────────────────────────
  if (sub === "run-code-mode" && request.method === "POST") {
    return handleRun(request, env, ctx, "code-mode");
  }

  // ─── /api/cf-code-mode/__codemode ────────────────────────────────
  // Test surface for the parent's tool dispatcher. The real path the
  // dynamic worker uses is the loopback service binding (via
  // `ctx.exports.CodemodeFetcher`), not this URL.
  if (sub === "__codemode" && request.method === "POST") {
    return jsonResponse({ ok: true });
  }

  // Unmatched within the namespace — explicit 404 rather than falling
  // through to the SPA. Better signal for the deck's error path.
  return jsonResponse({ error: "not_found", path }, 404);
}

async function handleRun(
  request: Request,
  env: CfCodeModeEnv,
  ctx: ExecutionContext,
  mode: "mcp" | "code-mode",
): Promise<Response> {
  let body: { prompt?: string; modelId?: string; promptId?: string };
  try {
    body = (await request.json()) as {
      prompt?: string;
      modelId?: string;
      promptId?: string;
    };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return jsonResponse({ error: "Missing prompt" }, 400);
  }

  const modelId = body.modelId ?? DEFAULT_MODEL_ID;
  if (!findModel(modelId)) {
    return jsonResponse(
      { error: `Unknown model: ${modelId}. See /api/cf-code-mode/models.` },
      400,
    );
  }

  const runId = crypto.randomUUID();

  return sseStream(async (emit) => {
    if (mode === "mcp") {
      await runMcp({ env, prompt, modelId, emit, runId });
    } else {
      await runCodeMode({
        env,
        ctx,
        prompt,
        modelId,
        emit,
        runId,
        promptId: body.promptId,
      });
    }
  });
}
