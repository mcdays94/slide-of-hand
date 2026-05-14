/**
 * Centralised wrapper around Workers AI that routes EVERY call
 * through Cloudflare AI Gateway.
 *
 * Three paths, in order of preference:
 *
 *   1. **Authenticated gateway via `env.AI.gateway(id).run()`** — used
 *      when `env.AI_GATEWAY_TOKEN` is set. Sends the gateway's
 *      `cf-aig-authorization: Bearer <token>` header through
 *      `extraHeaders`. This is the documented typed path for
 *      authenticated gateways.
 *
 *   2. **Unauthenticated gateway via `env.AI.run(model, opts,
 *      { gateway: { id } })`** — used when no token is set. The
 *      binding's internal auth handles Workers AI; the gateway sees
 *      the call and logs/caches it.
 *
 *   3. **Direct `env.AI.run(model, opts)`** — last-resort fallback if
 *      the gateway is misconfigured / non-existent. Memoised after
 *      the first failure so we don't keep re-trying the gateway.
 *
 * `/api/health` surfaces which path is active so the deck can render
 * an "AI Gateway: active / authenticated / direct" badge.
 */

import type { Env } from "../types";

export const AI_GATEWAY_ID = "code-mode-demo";

let gatewayWorks: boolean | null = null;
let lastMode: "authenticated" | "active" | "direct" | "unknown" = "unknown";
let lastGatewayError: string | null = null;

/**
 * Make a Workers AI call.
 */
export async function aiRun(
  env: Env,
  modelId: string,
  inputs: Record<string, unknown>,
): Promise<unknown> {
  if (gatewayWorks !== false) {
    try {
      // Path 1: authenticated gateway (token present).
      if (env.AI_GATEWAY_TOKEN && typeof env.AI.gateway === "function") {
        const result = await runViaAuthenticatedGateway(env, modelId, inputs);
        gatewayWorks = true;
        lastMode = "authenticated";
        return result;
      }

      // Path 2: gateway via the binding's gateway-option short-cut.
      const result = await env.AI.run(modelId as never, inputs as never, {
        gateway: { id: AI_GATEWAY_ID, skipCache: false },
      } as never);
      gatewayWorks = true;
      lastMode = "active";
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Distinguish "the gateway itself is misconfigured" (memoise +
      // fall through) from "this particular request failed but the
      // gateway is fine" (re-throw, don't memoise).
      //
      // Gateway-config failures we want to remember:
      //   - HTTP 401 / 403 from the gateway (auth check rejected us)
      //   - HTTP 404 from the gateway (gateway doesn't exist)
      //   - "configure ai gateway" / `"code":2001` envelope from the
      //     binding when it's pointing at a non-existent gateway
      //   - "cf-aig-authorization" / "cf-aig" complaints
      //
      // Per-request failures we re-throw unchanged (NEVER memoise as
      // gateway-broken):
      //   - HTTP 400 with TGI/CUDA OOM/timeout (Workers AI infra)
      //   - HTTP 429 (rate limit)
      //   - HTTP 5xx (Workers AI upstream)
      //   - Context-window-exceeded (5021)
      //   - Model-not-found
      const isGatewayConfigProblem =
        /AI Gateway HTTP 40[134]\b|gateway.*(invalid|does not exist|not found)|not found.*gateway|configure ai gateway|"code":\s*2001|please configure|cf[-_]?aig/i.test(
          msg,
        );
      // Fall back on ANY gateway-config problem, even if a prior call
      // succeeded. Gateways can flip to 401 mid-session (token rotates,
      // rule change, account flag), and the second-call failure must
      // not bubble to the user just because we previously memoised
      // `gatewayWorks=true`. The memoisation is still useful for the
      // OPPOSITE direction — if the gateway is broken from the start
      // we want every call to skip it — so we still set
      // gatewayWorks=false going forward.
      if (isGatewayConfigProblem) {
        gatewayWorks = false;
        lastMode = "direct";
        lastGatewayError = msg.slice(0, 400);
        // Fall through to direct call below.
      } else {
        throw err;
      }
    }
  }

  // Path 3: direct fallback.
  return env.AI.run(modelId as never, inputs as never);
}

/**
 * Path 1 implementation: call Workers AI through the gateway with the
 * `cf-aig-authorization` header. We use the binding's `gateway()`
 * helper + `run()` method, which accepts a Universal-style request and
 * supports `extraHeaders`. The response is a standard `Response`
 * object whose JSON body is the same shape as `env.AI.run()` returns.
 */
async function runViaAuthenticatedGateway(
  env: Env,
  modelId: string,
  inputs: Record<string, unknown>,
): Promise<unknown> {
  const gw = (env.AI as unknown as { gateway: (id: string) => unknown }).gateway(
    AI_GATEWAY_ID,
  ) as {
    run: (
      data: {
        provider: string;
        endpoint: string;
        headers: Record<string, string>;
        query: unknown;
      },
      options?: { extraHeaders?: Record<string, string> },
    ) => Promise<Response>;
  };

  const response = await gw.run(
    {
      provider: "workers-ai",
      endpoint: modelId,
      headers: { "Content-Type": "application/json" },
      query: inputs,
    },
    {
      extraHeaders: {
        "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `AI Gateway HTTP ${response.status}: ${body.slice(0, 400)}`,
    );
  }
  return response.json();
}

/**
 * For /api/health. Tells the deck whether AI Gateway is active and,
 * if so, whether the authenticated path is being used.
 */
export function gatewayStatus():
  | "authenticated"
  | "active"
  | "direct"
  | "unknown" {
  return lastMode;
}

/**
 * For diagnostics. Returns the last gateway-config error message we
 * captured (or null if the gateway is healthy / hasn't been tried).
 */
export function gatewayLastError(): string | null {
  return lastGatewayError;
}
