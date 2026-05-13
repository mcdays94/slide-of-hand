/**
 * Tests for `worker/cf-dynamic-workers/index.ts` — the route handler
 * for the cf-dynamic-workers live-demo backend (issue #167).
 *
 * Mocks the spawn module so each test exercises the router's
 * dispatch, validation, and response shape — without standing up
 * the Worker Loader binding (covered separately by spawn.test.ts).
 * Mirrors the established mock pattern used elsewhere in
 * `worker/*.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks for the spawn module's exported functions.
const {
  spawnMock,
  spawnManyMock,
  spawnGlobeMock,
  forwardSessionMock,
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnManyMock: vi.fn(),
  spawnGlobeMock: vi.fn(),
  forwardSessionMock: vi.fn(),
}));
vi.mock("./spawn", () => ({
  spawn: spawnMock,
  spawnMany: spawnManyMock,
  spawnGlobe: spawnGlobeMock,
  forwardSession: forwardSessionMock,
}));

import {
  handleCfDynamicWorkers,
  type CfDynamicWorkersEnv,
} from "./index";

/** Build a minimum-viable env with stub bindings (router never invokes them). */
function makeEnv(overrides?: Partial<CfDynamicWorkersEnv>): CfDynamicWorkersEnv {
  return {
    LOADER: { load: vi.fn(), get: vi.fn() } as unknown as WorkerLoader,
    AI: { run: vi.fn() } as unknown as Ai,
    SELF: { fetch: vi.fn() } as unknown as Fetcher,
    ...overrides,
  };
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnManyMock.mockReset();
  spawnGlobeMock.mockReset();
  forwardSessionMock.mockReset();
});

describe("handleCfDynamicWorkers — fall-through", () => {
  it("returns null for non-matching paths so the main fetch chain continues", async () => {
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/not/our/namespace"),
      makeEnv(),
    );
    expect(res).toBeNull();
  });

  it("does NOT match a near-miss prefix (defence against typos / path traversal)", async () => {
    // `/api/cf-dynamic-workers-OOPS/spawn` shouldn't match.
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers-OOPS/spawn"),
      makeEnv(),
    );
    expect(res).toBeNull();
  });
});

describe("handleCfDynamicWorkers — /health", () => {
  it("returns 200 with binding availability flags", async () => {
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/health"),
      makeEnv(),
    );
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      loaderAvailable: true,
      aiAvailable: true,
      selfAvailable: true,
    });
  });

  it("reports missing bindings as available:false", async () => {
    // Cast to undefined explicitly to model the absent-binding case.
    const env = makeEnv();
    (env as unknown as { LOADER: undefined }).LOADER = undefined;
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/health"),
      env,
    );
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.loaderAvailable).toBe(false);
  });
});

describe("handleCfDynamicWorkers — /spawn", () => {
  it("forwards a valid POST to spawn() and returns its envelope", async () => {
    spawnMock.mockResolvedValue({
      id: "iso_abcd1234",
      elapsedMs: 42,
      memoryKb: 0,
      ok: true,
      result: { kind: "compute", value: 7919 },
    });
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snippet: "compute" }),
      }),
      makeEnv(),
    );
    expect(res?.status).toBe(200);
    expect(spawnMock).toHaveBeenCalledWith(
      expect.objectContaining({ LOADER: expect.anything() }),
      "compute",
      undefined,
    );
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.id).toBe("iso_abcd1234");
  });

  it("passes the code override through to spawn()", async () => {
    spawnMock.mockResolvedValue({
      id: "iso_xx",
      elapsedMs: 1,
      memoryKb: 0,
      ok: true,
    });
    await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snippet: "compute",
          code: "export default { fetch() { return new Response('hi'); } };",
        }),
      }),
      makeEnv(),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      expect.anything(),
      "compute",
      expect.stringContaining("Response('hi')"),
    );
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
      makeEnv(),
    );
    expect(res?.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns 400 on missing snippet id", async () => {
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      makeEnv(),
    );
    expect(res?.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("handleCfDynamicWorkers — /spawn-many", () => {
  it("forwards to spawnMany() with the count", async () => {
    spawnManyMock.mockResolvedValue({
      count: 10,
      totalElapsedMs: 89,
      ok: true,
      isolates: [],
    });
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/spawn-many", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 10 }),
      }),
      makeEnv(),
    );
    expect(res?.status).toBe(200);
    expect(spawnManyMock).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("defaults the count to 10 when omitted from the body", async () => {
    spawnManyMock.mockResolvedValue({
      count: 10,
      totalElapsedMs: 50,
      ok: true,
      isolates: [],
    });
    await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/spawn-many", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      makeEnv(),
    );
    expect(spawnManyMock).toHaveBeenCalledWith(expect.anything(), 10);
  });
});

describe("handleCfDynamicWorkers — /spawn/globe", () => {
  it("forwards to spawnGlobe() and returns its envelope", async () => {
    spawnGlobeMock.mockResolvedValue({
      id: "iso_globe",
      elapsedMs: 12,
      ok: true,
      sessionUrl: "/api/cf-dynamic-workers/session/iso_globe/",
    });
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/spawn/globe", {
        method: "POST",
      }),
      makeEnv(),
    );
    expect(res?.status).toBe(200);
    expect(spawnGlobeMock).toHaveBeenCalled();
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.sessionUrl).toContain("/api/cf-dynamic-workers/session/");
  });
});

describe("handleCfDynamicWorkers — /session/:id/*", () => {
  it("forwards to forwardSession() with the parsed id + subpath", async () => {
    forwardSessionMock.mockResolvedValue(
      new Response("globe html", { status: 200 }),
    );
    const res = await handleCfDynamicWorkers(
      new Request(
        "https://example.com/api/cf-dynamic-workers/session/iso_abcd1234/index.html?foo=bar",
      ),
      makeEnv(),
    );
    expect(res?.status).toBe(200);
    expect(forwardSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "iso_abcd1234",
      "/index.html?foo=bar",
      expect.any(Request),
    );
  });

  it("returns 400 on a malformed session path", async () => {
    const res = await handleCfDynamicWorkers(
      new Request(
        "https://example.com/api/cf-dynamic-workers/session/!!invalid!!/x",
      ),
      makeEnv(),
    );
    expect(res?.status).toBe(400);
    expect(forwardSessionMock).not.toHaveBeenCalled();
  });
});

describe("handleCfDynamicWorkers — /__internal/ai-proxy", () => {
  it("calls env.AI.run with the body's model + input and returns the result", async () => {
    const env = makeEnv();
    (env.AI.run as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      response: "Hello from Workers AI",
    });
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/__internal/ai-proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.1-8b-instruct",
          input: { prompt: "hi" },
        }),
      }),
      env,
    );
    expect(res?.status).toBe(200);
    expect(env.AI.run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.1-8b-instruct",
      { prompt: "hi" },
    );
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.response).toBe("Hello from Workers AI");
  });

  it("returns 405 for non-POST", async () => {
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/__internal/ai-proxy"),
      makeEnv(),
    );
    expect(res?.status).toBe(405);
  });

  it("returns 502 when env.AI.run throws (AI service error)", async () => {
    const env = makeEnv();
    (env.AI.run as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("AI gateway unreachable"),
    );
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/__internal/ai-proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "x", input: {} }),
      }),
      env,
    );
    expect(res?.status).toBe(502);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.error).toBe("ai_run_failed");
    expect(body.message).toContain("AI gateway");
  });
});

describe("handleCfDynamicWorkers — unmatched namespace path", () => {
  it("returns 404 (JSON) rather than falling through to the SPA", async () => {
    const res = await handleCfDynamicWorkers(
      new Request("https://example.com/api/cf-dynamic-workers/no-such-route"),
      makeEnv(),
    );
    expect(res?.status).toBe(404);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });
});
