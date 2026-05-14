/**
 * Worker environment types — cf-code-mode (issue #167).
 *
 * Ported from the source deck. The original declared its own
 * `WorkerLoaderBinding` / `WorkerCode` / `WorkerStub` interfaces
 * because the runtime types weren't yet shipped by
 * `@cloudflare/workers-types`. Slide of Hand wires the binding via
 * `wrangler.jsonc` (#190) so `wrangler types` now generates the
 * canonical global `WorkerLoader` / `WorkerLoaderWorkerCode` /
 * `WorkerStub` types into `worker-configuration.d.ts`. We use those
 * directly here — no local re-declaration, no structural-conflict
 * risk with the top-level Env.
 *
 * ## Bindings
 *
 *   AI       — Workers AI (the LLM behind both demo columns).
 *   ASSETS   — Static Assets binding for the React SPA.
 *   LOADER   — Worker Loader (cf-code-mode's Code Mode column uses it
 *              to spawn an isolate that runs the model-generated JS).
 *
 * ## Secrets (optional)
 *
 *   CF_API_TOKEN       — Cloudflare API token. `lib/cf-api.ts` uses
 *                        it to list zones / DNS records / WAF rules.
 *                        Slide of Hand provisions it for analytics;
 *                        cf-code-mode demos need additional scopes
 *                        (Zone Read, DNS Read, Rulesets Read).
 *   AI_GATEWAY_TOKEN   — Bearer for the cf-code-mode-specific AI
 *                        gateway (`code-mode-demo`). Distinct from
 *                        Slide of Hand's CF_AI_GATEWAY_TOKEN, which
 *                        authenticates a different gateway.
 *   CF_ACCOUNT_ID      — Already provisioned as a Slide of Hand
 *                        var (top-level wrangler.jsonc). When set,
 *                        the demo's MCP tools filter zones to this
 *                        account so multi-tenant user tokens don't
 *                        leak zones the presenter doesn't recognise.
 */
export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  LOADER: WorkerLoader;
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  AI_GATEWAY_TOKEN?: string;
}

// Re-export browser-shareable types so existing `import { RunEvent } from
// "./types"` (and `"../types"`) call-sites continue to work for code in
// `worker/cf-code-mode/` while the frontend imports from
// `src/decks/public/cf-code-mode/lib/run-events.ts` directly (avoiding
// the workers-types globals above).
export type { RunEvent, DemoPrompt, DemoModel } from "./run-events";
