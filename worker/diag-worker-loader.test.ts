/**
 * Tests for `worker/diag-worker-loader.ts` — the Worker Loader smoke
 * endpoint (issue #106).
 *
 * Mocks the `LOADER` binding's `load()` + `getEntrypoint().fetch()`
 * surface so we can assert the orchestrator's step-by-step behaviour
 * without needing the Cloudflare Dynamic Workers runtime. Mirrors the
 * mock-style used elsewhere (e.g. `worker/sandbox-deck-creation.test.ts`).
 */

import { describe, it, expect, vi } from "vitest";
import {
  handleDiagWorkerLoader,
  type DiagWorkerLoaderEnv,
} from "./diag-worker-loader";

/**
 * Build a mock `WorkerLoader` env. By default the loader returns a
 * stub whose entrypoint fetch responds with the exact body the diag
 * verifies against — i.e. the happy path. Individual tests override
 * the stub or the fetch behaviour.
 */
function makeEnv(opts?: {
  loadThrows?: unknown;
  fetchThrows?: unknown;
  fetchResponse?: Response;
}): {
  env: DiagWorkerLoaderEnv;
  load: ReturnType<typeof vi.fn>;
  entrypointFetch: ReturnType<typeof vi.fn>;
} {
  const entrypointFetch = vi.fn(async () => {
    if (opts?.fetchThrows) throw opts.fetchThrows;
    return (
      opts?.fetchResponse ??
      new Response("Hello from a dynamic Worker (#106 diag)", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );
  });
  const entrypoint = { fetch: entrypointFetch };
  const stub = { getEntrypoint: vi.fn(() => entrypoint) };
  const load = vi.fn(() => {
    if (opts?.loadThrows) throw opts.loadThrows;
    return stub;
  });
  const env: DiagWorkerLoaderEnv = {
    LOADER: { load, get: vi.fn() } as unknown as WorkerLoader,
  };
  return { env, load, entrypointFetch };
}

/** Build an Access-authenticated GET to the diag path. */
function authedRequest(): Request {
  return new Request("https://example.com/api/admin/_diag/worker-loader", {
    method: "GET",
    headers: {
      // The simplest of `requireAccessAuth`'s three accepted signals;
      // a non-empty JWT assertion clears the gate.
      "cf-access-jwt-assertion": "fake.jwt.for.test",
    },
  });
}

describe("handleDiagWorkerLoader — route guards", () => {
  it("returns null for non-matching paths so the main fetch chain falls through", async () => {
    const { env } = makeEnv();
    const req = new Request("https://example.com/not/the/diag");
    expect(await handleDiagWorkerLoader(req, env)).toBeNull();
  });

  it("returns 405 for non-GET methods", async () => {
    const { env } = makeEnv();
    const req = new Request("https://example.com/api/admin/_diag/worker-loader", {
      method: "POST",
    });
    const res = await handleDiagWorkerLoader(req, env);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(405);
  });

  it("rejects unauthenticated requests with a 403", async () => {
    // `requireAccessAuth` returns 403 when none of its three accepted
    // headers are present.
    const { env } = makeEnv();
    const req = new Request(
      "https://example.com/api/admin/_diag/worker-loader",
    );
    const res = await handleDiagWorkerLoader(req, env);
    expect(res?.status).toBe(403);
  });
});

describe("handleDiagWorkerLoader — happy path", () => {
  it("loads + fetches + verifies, returning allOk:true and three steps", async () => {
    const { env, load, entrypointFetch } = makeEnv();
    const res = await handleDiagWorkerLoader(authedRequest(), env);
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as {
      allOk: boolean;
      steps: Array<{ step: string; ok: boolean }>;
      failedSteps: string[];
    };
    expect(body.allOk).toBe(true);
    expect(body.failedSteps).toEqual([]);
    expect(body.steps.map((s) => s.step)).toEqual([
      "load(hello-module)",
      "getEntrypoint().fetch(synthetic)",
      "verify(response-body)",
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(entrypointFetch).toHaveBeenCalledTimes(1);
  });

  it("loads with a pinned compat date so the diag is deterministic across platform-date bumps", async () => {
    const { env, load } = makeEnv();
    await handleDiagWorkerLoader(authedRequest(), env);
    const args = load.mock.calls[0]?.[0] as {
      compatibilityDate: string;
      mainModule: string;
      modules: Record<string, string>;
      globalOutbound: null;
    };
    // Pinning the compat date prevents the diag from silently changing
    // its meaning when the host Worker's compat date is bumped.
    expect(args.compatibilityDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Hermetic: outbound egress is explicitly null.
    expect(args.globalOutbound).toBeNull();
    // mainModule points at the inline module we register.
    expect(args.mainModule).toBe("index.js");
    expect(args.modules["index.js"]).toContain(
      "Hello from a dynamic Worker (#106 diag)",
    );
  });

  it("forwards a synthetic request with a recognisable origin to the Dynamic Worker", async () => {
    const { env, entrypointFetch } = makeEnv();
    await handleDiagWorkerLoader(authedRequest(), env);
    const calledWith = entrypointFetch.mock.calls[0]?.[0] as Request;
    // The synthetic origin uses .invalid (RFC 6761) so it can never
    // collide with a real production host in logs.
    expect(calledWith.url).toMatch(/diag\.worker-loader\.invalid/);
    expect(calledWith.method).toBe("GET");
  });
});

describe("handleDiagWorkerLoader — failure modes", () => {
  it("returns failedSteps=[load(...)] when LOADER.load() throws", async () => {
    const { env } = makeEnv({
      loadThrows: new Error("LoaderError: Worker Loader not allowlisted"),
    });
    const res = await handleDiagWorkerLoader(authedRequest(), env);
    const body = (await res!.json()) as {
      allOk: boolean;
      steps: Array<{ step: string; ok: boolean; error?: { message: string } }>;
      failedSteps: string[];
    };
    expect(body.allOk).toBe(false);
    expect(body.failedSteps).toEqual(["load(hello-module)"]);
    // Subsequent steps are skipped — only the failing load step is
    // recorded.
    expect(body.steps.map((s) => s.step)).toEqual(["load(hello-module)"]);
    expect(body.steps[0].error?.message).toContain("not allowlisted");
  });

  it("returns failedSteps=[fetch(...)] when the Dynamic Worker's fetch throws", async () => {
    const { env } = makeEnv({
      fetchThrows: new Error("DynamicWorkerError: handler crashed"),
    });
    const res = await handleDiagWorkerLoader(authedRequest(), env);
    const body = (await res!.json()) as {
      allOk: boolean;
      steps: Array<{ step: string; ok: boolean }>;
      failedSteps: string[];
    };
    expect(body.allOk).toBe(false);
    expect(body.failedSteps).toEqual(["getEntrypoint().fetch(synthetic)"]);
    // Verify step is skipped because the fetch failed.
    expect(body.steps).toHaveLength(2);
    expect(body.steps[0].ok).toBe(true);
    expect(body.steps[1].ok).toBe(false);
  });

  it("returns failedSteps=[verify(...)] when the Dynamic Worker returns the wrong body", async () => {
    // The whole point of the verify step is to catch the case where
    // load + fetch both succeed but something between the inline
    // module and our outer code swapped the response. Easy regression
    // to introduce; covering it explicitly.
    const { env } = makeEnv({
      fetchResponse: new Response("WRONG BODY (intermediary mutated me)", {
        status: 200,
      }),
    });
    const res = await handleDiagWorkerLoader(authedRequest(), env);
    const body = (await res!.json()) as {
      allOk: boolean;
      steps: Array<{ step: string; ok: boolean; error?: { message: string } }>;
      failedSteps: string[];
    };
    expect(body.allOk).toBe(false);
    expect(body.failedSteps).toEqual(["verify(response-body)"]);
    const verifyStep = body.steps.find((s) => s.step === "verify(response-body)");
    expect(verifyStep?.error?.message).toMatch(/unexpected body/i);
  });

  it("flags a non-200 response as a verify failure even with the right body", async () => {
    // Defensive — if the Dynamic Worker accidentally returns 204 / 500
    // with the right body, the verify step should still flag it.
    const { env } = makeEnv({
      fetchResponse: new Response(
        "Hello from a dynamic Worker (#106 diag)",
        { status: 500 },
      ),
    });
    const res = await handleDiagWorkerLoader(authedRequest(), env);
    const body = (await res!.json()) as {
      allOk: boolean;
      steps: Array<{ step: string; ok: boolean; error?: { message: string } }>;
      failedSteps: string[];
    };
    expect(body.allOk).toBe(false);
    expect(body.failedSteps).toEqual(["verify(response-body)"]);
    const verifyStep = body.steps.find((s) => s.step === "verify(response-body)");
    expect(verifyStep?.error?.message).toMatch(/unexpected status/i);
  });
});
