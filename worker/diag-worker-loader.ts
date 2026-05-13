/**
 * Worker Loader diagnostic endpoint
 * (`GET /api/admin/_diag/worker-loader`).
 *
 * Smoke-tests the `LOADER` binding (Cloudflare Dynamic Workers, open
 * beta) by loading a minimal "hello from a dynamic Worker" module
 * and forwarding a synthetic request through it. Each step is
 * reported separately so we can tell whether `load()` fails, the
 * Dynamic Worker fails to handle the request, or the response body
 * is unexpected.
 *
 * Why this exists: issue #106 wires the binding in `wrangler.jsonc`
 * so #167 (real cf-dynamic-workers / cf-code-mode demos) and Phase 6
 * of #131 (running AI-generated code in a sandbox) can build on top.
 * Mirroring the `/api/admin/_diag/artifacts` pattern keeps the
 * smoke-test surface consistent — both diags are Access-gated,
 * service-token-callable, and return structured JSON.
 *
 * The endpoint:
 *
 *   1. `env.LOADER.load(...)` — load a fresh Dynamic Worker from
 *      an inline JS module that returns "Hello from a dynamic Worker"
 *      to every request.
 *   2. `worker.getEntrypoint().fetch(<synthetic request>)` — forward
 *      a synthetic HTTPS request through the loaded Worker.
 *   3. Read the response body and confirm it matches the expected
 *      string. Anything else surfaces as a step failure.
 *
 * The Dynamic Worker has `globalOutbound: null` — no network egress.
 * Smoke is fully self-contained.
 *
 * Access-gated. Service-token-callable (no user identity needed).
 */

import { requireAccessAuth } from "./access-auth";

export interface DiagWorkerLoaderEnv {
  LOADER: WorkerLoader;
}

interface StepResult {
  step: string;
  ok: boolean;
  durationMs: number;
  /** Captured on success — small structured details about each step. */
  result?: Record<string, unknown>;
  /** Captured on failure — the error message + class name. */
  error?: { name: string; message: string };
}

/**
 * Compat date used when loading the Dynamic Worker. We pin a fixed
 * date here rather than reusing the outer Worker's compat date so
 * the smoke is deterministic across deploys — bumping the platform
 * date doesn't change what this diagnostic exercises.
 */
const DYNAMIC_WORKER_COMPAT_DATE = "2025-09-01";

/**
 * The inline module we load. Plain JS (Dynamic Workers don't accept
 * raw TS — the `modules` map expects compiled JS strings). Echoes
 * a fixed marker string so the outer side can verify the response
 * actually came from the loaded module and not some upstream
 * intermediary.
 */
const HELLO_MODULE = `
  export default {
    fetch(_request) {
      return new Response("Hello from a dynamic Worker (#106 diag)", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    },
  };
`;

const EXPECTED_BODY = "Hello from a dynamic Worker (#106 diag)";

/**
 * Run a single step, capture timing + result/error, never throw.
 * Mirror of `diag-artifacts.ts`'s helper so the response shapes line
 * up between the two diags.
 */
async function runStep<T>(
  step: string,
  fn: () => Promise<T>,
  capture: (result: T) => Record<string, unknown>,
): Promise<StepResult> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return {
      step,
      ok: true,
      durationMs: Date.now() - startedAt,
      result: capture(result),
    };
  } catch (err) {
    return {
      step,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: {
        name: err instanceof Error ? err.constructor.name : "Unknown",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export async function handleDiagWorkerLoader(
  request: Request,
  env: DiagWorkerLoaderEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/_diag/worker-loader") return null;
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const authResponse = requireAccessAuth(request);
  if (authResponse) return authResponse;

  const steps: StepResult[] = [];

  // Step 1: load() the Dynamic Worker. `load()` is synchronous in the
  // SDK's contract (returns a stub immediately) — wrapping it in an
  // async runStep is for uniformity with the other steps; the timing
  // is essentially "binding initialisation" which is near-zero.
  let workerStub: WorkerStub | null = null;
  const loadStep = await runStep(
    "load(hello-module)",
    async () => {
      const stub = env.LOADER.load({
        compatibilityDate: DYNAMIC_WORKER_COMPAT_DATE,
        mainModule: "index.js",
        modules: {
          "index.js": HELLO_MODULE,
        },
        // Block all outbound network — diag should be hermetic. The
        // Dynamic Worker just echoes a static string; no need for
        // egress.
        globalOutbound: null,
      });
      workerStub = stub;
      return stub;
    },
    () => ({
      // The stub itself doesn't expose useful structured fields, so
      // just confirm "we got something back".
      stub: "ok",
    }),
  );
  steps.push(loadStep);

  // Step 2: forward a synthetic request through the Dynamic Worker.
  // Skip if step 1 failed (no stub to forward to).
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  if (loadStep.ok && workerStub) {
    const fetchStep = await runStep(
      "getEntrypoint().fetch(synthetic)",
      async () => {
        // Use a recognisably-synthetic origin so a future operator
        // reading Worker logs can tell this came from the diag.
        const synthetic = new Request(
          "https://diag.worker-loader.invalid/probe",
          { method: "GET" },
        );
        const stub: WorkerStub = workerStub!;
        const entrypoint = stub.getEntrypoint();
        const response = await entrypoint.fetch(synthetic);
        responseStatus = response.status;
        responseBody = await response.text();
        return { status: response.status, bodyLength: responseBody.length };
      },
      (out) => out,
    );
    steps.push(fetchStep);

    // Step 3: verify the response matches what the inline module
    // emits. If this fails, something between the load and the
    // fetch translated the response (or the module didn't actually
    // run our code).
    if (fetchStep.ok) {
      const verifyStep = await runStep(
        "verify(response-body)",
        async () => {
          if (responseStatus !== 200) {
            throw new Error(
              `Unexpected status: ${responseStatus} (expected 200)`,
            );
          }
          if (responseBody !== EXPECTED_BODY) {
            throw new Error(
              `Unexpected body: ${JSON.stringify(responseBody)} (expected ${JSON.stringify(EXPECTED_BODY)})`,
            );
          }
          return true;
        },
        () => ({
          status: responseStatus,
          body: responseBody,
        }),
      );
      steps.push(verifyStep);
    }
  }

  const summary = {
    compatibilityDate: DYNAMIC_WORKER_COMPAT_DATE,
    steps,
    allOk: steps.every((s) => s.ok),
    failedSteps: steps.filter((s) => !s.ok).map((s) => s.step),
  };

  return Response.json(summary);
}
