/**
 * In-Studio AI agent — phase 1 (issue #131).
 *
 * Wires the Cloudflare Agents SDK into the Worker. This is the minimal
 * vertical slice — Durable Object + Workers AI round-trip + WebSocket
 * streaming back to the chat UI — with no tools, no deck context, no
 * AI Gateway, no model picker, no GitHub sync. Those land in later
 * phases (see issue #131's "Implementation phases" section).
 *
 * What this module owns:
 *
 *   - `DeckAuthorAgent` — `AIChatAgent` subclass. Streams Workers AI
 *     completions back over WebSocket. Conversation history is
 *     persisted to SQLite by the base class automatically.
 *
 *   - `handleAgent(request, env)` — Worker-side route handler. Matches
 *     `/api/admin/agents/*`, gates via `requireAccessAuth` (so we get
 *     defense-in-depth on top of the Access app rules), then delegates
 *     to `routeAgentRequest` with a custom prefix so the public URL
 *     shape stays consistent with the rest of the admin surface.
 *
 * ## Routing approach: prefix override (NOT URL rewrite)
 *
 * The Agents SDK's default URL pattern is `/agents/<class>/<name>`.
 * Slide of Hand keeps all admin endpoints under `/api/admin/*` so the
 * Access app's `self_hosted_domains` rules cover everything in one
 * place — see PR #121 and `worker/access-auth.ts`. The SDK exposes a
 * `prefix` option on `routeAgentRequest` (and on `useAgent` /
 * `usePartySocket` on the client) that swaps `agents` for an arbitrary
 * prefix. We use `"api/admin/agents"` on both sides, which gives us
 * `/api/admin/agents/deck-author-agent/<slug>` end-to-end with zero
 * URL rewriting.
 *
 * Why prefix over URL rewrite: the SDK handles WebSocket upgrades,
 * routing, and instance creation off the URL path. Synthesising a new
 * `Request` to translate paths works for HTTP but is brittle for
 * WebSocket upgrades (some headers and ctx don't survive the
 * re-`new Request()`). The official prefix option is the documented
 * escape hatch and is what `useAgent`'s symmetric `prefix` option is
 * designed to pair with.
 *
 * ## Auth model
 *
 * Phase 1 keeps the same auth posture as every other admin endpoint:
 * `requireAccessAuth` is called BEFORE delegating to the SDK, so a
 * misconfigured Access app fails closed instead of falling through to
 * the agent. The Access app already covers `/api/admin/*` from PR #121
 * — no Access config changes are needed.
 *
 * ## Instance naming
 *
 * The instance name in phase 1 is `deck.meta.slug`. That means all
 * editors of the same deck share one conversation. Per-user naming
 * (`<user-email>:<deck-slug>`) can come in a later phase once we wire
 * the Access-issued email header through to the client.
 *
 * @see Issue #131 for the full phased spec.
 * @see worker/access-auth.ts for the Access JWT validation helper.
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import type { Sandbox } from "@cloudflare/sandbox";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { requireAccessAuth, getAccessUserEmail } from "./access-auth";
import { buildTools } from "./agent-tools";

/**
 * Env subset the agent needs. Composed into the main `Env` interface
 * in `worker/index.ts` alongside every other handler's Env.
 *
 * `GITHUB_TOKENS` is shared with the OAuth helper module — see
 * `worker/github-oauth.ts`. The agent's source-read tools and the
 * `commitPatch` GitHub backup both pull per-user OAuth tokens from
 * here.
 *
 * `Sandbox` (issue #131 phase 3c) — backs the `proposeSourceEdit`
 * tool. The Cloudflare Sandbox DO is declared in wrangler.jsonc
 * (binding name `Sandbox`, class `Sandbox`); we type it with the
 * SDK's `Sandbox` interface so `getSandbox(env.Sandbox, ...)` picks
 * up the full RPC surface inside `runProposeSourceEdit`.
 */
export interface AgentEnv {
  AI: Ai;
  DeckAuthorAgent: DurableObjectNamespace;
  DECKS: KVNamespace;
  GITHUB_TOKENS: KVNamespace;
  Sandbox: DurableObjectNamespace<Sandbox>;
}

/**
 * Workers AI model used for chat completions in phase 1. Hardcoded —
 * the model picker / settings entry lands with the AI Gateway phase.
 *
 * Using `kimi-k2.6` (current Moonshot frontier model on Workers AI:
 * 1T params, 262.1k context, function calling, reasoning, vision).
 * The catalog also lists `kimi-k2.5` (deprecating). Earlier drafts of
 * this PR used `kimi-k2-instruct` — that ID is from an older catalog
 * snapshot and returns error 5018 on current Workers AI.
 */
const MODEL_ID = "@cf/moonshotai/kimi-k2.6";

/**
 * System prompt. Updated for phase 3a + 3b (issue #131) — the agent
 * now has full read + propose + commit for KV data decks, and read
 * access to the entire GitHub source tree (including build-time JSX
 * decks).
 *
 * The agent can still NOT write to build-time JSX deck source files
 * directly — that's phase 3c (PR-based source edits, Sandbox-validated).
 * For phase 3a+3b the agent can READ source files via GitHub but only
 * WRITE through the data-deck KV + JSON-mirror path.
 *
 * Phrasing is deliberately scope-honest:
 *   - tells the model when to USE each tool (proactive read; don't
 *     guess about decks you can fetch)
 *   - tells it when NOT to claim a change has shipped (dry-run vs
 *     commit are clearly separated)
 *   - gates `commitPatch` on user confirmation so the model can't
 *     auto-apply edits the user hasn't seen
 */
const SYSTEM_PROMPT = `You are an AI assistant embedded in Slide of Hand,
a JSX-first deck platform. Help the author plan, refine, and iterate on
their deck content. Keep responses concise and pragmatic.

You have six tools available:

DECK CONTENT (KV-backed data decks):

- \`readDeck()\` — fetches the current deck JSON, if it's a data
  (KV-backed) deck. Returns \`{ found: false }\` for build-time JSX
  decks (those live as React source — use the source tools below
  to read them, and use \`proposeSourceEdit\` to change them).

- \`proposePatch({ patch })\` — applies a partial-deck patch as a
  DRY-RUN and returns the resulting deck without persisting it.
  \`patch.meta\` is shallow-merged into the current deck's meta;
  \`patch.slides\`, if provided, REPLACES the slides array wholesale.

- \`commitPatch({ patch, commitMessage? })\` — persists a previously-
  proposed patch. Writes to KV (the live source of truth) AND
  best-effort commits the deck JSON to \`data-decks/<slug>.json\` in
  the repo as a version-controlled backup. ONLY call this AFTER the
  user has explicitly confirmed they want the change applied. NEVER
  chain \`proposePatch\` → \`commitPatch\` without an explicit user
  go-ahead in between.

SOURCE FILES (read + write):

- \`listSourceTree({ path, ref? })\` — list files / directories at a
  given path in the repo. Use empty string for repo root.

- \`readSource({ path, ref? })\` — read a single file's UTF-8 contents.

- \`proposeSourceEdit({ files, summary, prDescription? })\` — Sandbox-
  validated PR-based edits. This is how to make REAL changes to
  build-time JSX decks, framework code, or any non-data source file.
  We spawn a Cloudflare Sandbox, clone the repo, apply your edits,
  run the FULL test gate (\`npm ci\` → typecheck → vitest → build),
  commit + push a new branch, and open a DRAFT pull request. Each
  \`files[].content\` REPLACES the named file wholesale — use
  \`readSource\` first to fetch the current content, edit it, then
  pass the COMPLETE result. The PR is opened as DRAFT — the user
  reviews on GitHub and merges themselves. Do NOT pretend a change
  has shipped until the user has merged the PR.

The source tools (and \`proposeSourceEdit\`, and \`commitPatch\`'s
GitHub backup leg) all require the user to have connected GitHub
via Settings → GitHub → Connect. If a tool returns "GitHub not
connected", tell the user how to connect; don't keep retrying.

WORKFLOW:

1. To answer questions about a deck or propose a change: start with
   \`readDeck\` (if it's a data deck) or \`listSourceTree\` + \`readSource\`
   (if it's a build-time deck / framework / config).
2. To suggest a concrete change to a DATA DECK: call \`proposePatch\`,
   describe what changed, ask the user if it looks right. Then —
   ONLY after explicit user confirmation — call \`commitPatch\`.
3. To suggest a concrete change to a SOURCE FILE: read the file(s)
   with \`readSource\`, compose the complete new content, then call
   \`proposeSourceEdit\` directly. The DRAFT PR is the user's review
   surface — no separate confirmation step in chat is needed.
   When the tool returns a PR URL, share it with the user and stop;
   don't pretend the change has landed.
4. Never claim a change has been saved unless \`commitPatch\` returned
   \`persistedToKv: true\` or \`proposeSourceEdit\` returned an
   \`ok: true\` PR URL.`;

/**
 * `DeckAuthorAgent` — Durable Object that owns the chat round-trip
 * for the in-Studio AI agent.
 *
 * Extending `AIChatAgent` gives us:
 *   - Automatic SQLite-backed message persistence (survives DO eviction).
 *   - WebSocket transport + resumable streaming (handled by base).
 *   - Conversation broadcast to all connected clients of the same instance.
 *
 * We only override `onChatMessage` — the model call. Everything else
 * (lifecycle, persistence, transport) is base-class machinery.
 */
export class DeckAuthorAgent extends AIChatAgent<AgentEnv> {
  async onChatMessage(
    onFinish: Parameters<AIChatAgent<AgentEnv>["onChatMessage"]>[0],
    options: Parameters<AIChatAgent<AgentEnv>["onChatMessage"]>[1],
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    // `this.name` is the agent instance name — for phase 1/2 we key
    // the instance by deck slug (see header for why per-deck, not
    // per-(user, deck), is fine for phase 2). The tools close over
    // it so `readDeck`/`proposePatch` always operate on the deck the
    // user is actually editing.
    const tools = buildTools(this.env, this.name);
    const result = streamText({
      // `workersai(MODEL_ID)` returns the AI-SDK provider for the
      // chosen Workers AI model. Cast through `any` because the SDK's
      // model ID union is narrower than the catalog (Kimi K2 is in the
      // catalog but the TS type sometimes lags behind).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: workersai(MODEL_ID as any),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      tools,
      // Multi-step: the default `stepCountIs(1)` would stop after the
      // very first model response, which means the model would call a
      // tool but never see the result. Bump to 5 so the model can:
      //   1. emit `tool-call` for `readDeck`
      //   2. receive the tool result
      //   3. emit `tool-call` for `proposePatch`
      //   4. receive the tool result
      //   5. emit the final text response describing the dry-run
      // 5 steps comfortably covers the read → propose → respond loop
      // while bounding the cost on a misbehaving model that loops.
      stopWhen: stepCountIs(5),
      // Forward the abort signal so cancellation from the client
      // (stop button) actually severs the upstream Workers AI call
      // instead of running it to completion in the background.
      abortSignal: options?.abortSignal,
      // `onFinish` arrives typed against the base `ToolSet`, but
      // `streamText` infers its narrower variant from `tools` and
      // expects a callback parameterised by that variant. The two
      // are structurally compatible (the callback only reads the
      // event), so cast through `any` rather than re-typing every
      // tool-set boundary in the call stack.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onFinish: onFinish as any,
    });
    return result.toUIMessageStreamResponse();
  }
}

/**
 * Worker fetch-handler for the in-Studio agent.
 *
 * Returns `null` for paths outside our prefix so the main fetch
 * handler can fall through to the next route module. Returns a 403
 * for matching paths without an Access-issued email header. Otherwise
 * delegates to `routeAgentRequest` with the matching prefix so the
 * SDK can resolve the agent class + instance and handle the
 * HTTP/WebSocket request.
 *
 * @returns Response for the request, or `null` if the path doesn't
 *          match our prefix.
 */
export async function handleAgent(
  request: Request,
  env: AgentEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/admin/agents/")) return null;

  // Local-dev fallback: browsers cannot set custom headers on
  // WebSocket upgrade requests, so on `wrangler dev` (no real Access
  // in front) we accept the dev email via a `cf-access-auth-email`
  // query parameter as well. The client puts this on the connection
  // URL via `useAgent`'s `query` option when running on a localhost
  // host. In production this branch is unreachable — the host won't
  // be `127.0.0.1` / `*.localhost` and Access at the edge populates
  // the header before the request reaches the Worker. Crucially,
  // `cf-access-*` request headers and unsanctioned query params are
  // stripped/ignored by Access in front of production routes, so a
  // forged query string would NOT bypass the auth boundary.
  // Determine whether this request reached us through `wrangler dev`
  // (no real Access in front) so we know whether to honour the
  // `?cf-access-auth-email=…` query-param fallback.
  //
  // `wrangler dev` rewrites the URL hostname AND the `Host` header
  // to match the configured custom domain so the dev environment
  // simulates production routing. The only header that reliably
  // identifies dev traffic is `cf-connecting-ip`: in production
  // this is the actual end-user's public IP, but in `wrangler dev`
  // it's the loopback address because the dev server IS the last
  // hop. Production traffic from a real user can never have
  // `cf-connecting-ip = 127.0.0.1` / `::1` — Cloudflare's edge
  // always populates this with the visitor's actual public IP. So
  // the loopback check is a safe production-vs-dev signal.
  const cfConnectingIp = request.headers.get("cf-connecting-ip") ?? "";
  const isLoopbackIp =
    cfConnectingIp === "127.0.0.1" ||
    cfConnectingIp === "::1" ||
    cfConnectingIp === "0:0:0:0:0:0:0:1";
  const isLocalDev = isLoopbackIp;
  const devEmail = isLocalDev
    ? url.searchParams.get("cf-access-auth-email")
    : null;

  // Build a "proxied" Request that carries the dev email as an Access
  // header when the dev fallback applies. We construct a fresh Headers
  // bag and a new Request with the original URL + method + body but
  // the proxied headers — this is more robust than `new Request(req,
  // { headers })` which has subtle quirks around inherited headers.
  let proxiedRequest = request;
  if (devEmail && !request.headers.get("cf-access-authenticated-user-email")) {
    const h = new Headers(request.headers);
    h.set("cf-access-authenticated-user-email", devEmail);
    proxiedRequest = new Request(request.url, {
      method: request.method,
      headers: h,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
    });
  }

  const denied = requireAccessAuth(proxiedRequest);
  if (denied) return denied;

  // Audit log: who's chatting? Cheap, opt-in observability that costs
  // nothing if Workers logs aren't being tailed. A proper audit
  // pipeline (#131 phase 4+) would persist this; for phase 1 we just
  // make sure the email is visible in `wrangler tail`.
  const email = getAccessUserEmail(proxiedRequest);
  if (email) {
    console.log(`[agent] ${request.method} ${url.pathname} — user=${email}`);
  }

  // `prefix` lines up the SDK's URL parser with our `/api/admin/agents`
  // path so we don't have to synthesise a new Request. See the module
  // header for why prefix beats URL rewrite here.
  //
  // We pass the (possibly proxied) request so the SDK sees the
  // synthesised auth header in dev too — the agent's own auth checks
  // (if it adds any later) will then be consistent with `requireAccessAuth`.
  const routed = await routeAgentRequest(proxiedRequest, env, {
    prefix: "api/admin/agents",
  });
  return routed ?? new Response("Agent route not found", { status: 404 });
}
