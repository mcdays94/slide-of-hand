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
import { routeAgentRequest, type Connection } from "agents";
import type { Sandbox } from "@cloudflare/sandbox";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { requireAccessAuth, getAccessUserEmail } from "./access-auth";
import { buildTools } from "./agent-tools";
import {
  AI_ASSISTANT_MODELS,
  type AiAssistantModel,
} from "../src/lib/ai-models";

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
 * Mapping from the friendly AI-assistant model key (the stable
 * contract with persisted client settings — see `src/lib/settings.ts`)
 * to the current Workers AI catalog ID. Issue #131 item A.
 *
 * **Why this mapping exists.** Workers AI model IDs drift
 * (kimi-k2.5 → kimi-k2.6 deprecation, llama-3.x → llama-4 family,
 * etc.). The friendly key is the stable contract for everything
 * client-side: the persisted setting, the segmented-row labels, the
 * URL of any future analytics. The catalog ID is the server-side
 * concern that can change independently.
 *
 * **Why this mapping is the allow-list.** Defence in depth — the
 * client sends a friendly key on every chat turn (via `useAgentChat`'s
 * `body` option), and the server re-checks it against `Object.keys`
 * of this mapping before passing the resolved catalog ID into
 * `streamText`. A stale client, a tampered localStorage, or any
 * arbitrary `body.model` value cannot escape this allow-list to
 * invoke a model we haven't approved.
 *
 * **Catalog IDs verified 2026-05-11 via `npx wrangler ai models`.**
 * If any of these IDs is later renamed or deprecated, the user-visible
 * change is at MOST a single picker option breaking — the others
 * still work, and the per-user persisted setting (a friendly key) is
 * unaffected.
 */
export const AI_ASSISTANT_MODEL_IDS: Record<AiAssistantModel, string> = {
  "kimi-k2.6": "@cf/moonshotai/kimi-k2.6",
  "llama-4-scout": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "gpt-oss-120b": "@cf/openai/gpt-oss-120b",
};

/**
 * Default model key when the client doesn't send one, or sends one
 * that fails the allow-list check. Matches `DEFAULT_SETTINGS.aiAssistantModel`
 * in `src/lib/settings.ts` — the two MUST stay in sync.
 */
const DEFAULT_AI_ASSISTANT_MODEL: AiAssistantModel = "kimi-k2.6";

/**
 * Validate the client-supplied model key against the allow-list and
 * resolve it to a Workers AI catalog ID. Returns the default catalog
 * ID when:
 *
 *   - `body` is undefined (no per-turn override)
 *   - `body.model` is missing
 *   - `body.model` is not a string
 *   - `body.model` is not in the friendly-key allow-list
 *
 * This is the single source of truth for "what model does the agent
 * actually invoke?". `onChatMessage` calls it once per turn.
 */
export function resolveAiAssistantModel(
  body: Record<string, unknown> | undefined,
): string {
  const candidate = body?.model;
  if (
    typeof candidate === "string" &&
    (AI_ASSISTANT_MODELS as readonly string[]).includes(candidate)
  ) {
    return AI_ASSISTANT_MODEL_IDS[candidate as AiAssistantModel];
  }
  return AI_ASSISTANT_MODEL_IDS[DEFAULT_AI_ASSISTANT_MODEL];
}

/**
 * Build the system prompt with the current deck's slug injected up
 * front so the model never has to ask "which deck are you editing?".
 *
 * The agent instance is keyed by `<deck-slug>` (see `this.name` in
 * `onChatMessage`), so the slug is known at conversation start. The
 * old static `SYSTEM_PROMPT` never told the model this — it just
 * described tools that had the slug baked in via closure — so the
 * model had to either guess or ask the user, even though the data
 * was right there. Issue surfaced post-deploy 2026-05-11: user asked
 * "what is this deck about?" on a build-time deck, agent listed the
 * 5 public decks and asked "which one are you editing?".
 *
 * Phrasing is deliberately scope-honest:
 *   - tells the model what deck it's scoped to and what FILE PATH the
 *     source lives at for build-time decks
 *   - tells it when to USE each tool (proactive read; don't ask for
 *     info we already have)
 *   - tells it when NOT to claim a change has shipped (dry-run vs
 *     commit are clearly separated)
 *   - gates `commitPatch` on user confirmation so the model can't
 *     auto-apply edits the user hasn't seen
 */
export function buildSystemPrompt(slug: string): string {
  return `You are an AI assistant embedded in Slide of Hand,
a JSX-first deck platform. Help the author plan, refine, and iterate on
their deck content. Keep responses concise and pragmatic.

CURRENT DECK CONTEXT:

You are scoped to the deck with slug \`${slug}\`. All deck-content
tools (\`readDeck\`, \`proposePatch\`, \`commitPatch\`) operate on this
slug automatically — the user does NOT need to tell you which deck
they're editing, you already know. If this is a build-time JSX deck
(i.e. \`readDeck\` returns \`{ found: false }\`), its source lives at
\`src/decks/public/${slug}/\` in the repo. Proactively
\`listSourceTree({ path: "src/decks/public/${slug}" })\` and then
\`readSource\` the relevant files to answer questions about it —
don't ask the user which deck they want to work on.

You have six tools available:

DECK CONTENT (KV-backed data decks — operates on slug \`${slug}\`):

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
  best-effort commits the deck JSON to \`data-decks/${slug}.json\` in
  the repo as a version-controlled backup. ONLY call this AFTER the
  user has explicitly confirmed they want the change applied. NEVER
  chain \`proposePatch\` → \`commitPatch\` without an explicit user
  go-ahead in between.

SOURCE FILES (read + write — anywhere in the repo):

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

1. To answer ANY question about the current deck — start by reading
   it. Call \`readDeck\` first. If it returns \`{ found: true }\`, you
   have everything. If \`{ found: false }\`, immediately call
   \`listSourceTree({ path: "src/decks/public/${slug}" })\` to see
   the deck's source files, then \`readSource\` the index plus
   whichever slide files look relevant.
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
}

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
  /**
   * Capture the Access-issued user email at WebSocket upgrade time
   * and stash it on per-connection state.
   *
   * Why this exists — issue #131 item B. The agents SDK runs each
   * hook inside an `AsyncLocalStorage` context with a different
   * subset of `{ agent, connection, request, email }` populated. The
   * upgrade `onConnect` and HTTP `onRequest` hooks get `request`;
   * the `onMessage` hook (which dispatches `onChatMessage` and our
   * tool `execute` callbacks) does NOT. So `currentUserEmail()` —
   * which previously only read from `getCurrentAgent().request` —
   * always returned null during a chat turn, even for interactive
   * Access users. Tools that look up the per-user GitHub token
   * (`listSourceTree`, `readSource`, and `commitPatch`'s GitHub-
   * backup leg) then returned the friendly-but-wrong "service-token
   * context" error.
   *
   * The fix is to capture the email here (where `ctx.request` IS
   * populated) and write it to the connection's state.
   * `connection.setState` persists into the WebSocket attachment
   * per partyserver's contract, so the value survives DO
   * hibernation and is recoverable from `getCurrentAgent().connection
   * ?.state?.email` on any later `onMessage` invocation.
   *
   * Service-token connections legitimately have no email. We
   * deliberately skip `setState` in that case so downstream code
   * can still distinguish "no user identity" from "user identity X"
   * via the absence of the field.
   */
  async onConnect(
    connection: Connection<{ email?: string }>,
    ctx: { request: Request },
  ) {
    const email = getAccessUserEmail(ctx.request);
    if (email) {
      connection.setState({ email });
    }
  }

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
    // Resolve the model on every turn (issue #131 item A). The client
    // sends a friendly key via `useAgentChat({ body: { model } })`;
    // `resolveAiAssistantModel` allow-list-validates and resolves to
    // the current Workers AI catalog ID. Falls back to the default
    // (Kimi K2.6) for missing / unknown / tampered values.
    const modelId = resolveAiAssistantModel(options?.body);
    const result = streamText({
      // `workersai(modelId)` returns the AI-SDK provider for the
      // chosen Workers AI model. Cast through `any` because the SDK's
      // model ID union is narrower than the catalog (Kimi K2 is in the
      // catalog but the TS type sometimes lags behind).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: workersai(modelId as any),
      // Build the system prompt fresh per turn so the current deck
      // slug (this.name) is injected into the prompt. The model can
      // see what deck it's scoped to + know the source path without
      // asking. See `buildSystemPrompt` for the rationale.
      system: buildSystemPrompt(this.name),
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
