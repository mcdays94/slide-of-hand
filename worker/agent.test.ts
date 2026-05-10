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

// Import AFTER mocks are registered so the module wires up against
// the stubs.
import { handleAgent, type AgentEnv } from "./agent";

const stubAi = { run: async () => ({}) } as unknown as Ai;

function makeEnv(): AgentEnv {
  return {
    AI: stubAi,
    DeckAuthorAgent: {} as DurableObjectNamespace,
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
