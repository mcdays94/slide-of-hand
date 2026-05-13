/**
 * Tests for `worker/cf-code-mode/index.ts` — the route handler for the
 * cf-code-mode live-demo backend (issue #167).
 *
 * Mocks the heavy lib modules (`./lib/run-mcp`, `./lib/run-code-mode`,
 * `./lib/ai-call`) so each test exercises the router's dispatch +
 * validation + response shape — without standing up AI Gateway calls
 * or Worker Loader spawns. The lib modules themselves are pure ports
 * from the source deck and are covered by integration smoke (manual
 * post-deploy curl against `/api/cf-code-mode/health` etc.).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks for the run* dispatchers + ai-call status helpers.
const { runMcpMock, runCodeModeMock } = vi.hoisted(() => ({
  runMcpMock: vi.fn(),
  runCodeModeMock: vi.fn(),
}));
vi.mock("./lib/run-mcp", () => ({ runMcp: runMcpMock }));
vi.mock("./lib/run-code-mode", () => ({ runCodeMode: runCodeModeMock }));

// ai-call exports both module-level state functions + AI_GATEWAY_ID.
// We import the real module's AI_GATEWAY_ID but stub the status helpers
// so they return deterministic values regardless of test order.
vi.mock("./lib/ai-call", async () => {
  const actual = await vi.importActual<typeof import("./lib/ai-call")>(
    "./lib/ai-call",
  );
  return {
    ...actual,
    gatewayStatus: vi.fn(() => "unknown"),
    gatewayLastError: vi.fn(() => null),
  };
});

import {
  handleCfCodeMode,
  type CfCodeModeEnv,
} from "./index";

/**
 * Build a minimum-viable env. Bindings are stubbed; the router never
 * dereferences them on the routes covered here (the heavy work happens
 * inside the mocked run-mcp / run-code-mode modules).
 */
function makeEnv(overrides?: Partial<CfCodeModeEnv>): CfCodeModeEnv {
  return {
    AI: { run: vi.fn() } as unknown as Ai,
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    LOADER: { load: vi.fn(), get: vi.fn() } as unknown as WorkerLoader,
    CF_API_TOKEN: "fake-cf-api-token",
    CF_ACCOUNT_ID: "1bcef46cbe9172d2569dcf7039048842",
    AI_GATEWAY_TOKEN: undefined,
    ...overrides,
  };
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

beforeEach(() => {
  runMcpMock.mockReset();
  runCodeModeMock.mockReset();
  // Default each run-* mock to resolve immediately so the SSE stream
  // closes cleanly. Tests that care about the input args override this.
  runMcpMock.mockImplementation(async ({ emit }) => {
    emit({ type: "done", totalTokens: 0 });
  });
  runCodeModeMock.mockImplementation(async ({ emit }) => {
    emit({ type: "done", totalTokens: 0 });
  });
});

describe("handleCfCodeMode — fall-through", () => {
  it("returns null for non-matching paths so the main fetch chain continues", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/not/our/namespace"),
      makeEnv(),
      makeCtx(),
    );
    expect(res).toBeNull();
  });

  it("does NOT match a near-miss prefix (defence against typos)", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode-OOPS/health"),
      makeEnv(),
      makeCtx(),
    );
    expect(res).toBeNull();
  });
});

describe("handleCfCodeMode — /health", () => {
  it("returns 200 with the binding probe + AI gateway status", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/health"),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      hasAi: true,
      hasLoader: true,
      hasCfApiToken: true,
      hasAiGatewayToken: false,
      defaultModel: expect.any(String),
    });
    expect(body.aiGateway).toMatchObject({ id: "code-mode-demo" });
  });

  it("reports hasCfApiToken=false when the secret is unset", async () => {
    const env = makeEnv();
    (env as { CF_API_TOKEN?: string }).CF_API_TOKEN = undefined;
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/health"),
      env,
      makeCtx(),
    );
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.hasCfApiToken).toBe(false);
  });

  it("reports hasAiGatewayToken=true when AI_GATEWAY_TOKEN is set", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/health"),
      makeEnv({ AI_GATEWAY_TOKEN: "gateway-bearer-token" }),
      makeCtx(),
    );
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.hasAiGatewayToken).toBe(true);
  });
});

describe("handleCfCodeMode — /models", () => {
  it("returns the demo model catalogue", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/models"),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { models: Array<{ id: string }>; defaultModelId: string };
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.defaultModelId).toBe(body.models[0].id);
    // Every model carries the function-calling capability (demo prereq).
    for (const m of body.models) {
      expect(m.id).toMatch(/^@/);
    }
  });
});

describe("handleCfCodeMode — /prompts", () => {
  it("returns the demo prompt presets", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/prompts"),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { prompts: Array<{ id: string; prompt: string }> };
    expect(body.prompts.length).toBeGreaterThan(0);
    for (const p of body.prompts) {
      expect(p.id).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
      expect(p.prompt.length).toBeGreaterThan(0);
    }
  });
});

describe("handleCfCodeMode — /run-mcp", () => {
  it("dispatches to runMcp() with the prompt + modelId", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/run-mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "How many zones do I have?",
          modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        }),
      }),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toContain("text/event-stream");
    // Consume the stream so the producer-fn finishes + the mock fires.
    await res!.text();
    expect(runMcpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "How many zones do I have?",
        modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      }),
    );
    expect(runCodeModeMock).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/run-mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(400);
  });

  it("returns 400 on missing prompt", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/run-mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(400);
  });

  it("returns 400 on an unknown modelId", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/run-mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "anything",
          modelId: "@made-up/nonexistent-model",
        }),
      }),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(400);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toMatch(/unknown model/i);
    expect(body.error).toContain("/api/cf-code-mode/models");
  });

  it("defaults to the default model when modelId is omitted", async () => {
    await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/run-mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "ok" }),
      }),
      makeEnv(),
      makeCtx(),
    );
    // Consume the stream to flush the producer.
    expect(runMcpMock).toHaveBeenCalled();
    const call = runMcpMock.mock.calls[0]?.[0] as { modelId: string };
    expect(call.modelId).toMatch(/^@/);
  });
});

describe("handleCfCodeMode — /run-code-mode", () => {
  it("dispatches to runCodeMode() with the prompt + modelId + promptId", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/run-code-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "Audit my WAF rules",
          modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          promptId: "waf-rule-audit",
        }),
      }),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toContain("text/event-stream");
    await res!.text();
    expect(runCodeModeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Audit my WAF rules",
        modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        promptId: "waf-rule-audit",
      }),
    );
    expect(runMcpMock).not.toHaveBeenCalled();
  });
});

describe("handleCfCodeMode — /__codemode", () => {
  it("returns ok:true for the test-only dispatcher path", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/__codemode", {
        method: "POST",
      }),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("handleCfCodeMode — unmatched namespace path", () => {
  it("returns 404 (JSON envelope) rather than falling through to the SPA", async () => {
    const res = await handleCfCodeMode(
      new Request("https://example.com/api/cf-code-mode/no-such-route"),
      makeEnv(),
      makeCtx(),
    );
    expect(res?.status).toBe(404);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
