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
import { buildTools, currentUserEmail } from "./agent-tools";
import { buildAiGatewayHeaders } from "./ai-gateway";
import { fetchMcpTools } from "./mcp-tools";
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
  /**
   * Cloudflare Artifacts binding (issue #168 Wave 1). Backs the new
   * `createDeckDraft` + `iterateOnDeckDraft` tools — per-user git
   * repos for AI-generated deck drafts.
   */
  ARTIFACTS: Artifacts;
  /**
   * Per-user MCP server registry (issue #168 Wave 6). When bound,
   * `onChatMessage` reads the calling user's configured servers and
   * merges their tools into the agent's toolset for the turn.
   *
   * Declared OPTIONAL so the Worker compiles + the agent keeps
   * working before the binding lands in `wrangler.jsonc`. With the
   * binding absent the merge is a no-op; existing chat behaviour is
   * unchanged.
   */
  MCP_SERVERS?: KVNamespace;
  /**
   * Cloudflare AI Gateway authentication token (Worker secret, set
   * via `wrangler secret put CF_AI_GATEWAY_TOKEN`). Required when
   * the `slide-of-hand-agent` gateway has Authenticated Gateway
   * enabled in the Cloudflare dashboard — without it, every
   * Workers AI call routed through the gateway returns error 2001
   * ("Please configure AI Gateway in the Cloudflare dashboard").
   *
   * Forwarded as the `cf-aig-authorization: Bearer <token>` header
   * via the workers-ai-provider's `extraHeaders` option. See the
   * `onChatMessage` site below and `worker/ai-deck-gen.ts` for the
   * matching plumbing on the deck-generation path.
   *
   * Declared OPTIONAL so a future gateway flip back to
   * unauthenticated continues to work without code changes — when
   * the secret is unset we just don't send the header. The gateway
   * is the load-bearing security boundary here, not this header.
   */
  CF_AI_GATEWAY_TOKEN?: string;
  /**
   * Cloudflare account ID (from `vars.CF_ACCOUNT_ID` in
   * `wrangler.jsonc`). Forwarded to the deck-creation orchestrator
   * so it can deterministically construct the Artifacts remote URL
   * — see `buildArtifactsRemoteUrl` in `artifacts-client.ts` for
   * why we can't trust the SDK's `repo.remote` getter.
   *
   * Typed as optional to match `AnalyticsEnv`'s convention; runtime
   * check in the orchestrator throws if missing.
   */
  CF_ACCOUNT_ID?: string;
}

/**
 * Cloudflare AI Gateway slug. Every Workers AI call from the agent
 * is routed through this gateway so we get:
 *
 *   - **Free observability** — request/response logs in the
 *     Cloudflare dashboard's AI Gateway tab (latency, cost, error
 *     rates, prompt + response capture).
 *   - **Caching** — identical requests within a TTL can be served
 *     from cache instead of re-billed.
 *   - **Budget + rate limiting** — configurable in the dashboard.
 *   - **Retries + fallbacks** — gateway-level reliability layer.
 *
 * AI Gateway is FREE for Workers AI requests (you only pay the
 * underlying Workers AI cost). First request with this gateway ID
 * auto-creates the gateway entry in the dashboard — no wrangler
 * config or manual provisioning needed.
 *
 * The slug is hardcoded for now. If we ever need different gateways
 * per environment (preview vs prod) or want to expose this as a
 * Worker secret, lift it into a wrangler var. For v1, one gateway
 * for the whole agent is fine.
 *
 * Docs: https://developers.cloudflare.com/ai-gateway/
 */
export const AI_GATEWAY_ID = "slide-of-hand-agent";

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
  "gemma-4": "@cf/google/gemma-4-26b-a4b-it",
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
export function buildSystemPrompt(
  slug: string,
  /**
   * Per-turn context passed through `useAgentChat({ body })`. Only
   * the fields we recognise are read here; everything else is
   * ignored. Currently used for:
   *
   *   - `visibility` — the user's selected default visibility on
   *     the new-deck creator surface. When set, the prompt for the
   *     creator surface instructs the model to pass this value
   *     through to `createDeckDraft` unless the user explicitly
   *     overrides it in chat. Issue #171 visibility toggle.
   */
  body: Record<string, unknown> | undefined = undefined,
): string {
  // Branch on the instance-name prefix: the new-deck creator
  // (`/admin/decks/new`) generates per-tab UUIDs prefixed
  // `new-deck-` (see `src/routes/admin/decks.new.tsx`'s
  // `makeNewDeckAgentName`). The historic existing-deck surfaces
  // (`/admin/decks/<slug>`, `/decks/<slug>`) use the actual deck
  // slug as the instance name. Different surfaces want different
  // prompts:
  //
  //   - existing-deck: "you're looking at this deck, here's how
  //     to read/edit/iterate on it"
  //   - new-deck creator: "the user wants to CREATE a deck; there
  //     is no existing deck; pick a slug + call createDeckDraft"
  //
  // Sending the existing-deck prompt on the creator surface led
  // the model into a confused state (telling it `readDeck` would
  // find something at the UUID slug, when nothing's there) —
  // surfaced 2026-05-12 during the post-#176 verification.
  if (slug.startsWith("new-deck-")) {
    return buildNewDeckCreatorSystemPrompt(body);
  }
  return `You are an AI assistant embedded in Slide of Hand, a JSX-first
deck platform. Help the author plan, refine, create, and iterate on
decks. Be concise and pragmatic. Speak like a thoughtful collaborator,
not a tool registry — never mention internal tool names to the user.

CURRENT CONTEXT:

You are scoped to the deck with slug \`${slug}\`. This is the deck the
user is looking at right now — don't ask the user which deck they
want to work on, you already know. If the data-deck lookup returns
nothing, this is a build-time JSX deck and its source lives at
\`src/decks/public/${slug}/\` in the repo. Browse that directory and
read the relevant files before answering questions about it.

WHAT USERS WILL ASK FOR:

1. **Questions or descriptions about the current deck.** Start by
   reading it. Try the data-deck lookup first; if it returns nothing,
   list the source directory and read the relevant files. Don't
   speculate about content you haven't actually seen.

2. **Small changes to the current deck** — re-order a slide, edit a
   title, tweak content, change a colour. Two paths depending on the
   deck type:

   - **Data decks** (KV-backed). Propose a partial dry-run patch
     first, describe in plain English what would change, then ask
     "does that look right?". ONLY persist the change AFTER the user
     explicitly confirms ("yes", "ship it", "go ahead", or similar).
     Persisting also writes a versioned backup to
     \`data-decks/${slug}.json\` in the GitHub repo.

   - **Build-time JSX decks.** Read the relevant files first, then
     compose the COMPLETE new content (the edit submission replaces
     each file wholesale, not a partial diff), and submit a
     Sandbox-validated draft pull request. The draft PR URL is the
     user's review surface — share it and stop. Don't pretend the
     change has shipped until they merge it themselves on GitHub.

3. **"Build me a deck about <topic>"** / **"Make a deck explaining
   <X>"** / **"I want a deck about <Y>"**. Draft a new deck in the
   user's personal scratch space. Pick a kebab-case slug from the
   topic — e.g. "build me a deck about CRDT collaborative editing"
   → \`crdt-collab\` (short, descriptive, lowercase, hyphens only,
   2-64 chars). The new deck is a private draft; it is NOT yet on
   GitHub or in the live deck list. Tell the user the slug you
   picked when you reply.

4. **"Change the title slide on my draft"** / **"Add a slide about
   X to my draft"** / similar follow-ups to a deck the user has
   been creating with you. Iterate on the existing draft instead of
   starting a new one. Use the slug the user has been working with.

CONFIRMATION DISCIPLINE:

- Never persist a change to a data deck without an explicit user
  "yes" between your dry-run proposal and the commit. NEVER chain
  proposal → commit without confirmation.
- Never claim a change is live unless the system actually confirmed
  it (the persistence call returned success, or the pull request was
  opened with a URL).
- Draft pull requests are reviewed and merged BY THE USER. Don't
  describe a draft PR's contents as "deployed" or "shipped" — they
  aren't until the user merges.

If a tool returns "GitHub not connected", tell the user how to
connect (Settings → GitHub → Connect). Don't keep retrying after a
"not connected" error.

TOOL REFERENCE (for your own bookkeeping — do not mention these
names or their schemas to the user):

- Inspect current deck: \`readDeck\` (data), \`listSourceTree\` and
  \`readSource\` (build-time / any source file).
- Edit data deck: \`proposePatch\` then \`commitPatch\` (after user
  confirms). \`commitPatch\` also writes the versioned backup to
  \`data-decks/${slug}.json\`.
- Edit build-time JSX or any other source file: \`proposeSourceEdit\`.
- Create a new deck draft from a prompt: \`createDeckDraft\`.
- Iterate on a draft the user has been working with:
  \`iterateOnDeckDraft\`.
- Publish a draft to GitHub as a draft PR: \`publishDraft\`. Use
  when the user says "publish", "open a PR", "make it live", or
  "deploy" referring to a draft they've been iterating on. The
  user reviews + merges on GitHub.`;
}

/**
 * Allowed visibility values for the new-deck creator. Matches the
 * UI's `<VisibilitySelector>` and threads through to the generated
 * deck's `meta.visibility`. Anything else in `body.visibility` is
 * ignored (defence against a tampered client).
 */
const VALID_VISIBILITY = new Set<string>(["public", "private"]);

/**
 * Pull the user's default visibility choice out of `useAgentChat`'s
 * `body` payload. Returns `"private"` (safe default) when the body
 * is missing, malformed, or carries an unknown value.
 */
function resolveDefaultVisibility(
  body: Record<string, unknown> | undefined,
): "public" | "private" {
  const candidate = body?.visibility;
  if (typeof candidate === "string" && VALID_VISIBILITY.has(candidate)) {
    return candidate as "public" | "private";
  }
  return "private";
}

/**
 * System prompt for the new-deck creator surface (`/admin/decks/new`,
 * instance name prefixed `new-deck-`). The user is sitting in front
 * of an EMPTY surface — there is no existing deck. The job here is:
 *
 *   1. Take their natural-language prompt.
 *   2. Pick a kebab-case slug from the topic.
 *   3. Call `createDeckDraft({ slug, prompt, visibility })`.
 *   4. Share the resulting draft slug + commit, and offer to
 *      iterate.
 *
 * The visibility default is captured by the UI toggle and shipped
 * through `useAgentChat({ body: { visibility } })`. The model
 * passes this value through to the tool unless the user explicitly
 * says otherwise.
 *
 * Critically: this prompt does NOT tell the model it is "scoped to
 * an existing deck" or that `src/decks/public/<slug>/` is a useful
 * path to browse — both are lies on this surface. The
 * historic existing-deck prompt led the model into a confused
 * state when sent here (post-#176 production diagnostic, 2026-05-12).
 */
function buildNewDeckCreatorSystemPrompt(
  body: Record<string, unknown> | undefined,
): string {
  const visibility = resolveDefaultVisibility(body);
  return `You are the AI assistant for creating new decks in Slide of Hand,
a JSX-first deck platform. The user is on the new-deck creator
page — there is NO existing deck to read or modify. Your job is
to take their prompt and create a draft for them. Be concise and
pragmatic. Speak like a thoughtful collaborator, not a tool
registry — never mention internal tool names to the user.

WHAT TO DO

When the user describes a deck they want — a topic, an audience,
a desired length, anything — create a draft:

1. Pick a kebab-case slug from the topic. Short, descriptive,
   lowercase letters / digits / hyphens, 2-64 chars, starts with a
   letter, ends with a letter or digit. Example: "build me a
   deck about CRDT collaborative editing" → \`crdt-collab\`.

2. Create the draft. Pass the user's prompt through verbatim,
   pass the slug you picked, and pass the visibility (see below).
   The draft is saved to the user's personal scratch space in
   Cloudflare Artifacts as \`\${userEmail}-\${slug}\`. It is NOT
   yet on GitHub or in the live deck list.

3. Tell the user the slug you picked and confirm the visibility
   you used.

VISIBILITY

The user has selected a default visibility for new decks: **${visibility}**.

Pass \`visibility: "${visibility}"\` to the create-draft tool unless
the user explicitly overrides it ("make it public", "actually keep
it private", etc.) in their prompt. If the user explicitly chooses
the opposite, use their explicit choice instead.

ITERATION

After the draft is created the user may want changes — add a slide,
edit a title, change the colour, restructure. Iterate on the
existing draft using the slug you picked. Don't create a new draft
each turn.

PUBLISHING

Once the user is happy with the draft and wants to SHIP it — they
say "publish", "open a PR", "make it live", "deploy", "save this
to GitHub", or anything similar — call the publish tool with the
slug. The publish flow clones the draft from their personal
scratch space, copies the files into the slide-of-hand repo, runs
the full test gate, and opens a draft pull request against
\`main\`. Requires GitHub to be connected (Settings → GitHub →
Connect); if that's missing the tool returns a friendly error
the user can act on.

When publish succeeds you'll get a PR number + URL — share the URL
verbatim so the user can review it. Do NOT claim the deck is "live"
or "shipped" until the user has actually merged the PR themselves
on GitHub. If the test gate fails (e.g. a typecheck error in the
generated code), iterate on the draft to fix it, then publish
again.

CONFIRMATION DISCIPLINE

- Don't claim the draft is "deployed" or "shipped" — it isn't,
  even after publishing. It's a draft PR sitting on GitHub until
  the user merges it.
- When the create-draft tool returns successfully, share the slug
  and the first commit SHA. That's the user's reference for what
  was made.
- When the publish tool returns successfully, share the PR URL.

TOOL REFERENCE (for your own bookkeeping — do not mention these
names or their schemas to the user):

- Create a new draft from a prompt: \`createDeckDraft\`.
- Iterate on the draft the user has been working with:
  \`iterateOnDeckDraft\`.
- Publish the draft to GitHub as a draft PR: \`publishDraft\`.

You may also be asked questions that aren't deck creation. Answer
them concisely without inventing tool calls — the read/edit tools
in this conversation don't have a target deck on this surface.`;
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
    // Route the model call through Cloudflare AI Gateway for
    // observability + caching + budget controls. Free for Workers
    // AI; gateway auto-provisions on first request. See
    // `AI_GATEWAY_ID` above for rationale.
    const workersai = createWorkersAI({
      binding: this.env.AI,
      gateway: { id: AI_GATEWAY_ID },
    });
    // `this.name` is the agent instance name — for phase 1/2 we key
    // the instance by deck slug (see header for why per-deck, not
    // per-(user, deck), is fine for phase 2). The tools close over
    // it so `readDeck`/`proposePatch` always operate on the deck the
    // user is actually editing.
    const baseTools = buildTools(this.env, this.name);
    // Merge in any MCP-sourced tools the user has configured (issue
    // #168 Wave 6). `fetchMcpTools` never throws — failures from
    // individual servers are logged + that server's tools are
    // dropped, while built-in tools and other servers keep working.
    //
    // `currentUserEmail()` reads from the same AsyncLocalStorage
    // context that `currentUserEmail()` uses elsewhere — falls
    // through request → connection state → null. Service-token
    // contexts have no email, so the merge returns an empty record
    // for them — fine, MCP servers are an author-side feature.
    const email = currentUserEmail();
    const mcpTools = email
      ? await fetchMcpTools(this.env, email)
      : {};
    const tools = { ...baseTools, ...mcpTools };
    // Resolve the model on every turn (issue #131 item A). The client
    // sends a friendly key via `useAgentChat({ body: { model } })`;
    // `resolveAiAssistantModel` allow-list-validates and resolves to
    // the current Workers AI catalog ID. Falls back to the default
    // (Kimi K2.6) for missing / unknown / tampered values.
    const modelId = resolveAiAssistantModel(options?.body);
    // AI Gateway authentication header (only sent when the gateway
    // is configured as Authenticated). Returns `undefined` when the
    // CF_AI_GATEWAY_TOKEN secret isn't set, so the spread is a no-op
    // and the chat stream still works against an unauthenticated
    // gateway.
    const aiGatewayHeaders = buildAiGatewayHeaders(
      this.env.CF_AI_GATEWAY_TOKEN,
    );
    const result = streamText({
      // `workersai(modelId, settings)` returns the AI-SDK provider
      // for the chosen Workers AI model. Cast through `any` because
      // the SDK's model ID union is narrower than the catalog
      // (Kimi K2 is in the catalog but the TS type sometimes lags
      // behind).
      // The second arg threads `cf-aig-authorization` through to
      // the underlying `binding.run(model, inputs, { extraHeaders })`
      // call — see `node_modules/workers-ai-provider/src/workersai-
      // chat-language-model.ts:getRunOptions` for the wire path.
      model: workersai(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        modelId as any,
        aiGatewayHeaders ? { extraHeaders: aiGatewayHeaders } : {},
      ),
      // Build the system prompt fresh per turn so the current deck
      // slug (this.name) is injected into the prompt. The model can
      // see what deck it's scoped to + know the source path without
      // asking. See `buildSystemPrompt` for the rationale.
      //
      // `options?.body` carries per-turn caller context — the
      // new-deck creator surface uses it to forward the user's
      // current Public/Private toggle selection so the model knows
      // which visibility to pass to `createDeckDraft` (issue #171
      // visibility toggle).
      system: buildSystemPrompt(this.name, options?.body),
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
