/**
 * Cloudflare Artifacts diagnostic endpoint
 * (`GET /api/admin/_diag/artifacts`).
 *
 * Surfaces a structured, deterministic test of the `ARTIFACTS`
 * binding in production without going through `runCreateDeckDraft`
 * or any of the deck-creation orchestration. Each step is reported
 * separately so we can tell exactly which call to the Artifacts
 * service throws.
 *
 * Why this exists: post-#180 verification produced a chain of fork
 * errors that I (the agent) initially blamed on "Cloudflare
 * Artifacts beta instability." The user (correctly) pushed back —
 * we hadn't actually tested Artifacts directly. This endpoint is
 * the test. It exercises:
 *
 *   1. `artifacts.get("deck-starter")` — the baseline lookup.
 *   2. `starter.fork(<unique-test-name>, ...)` — a fresh fork
 *      with a timestamped name we've never used before.
 *   3. `artifacts.get(<unique-test-name>)` — read back the newly
 *      forked repo.
 *   4. `existing.createToken("read", ...)` — confirm token
 *      minting works (smaller-scope `read` to avoid leaving
 *      writable handles around).
 *
 * The response shows the outcome of each step. If step 2 fails
 * with the same generic "An internal error occurred" error we've
 * been seeing, it's a service issue. If step 2 succeeds and step
 * 3 fails, it's eventual-consistency. If everything succeeds, the
 * problem is in our orchestration somewhere.
 *
 * The test repo is left in place — we don't try to delete it,
 * because there's no documented `delete` API on the Workers
 * Artifacts binding. Operators can manually clean these up via
 * the Cloudflare dashboard if needed; they're cheap.
 *
 * Access-gated. Service-token-callable (no user-identity needed).
 */

import { requireAccessAuth } from "./access-auth";

export interface DiagArtifactsEnv {
  ARTIFACTS: Artifacts;
}

interface StepResult {
  step: string;
  ok: boolean;
  durationMs: number;
  /** Captured on success — names, IDs, remote URLs, etc. */
  result?: Record<string, unknown>;
  /** Captured on failure — the error message + class name. */
  error?: { name: string; message: string };
}

/**
 * Build a unique test repo name. Format: `diag-<unix-seconds>-<random>`.
 * We don't sanitise through `draftRepoName` because that's the
 * user-facing convention; for diagnostics we want a clean,
 * predictable name that's never collided with a real draft.
 */
function makeTestRepoName(): string {
  const ts = Math.floor(Date.now() / 1000);
  const rand = Math.random().toString(36).slice(2, 8);
  return `diag-${ts}-${rand}`;
}

/**
 * Run a single step, capture timing + result/error, never throw.
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

export async function handleDiagArtifacts(
  request: Request,
  env: DiagArtifactsEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/_diag/artifacts") return null;
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const authResponse = requireAccessAuth(request);
  if (authResponse) return authResponse;

  const testName = makeTestRepoName();
  const steps: StepResult[] = [];

  // Step 1: get the baseline.
  const starterStep = await runStep(
    "get(deck-starter)",
    () => env.ARTIFACTS.get("deck-starter"),
    (repo) => ({
      name: repo.name,
      id: repo.id,
      defaultBranch: repo.defaultBranch,
      remote: repo.remote,
    }),
  );
  steps.push(starterStep);

  // Step 2: fork the baseline into our timestamped test name.
  // Skip if step 1 failed (no starter handle to fork from).
  if (starterStep.ok) {
    const forkStep = await runStep(
      `fork(${testName})`,
      async () => {
        const starter = await env.ARTIFACTS.get("deck-starter");
        return starter.fork(testName, {
          description: `Artifacts diagnostic test repo (slide-of-hand). Safe to delete.`,
          readOnly: false,
          defaultBranchOnly: true,
        });
      },
      (result) => ({
        name: result.name,
        id: result.id,
        defaultBranch: result.defaultBranch,
        remote: result.remote,
        tokenExpiresAt: result.tokenExpiresAt,
      }),
    );
    steps.push(forkStep);

    // Step 3: read back the newly-forked repo. Only run if fork
    // looked like it succeeded; otherwise we'd be testing the same
    // service-level race the user is hitting.
    if (forkStep.ok) {
      const readBackStep = await runStep(
        `get(${testName})`,
        () => env.ARTIFACTS.get(testName),
        (repo) => ({
          name: repo.name,
          id: repo.id,
          defaultBranch: repo.defaultBranch,
          remote: repo.remote,
        }),
      );
      steps.push(readBackStep);

      // Step 4: mint a read token on the new repo. Cheaper than
      // a write token; the test is "does token minting work at
      // all on this repo".
      if (readBackStep.ok) {
        const mintStep = await runStep(
          `createToken(read, on ${testName})`,
          async () => {
            const repo = await env.ARTIFACTS.get(testName);
            return repo.createToken("read", 60);
          },
          (token) => ({
            scope: token.scope,
            expiresAt: token.expiresAt,
            // Don't return the plaintext — this is a public endpoint
            // (Access-gated, but service-token-callable, so leaking
            // a read token over the wire isn't ideal).
            plaintextLength: token.plaintext.length,
          }),
        );
        steps.push(mintStep);
      }
    }
  }

  const summary = {
    testRepoName: testName,
    steps,
    allOk: steps.every((s) => s.ok),
    failedSteps: steps.filter((s) => !s.ok).map((s) => s.step),
  };

  return Response.json(summary);
}
