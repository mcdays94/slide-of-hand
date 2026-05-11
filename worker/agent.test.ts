/**
 * Unit tests for the agent routing layer (issue #131 phase 1).
 *
 * These tests cover the part of `worker/agent.ts` we own: path
 * matching, Access-gate enforcement, and that we delegate to the
 * Agents SDK for matched paths. We deliberately do NOT exercise:
 *
 *   - The actual Workers AI call. Hitting `streamText` requires a
 *     real AI binding and would burn account-billed AI calls per
 *     test run. The DO + Workers AI path is validated by the manual
 *     `wrangler dev` e2e test instead (see PR description).
 *
 *   - The real Durable Object instance machinery. The SDK already
 *     tests its own DO lifecycle.
 *
 * `vi.mock` is used to stub `agents` and `@cloudflare/ai-chat` —
 * those packages import `cloudflare:workers` / `cloudflare:email`
 * at the top level, which only resolves inside the Workers runtime
 * (`vitest-pool-workers`). Stubbing keeps the suite in plain
 * happy-dom so it runs alongside the rest of the worker tests with
 * zero infrastructure changes.
 *
 * Mirrors `worker/access-auth.test.ts` for the auth-gate assertions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.mock` calls are hoisted above imports, so anything referenced
// from a mock factory must be hoisted too. `vi.hoisted` is the
// supported escape hatch.
const { routeAgentRequestMock } = vi.hoisted(() => ({
  routeAgentRequestMock: vi.fn(),
}));

// Stub the `agents` package. Top-level imports from this module
// otherwise touch `cloudflare:workers` which isn't resolvable
// outside the Workers runtime.
vi.mock("agents", () => ({
  routeAgentRequest: routeAgentRequestMock,
}));

// Stub `@cloudflare/ai-chat` because it transitively pulls in the
// same `cloudflare:` schemes via `agents`. We only need the class
// reference to be definable; the DO is never instantiated in unit
// tests.
vi.mock("@cloudflare/ai-chat", () => ({
  AIChatAgent: class {},
}));

// `workers-ai-provider` and `ai` similarly aren't needed during the
// routing tests — `onChatMessage` is never invoked here.
vi.mock("workers-ai-provider", () => ({
  createWorkersAI: () => () => ({}),
}));
vi.mock("ai", () => ({
  streamText: () => ({ toUIMessageStreamResponse: () => new Response() }),
  convertToModelMessages: async (m: unknown) => m,
}));
// `@cloudflare/sandbox` transitively pulls in `@cloudflare/containers`
// which uses ESM imports that don't resolve outside the Workers
// runtime. The routing tests never invoke `proposeSourceEdit`, so a
// stub `getSandbox` is enough to keep the import graph happy. See
// `worker/agent-tools.test.ts` for the same workaround in the tool
// tests.
vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: vi.fn(),
}));

// Import AFTER mocks are registered so the module wires up against
// the stubs.
import {
  handleAgent,
  DeckAuthorAgent,
  resolveAiAssistantModel,
  AI_ASSISTANT_MODEL_IDS,
  AI_GATEWAY_ID,
  buildSystemPrompt,
  type AgentEnv,
} from "./agent";

const stubAi = { run: async () => ({}) } as unknown as Ai;

function makeEnv(): AgentEnv {
  return {
    AI: stubAi,
    DeckAuthorAgent: {} as DurableObjectNamespace,
    // Phase 2: agent tools read from this KV namespace. The routing
    // tests never invoke the tools (the SDK delegation point is
    // mocked), so a stub is enough.
    DECKS: {} as KVNamespace,
    // Phase 3c: agent tools also need a Sandbox DO namespace for the
    // `proposeSourceEdit` flow. The routing tests don't reach that
    // code path; a bare stub satisfies the type.
    Sandbox: {} as unknown as AgentEnv["Sandbox"],
    // Phase 3a/3b: agent tools also need GITHUB_TOKENS for the
    // per-user OAuth token lookup. Same routing-test reasoning —
    // unused at the SDK delegation point, but required by the type.
    GITHUB_TOKENS: {} as KVNamespace,
  };
}

/** Construct a Request that has cleared Cloudflare Access. */
function adminRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", "test@example.com");
  return new Request(input, { ...init, headers });
}

beforeEach(() => {
  routeAgentRequestMock.mockReset();
});

describe("handleAgent — path matching", () => {
  it("returns null for non-agent paths (so other handlers can run)", async () => {
    const req = new Request("https://example.com/api/themes/hello");
    const res = await handleAgent(req, makeEnv());
    expect(res).toBeNull();
    expect(routeAgentRequestMock).not.toHaveBeenCalled();
  });

  it("returns null for the public /api/agents/... path", async () => {
    // No `/api/admin/` prefix — this handler is admin-only.
    const req = new Request("https://example.com/api/agents/whatever");
    const res = await handleAgent(req, makeEnv());
    expect(res).toBeNull();
    expect(routeAgentRequestMock).not.toHaveBeenCalled();
  });

  it("returns null for sibling /api/admin/decks paths", async () => {
    const req = new Request("https://example.com/api/admin/decks");
    const res = await handleAgent(req, makeEnv());
    expect(res).toBeNull();
    expect(routeAgentRequestMock).not.toHaveBeenCalled();
  });
});

describe("handleAgent — auth gate", () => {
  it("returns 403 when the cf-access-authenticated-user-email header is missing", async () => {
    const req = new Request(
      "https://example.com/api/admin/agents/deck-author-agent/hello",
    );
    const res = await handleAgent(req, makeEnv());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toMatch(/Cloudflare Access/i);
  });

  it("returns 403 when the cf-access header is empty", async () => {
    const req = new Request(
      "https://example.com/api/admin/agents/deck-author-agent/hello",
      { headers: { "cf-access-authenticated-user-email": "" } },
    );
    const res = await handleAgent(req, makeEnv());
    expect(res!.status).toBe(403);
  });

  it("returns 403 BEFORE delegating to the SDK (auth fails closed)", async () => {
    // This guards against a refactor that accidentally inverts the
    // order of `requireAccessAuth` and the SDK delegation. Without
    // the email header, `routeAgentRequest` must NOT be reached.
    const req = new Request(
      "https://example.com/api/admin/agents/deck-author-agent/hello",
    );
    const res = await handleAgent(req, makeEnv());
    expect(res!.status).toBe(403);
    expect(routeAgentRequestMock).not.toHaveBeenCalled();
  });
});

describe("handleAgent — delegation to Agents SDK", () => {
  it("delegates matching paths to routeAgentRequest with the admin prefix", async () => {
    routeAgentRequestMock.mockResolvedValueOnce(
      new Response("delegated", { status: 200 }),
    );
    const req = adminRequest(
      "https://example.com/api/admin/agents/deck-author-agent/hello",
    );
    const res = await handleAgent(req, makeEnv());
    expect(routeAgentRequestMock).toHaveBeenCalledOnce();
    const [forwardedRequest, , options] = routeAgentRequestMock.mock.calls[0];
    // The handler forwards the request unchanged (so WebSocket
    // upgrades survive) and sets the `prefix` option so the SDK's
    // URL parser matches our admin path layout.
    expect(forwardedRequest).toBeInstanceOf(Request);
    expect(forwardedRequest.url).toBe(req.url);
    expect(options).toMatchObject({ prefix: "api/admin/agents" });
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe("delegated");
  });

  it("returns 404 when routeAgentRequest returns null (unknown agent class)", async () => {
    routeAgentRequestMock.mockResolvedValueOnce(null);
    const req = adminRequest(
      "https://example.com/api/admin/agents/no-such-agent/hello",
    );
    const res = await handleAgent(req, makeEnv());
    expect(res!.status).toBe(404);
    expect(await res!.text()).toMatch(/agent route/i);
  });
});

describe("handleAgent — local-dev WebSocket auth fallback", () => {
  // Browsers can't set custom headers on WebSocket upgrades, so for
  // localhost we accept a `cf-access-auth-email` query param as a
  // stand-in. The dev/prod discriminator is `cf-connecting-ip`:
  // wrangler dev sets it to a loopback IP (127.0.0.1 / ::1) because
  // the dev server IS the last hop, whereas production Cloudflare
  // always populates this header with the visitor's real public IP.
  // So a loopback `cf-connecting-ip` is a reliable "this is dev"
  // signal that cannot be spoofed from a production request.

  /** Build a request that looks like it came through wrangler dev. */
  function devRequest(url: string, init: RequestInit = {}): Request {
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", "127.0.0.1");
    return new Request(url, { ...init, headers });
  }

  it("accepts the dev email via query param when cf-connecting-ip is loopback (IPv4)", async () => {
    routeAgentRequestMock.mockResolvedValueOnce(
      new Response("ok", { status: 200 }),
    );
    const req = devRequest(
      "http://127.0.0.1:5331/api/admin/agents/deck-author-agent/hello?cf-access-auth-email=dev@local",
    );
    const res = await handleAgent(req, makeEnv());
    expect(res!.status).toBe(200);
    expect(routeAgentRequestMock).toHaveBeenCalledOnce();
  });

  it("accepts the dev email via query param when cf-connecting-ip is loopback (IPv6)", async () => {
    routeAgentRequestMock.mockResolvedValueOnce(
      new Response("ok", { status: 200 }),
    );
    const req = new Request(
      "http://reaction.localhost:5331/api/admin/agents/deck-author-agent/hello?cf-access-auth-email=dev@local",
      { headers: { "cf-connecting-ip": "::1" } },
    );
    const res = await handleAgent(req, makeEnv());
    expect(res!.status).toBe(200);
  });

  it("REJECTS the dev email query param when cf-connecting-ip is a real client IP", async () => {
    // This is the critical safety property: a forged
    // `?cf-access-auth-email=…` MUST NOT bypass the auth gate when
    // the request is from a real public IP. Production traffic
    // always has a real client IP — Cloudflare's edge populates
    // `cf-connecting-ip` and never sends loopback for real visitors.
    const req = new Request(
      "https://slideofhand.lusostreams.com/api/admin/agents/deck-author-agent/hello?cf-access-auth-email=attacker@example.com",
      { headers: { "cf-connecting-ip": "203.0.113.42" } },
    );
    const res = await handleAgent(req, makeEnv());
    expect(res!.status).toBe(403);
    expect(routeAgentRequestMock).not.toHaveBeenCalled();
  });

  it("REJECTS the dev email query param when cf-connecting-ip is absent", async () => {
    // Defense-in-depth: if the header is missing entirely (some
    // misrouted internal call?), we treat as production and fail
    // closed. Cloudflare's edge always sets cf-connecting-ip on
    // user-facing requests.
    const req = new Request(
      "https://slideofhand.lusostreams.com/api/admin/agents/deck-author-agent/hello?cf-access-auth-email=attacker@example.com",
    );
    const res = await handleAgent(req, makeEnv());
    expect(res!.status).toBe(403);
    expect(routeAgentRequestMock).not.toHaveBeenCalled();
  });

  it("the dev fallback does NOT override an already-present Access header", async () => {
    // If Access (or a proxy) DOES set the header, we must use that
    // value, not a query param that might disagree.
    routeAgentRequestMock.mockResolvedValueOnce(
      new Response("ok", { status: 200 }),
    );
    const req = devRequest(
      "http://127.0.0.1:5331/api/admin/agents/deck-author-agent/hello?cf-access-auth-email=other@local",
      { headers: { "cf-access-authenticated-user-email": "real@local" } },
    );
    const res = await handleAgent(req, makeEnv());
    expect(res!.status).toBe(200);
  });
});

// ─── onConnect — item B (issue #131) email plumbing ──────────────────
//
// The bug: the agents SDK only populates `getCurrentAgent().request`
// during the upgrade `onConnect` hook and the plain HTTP `onRequest`
// hook. During `onMessage` (which dispatches `onChatMessage` and the
// tool `execute` callbacks), `request` is undefined. So every tool
// that needed the per-user email — `listSourceTree`, `readSource`,
// and `commitPatch`'s GitHub-backup leg — returned the "service-token
// context" error message even for interactive Access users.
//
// The fix: override `onConnect` on `DeckAuthorAgent`, read the email
// from the Access-issued header on `ctx.request`, and stash it on
// `connection.setState({ email })` so later `onMessage` calls can
// recover it through `getCurrentAgent().connection?.state?.email`.
// `Connection.setState` persists into the WebSocket attachment per
// the partyserver SDK docs, so the value survives DO hibernation
// transparently.

describe("DeckAuthorAgent.onConnect (issue #131 item B)", () => {
  // `AIChatAgent` is mocked above as `class {}`, so we can instantiate
  // `DeckAuthorAgent` directly without the real DO machinery. The
  // test only exercises our own `onConnect` override.
  function makeAgent(): InstanceType<typeof DeckAuthorAgent> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (DeckAuthorAgent as any)();
  }

  // Minimum-viable mock of partyserver's `Connection`. Real
  // connections are a WebSocket-with-id; the only surface we touch
  // in `onConnect` is `setState`.
  function makeConnection() {
    const setState = vi.fn();
    return {
      id: "conn-test",
      state: undefined,
      setState,
    };
  }

  it("stashes the Access user email on connection state when the upgrade request carries cf-access-authenticated-user-email", async () => {
    const agent = makeAgent();
    const connection = makeConnection();
    const ctx = {
      request: new Request("https://example.com/upgrade", {
        headers: {
          "cf-access-authenticated-user-email": "miguel@cloudflare.com",
        },
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (agent as any).onConnect(connection, ctx);
    expect(connection.setState).toHaveBeenCalledTimes(1);
    expect(connection.setState).toHaveBeenCalledWith({
      email: "miguel@cloudflare.com",
    });
  });

  it("does NOT call setState when there is no Access email header (service-token connection)", async () => {
    // Service tokens authenticate at Access (via the JWT signal) but
    // carry no email. We must NOT stash an empty value — downstream
    // code distinguishes "no user identity" from "user identity X"
    // and uses that distinction to drive friendly error messages.
    const agent = makeAgent();
    const connection = makeConnection();
    const ctx = {
      request: new Request("https://example.com/upgrade"),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (agent as any).onConnect(connection, ctx);
    expect(connection.setState).not.toHaveBeenCalled();
  });

  it("does NOT call setState when the email header is an empty string", async () => {
    // Defense against header-injection-style oddities — Access never
    // sends an empty value for a successful interactive session, but
    // a misrouted internal request could. Treat empty as absent.
    const agent = makeAgent();
    const connection = makeConnection();
    const ctx = {
      request: new Request("https://example.com/upgrade", {
        headers: { "cf-access-authenticated-user-email": "" },
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (agent as any).onConnect(connection, ctx);
    expect(connection.setState).not.toHaveBeenCalled();
  });
});

// ─── resolveAiAssistantModel (issue #131 item A) ─────────────────────
//
// The client sends a friendly model key (e.g. "kimi-k2.6") on every
// chat turn via `useAgentChat`'s `body` option. The server must (a)
// resolve the key to a Workers AI catalog ID and (b) defend in depth
// against arbitrary client-supplied values — the key MUST be in the
// allow-list, otherwise the catalog default is used. This keeps the
// server in control of which models can actually be invoked, even if
// the client UI gets out of sync with the catalog (stale builds,
// localStorage tampering, etc.).

describe("resolveAiAssistantModel (issue #131 item A)", () => {
  it("exposes AI_ASSISTANT_MODEL_IDS with one entry per friendly key", () => {
    // Three friendly keys, three catalog IDs. The IDs come straight
    // from `npx wrangler ai models` (verified 2026-05-11). If any
    // catalog ID 5018s on Workers AI, the test won't catch it — only
    // a real invocation will. But pinning the IDs here means a stray
    // diff (e.g. accidental rename) is visible in code review.
    expect(AI_ASSISTANT_MODEL_IDS).toEqual({
      "kimi-k2.6": "@cf/moonshotai/kimi-k2.6",
      "llama-4-scout": "@cf/meta/llama-4-scout-17b-16e-instruct",
      "gpt-oss-120b": "@cf/openai/gpt-oss-120b",
    });
  });

  it("returns the default catalog ID when body is undefined", () => {
    expect(resolveAiAssistantModel(undefined)).toBe(
      "@cf/moonshotai/kimi-k2.6",
    );
  });

  it("returns the default catalog ID when body has no model key", () => {
    expect(resolveAiAssistantModel({})).toBe("@cf/moonshotai/kimi-k2.6");
  });

  it("returns the default catalog ID when body.model is not a string", () => {
    expect(resolveAiAssistantModel({ model: 42 })).toBe(
      "@cf/moonshotai/kimi-k2.6",
    );
    expect(resolveAiAssistantModel({ model: null })).toBe(
      "@cf/moonshotai/kimi-k2.6",
    );
    expect(resolveAiAssistantModel({ model: { nested: "x" } })).toBe(
      "@cf/moonshotai/kimi-k2.6",
    );
  });

  it("returns the default catalog ID when body.model is an unknown string", () => {
    // The defence-in-depth case: client says "claude-3-opus" (not in
    // our allow-list because Workers AI doesn't have it) → fall back
    // to the default rather than passing through to streamText where
    // it would 5018.
    expect(resolveAiAssistantModel({ model: "claude-3-opus" })).toBe(
      "@cf/moonshotai/kimi-k2.6",
    );
    expect(resolveAiAssistantModel({ model: "" })).toBe(
      "@cf/moonshotai/kimi-k2.6",
    );
  });

  it("returns the kimi catalog ID for body.model = 'kimi-k2.6'", () => {
    expect(resolveAiAssistantModel({ model: "kimi-k2.6" })).toBe(
      "@cf/moonshotai/kimi-k2.6",
    );
  });

  it("returns the llama-4-scout catalog ID for body.model = 'llama-4-scout'", () => {
    expect(resolveAiAssistantModel({ model: "llama-4-scout" })).toBe(
      "@cf/meta/llama-4-scout-17b-16e-instruct",
    );
  });

  it("returns the gpt-oss catalog ID for body.model = 'gpt-oss-120b'", () => {
    expect(resolveAiAssistantModel({ model: "gpt-oss-120b" })).toBe(
      "@cf/openai/gpt-oss-120b",
    );
  });
});

// ─── buildSystemPrompt ───────────────────────────────────────────────
//
// Surfaced post-deploy 2026-05-11: user asked "what is this deck about?"
// on a build-time deck and the agent listed all 5 public decks then
// asked "which one are you editing?" — even though the agent instance
// is keyed by the slug. The old static SYSTEM_PROMPT never told the
// model. Fix: inject the slug into the prompt up front so the agent
// knows + the source path is concrete for build-time decks.

describe("buildSystemPrompt", () => {
  it("includes the current deck slug verbatim", () => {
    const prompt = buildSystemPrompt("cf247-dtx-manchester");
    expect(prompt).toMatch(/cf247-dtx-manchester/);
  });

  it("tells the model it is SCOPED to the slug (so it doesn't ask)", () => {
    const prompt = buildSystemPrompt("hello");
    expect(prompt).toMatch(/scoped to the deck/i);
    // The "don't ask which deck" instruction is the load-bearing
    // behavioural change — pin it explicitly.
    expect(prompt).toMatch(/don't ask the user which deck/i);
  });

  it("gives the concrete source path for build-time decks", () => {
    // The fix isn't just "tell the model the slug" — it's "tell the
    // model the FILE PATH for build-time decks". Otherwise the model
    // might still flail looking for the deck under a wrong path.
    const prompt = buildSystemPrompt("hello");
    expect(prompt).toMatch(/src\/decks\/public\/hello/);
  });

  it("references the slug in the data-deck section (so commitPatch knows where it goes)", () => {
    const prompt = buildSystemPrompt("my-talk");
    // The data-decks/<slug>.json line should resolve to the actual slug.
    expect(prompt).toMatch(/data-decks\/my-talk\.json/);
  });

  it("escapes special chars safely (slug used in template literal — no injection)", () => {
    // Slugs come from the URL (DO instance name) — guarded upstream
    // by `name` validation in the SDK, but belt-and-braces: a slug
    // with backticks shouldn't break the resulting string.
    const prompt = buildSystemPrompt("safe-slug-123");
    expect(prompt).toMatch(/safe-slug-123/);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("still lists all six tools", () => {
    const prompt = buildSystemPrompt("any");
    for (const tool of [
      "readDeck",
      "proposePatch",
      "commitPatch",
      "listSourceTree",
      "readSource",
      "proposeSourceEdit",
    ]) {
      expect(prompt).toContain(tool);
    }
  });
});

// ─── AI Gateway integration ──────────────────────────────────────────
//
// All Workers AI calls go through Cloudflare AI Gateway for free
// observability + caching + budget. The slug is exported so we can
// pin it via a test — if it changes, the user's dashboard view of the
// agent's traffic will move to a new bucket.

describe("AI_GATEWAY_ID", () => {
  it("pins the gateway slug for the agent's Workers AI calls", () => {
    // Auto-provisioned on first request. If we ever rename, the
    // dashboard's AI Gateway tab will show a NEW gateway with the
    // new name — old logs/budgets won't follow. Keep an explicit
    // test so the rename is visible in code review.
    expect(AI_GATEWAY_ID).toBe("slide-of-hand-agent");
  });
});
