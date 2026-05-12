/**
 * Cloudflare AI Gateway auth helpers (leaf module — no project
 * imports, so both `worker/agent.ts` and `worker/ai-deck-gen.ts`
 * can pull from here without creating the historic
 * `agent.ts ↔ ai-deck-gen.ts` cycle. See agent.ts header for the
 * rationale on why those two files don't import each other.)
 *
 * The `slide-of-hand-agent` gateway can be configured with the
 * "Authenticated Gateway" toggle in the Cloudflare dashboard. When
 * that's on, every Workers AI call routed through the gateway must
 * include a `cf-aig-authorization: Bearer <token>` header — without
 * it, the upstream returns error 2001 ("Please configure AI Gateway
 * in the Cloudflare dashboard").
 *
 * The token is stored as a Worker secret (`CF_AI_GATEWAY_TOKEN`,
 * set via `wrangler secret put`) and threaded through the
 * workers-ai-provider's `extraHeaders` option on the model call.
 * See `node_modules/workers-ai-provider/src/workersai-chat-language-model.ts`
 * `getRunOptions()` for the wire path that picks up `extraHeaders`
 * and forwards it to the binding's `run(model, inputs, options)`
 * third argument.
 *
 * Docs: https://developers.cloudflare.com/ai-gateway/configuration/authentication/
 */

/**
 * Build the `extraHeaders` payload that authenticates calls against
 * an Authenticated AI Gateway. Returns `undefined` (NOT an empty
 * object) when the token isn't set, so callers can gate the spread
 * on truthiness:
 *
 * ```ts
 * const headers = buildAiGatewayHeaders(env.CF_AI_GATEWAY_TOKEN);
 * workersai(modelId, headers ? { extraHeaders: headers } : {});
 * ```
 *
 * This shape lets the same Worker work against both authenticated
 * and unauthenticated gateways — flipping the dashboard toggle off
 * doesn't require a code change.
 */
export function buildAiGatewayHeaders(
  token: string | undefined,
): { "cf-aig-authorization": string } | undefined {
  if (!token || !token.trim()) return undefined;
  return { "cf-aig-authorization": `Bearer ${token}` };
}
