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
 * the test.
 *
 * ## Steps (#182 probe enhancement)
 *
 *   1. `artifacts.get("deck-starter")` — the baseline lookup.
 *
 *   2. `starter.fork(<fork-test-name>, ...)` — a fresh fork with a
 *      timestamped name we've never used before.
 *
 *   3. `artifacts.get(<fork-test-name>)` — **runs unconditionally**
 *      after step 2, even on failure. This is the "ghost probe":
 *      if step 2 returned `An internal error occurred.` but the
 *      service actually created the repo server-side anyway, step 3
 *      will return a real handle. The pre-#182 diag skipped this
 *      step on fork failure — exactly the case where it's most
 *      diagnostic.
 *
 *   4. `existing.createToken("read", ...)` — token-mint smoke test.
 *      Only runs when step 3 succeeds (otherwise we have no handle).
 *
 *   5. `artifacts.create(<create-test-name>, ...)` — direct create
 *      attempt. Bypasses the fork pipeline. Tells us whether the
 *      `create()` API is a viable workaround when `fork()` is
 *      broken. (Architecturally `fork()` is just "create empty
 *      repo" for our use case — see `sandbox-artifacts.ts` lines
 *      19-22 and `deck-starter-setup.ts` line 13.)
 *
 *   6. `artifacts.get(<create-test-name>)` — ghost probe for create,
 *      symmetric with step 3. Runs unconditionally so we detect
 *      "create returned 500 but actually succeeded" if it shows up.
 *
 *   7. `artifacts.list({ limit: 50 })` — enumerate the namespace.
 *      Returns names + descriptions + timestamps for everything
 *      present. Lets us see which drafts exist (including any
 *      ghost repos accumulated from prior failed forks) without
 *      writing additional code.
 *
 * The test repos are left in place — `Artifacts.delete()` exists
 * on the binding (verified in `worker-configuration.d.ts`) but we
 * intentionally don't call it during diagnosis: cleanup would
 * remove evidence if the bug is actively leaking ghosts. Operators
 * can clean up via the dashboard if buildup becomes a problem.
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
 * Derived signals computed from the step results. Lets a human (or
 * the orchestrator) skim the response and immediately answer the
 * three big questions: which APIs are healthy, are ghosts being
 * created, what's actually in the namespace.
 */
interface DerivedSignals {
  /** The `fork()` call returned a successful result. */
  forkApiHealthy: boolean;
  /**
   * `fork()` errored, but the follow-up `get()` resolved a real
   * handle — meaning the service created the repo server-side
   * despite the misleading response. This is the "ghost repo"
   * pattern.
   */
  forkCreatedGhostRepo: boolean;
  /** The `create()` call returned a successful result. */
  createApiHealthy: boolean;
  /** Symmetric ghost-repo signal for `create()`. */
  createCreatedGhostRepo: boolean;
  /** The `list()` call returned a successful result. */
  listApiHealthy: boolean;
  /**
   * Total repos in the namespace (from `list().total`). Null when
   * `list()` failed; otherwise the count reported by the service.
   */
  listedRepoCount: number | null;
}

/**
 * Build a unique test repo name. Format: `diag-<kind>-<unix-seconds>-<random>`.
 * The `<kind>` segment distinguishes diag repos created via `fork`
 * from those created via `create`, so we can identify orphans later
 * by name pattern.
 */
function makeTestRepoName(kind: "fork" | "create"): string {
  const ts = Math.floor(Date.now() / 1000);
  const rand = Math.random().toString(36).slice(2, 8);
  return `diag-${kind}-${ts}-${rand}`;
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

  const forkTestName = makeTestRepoName("fork");
  const createTestName = makeTestRepoName("create");
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

  // Steps 2-4: fork → ghost-probe → token-mint. Only when the
  // baseline lookup succeeded (otherwise we have no handle to fork
  // from, and the failure mode is upstream of the fork pipeline).
  let forkStep: StepResult | undefined;
  let forkGhostProbeStep: StepResult | undefined;
  if (starterStep.ok) {
    // Step 2: fork the baseline into our timestamped test name.
    forkStep = await runStep(
      `fork(${forkTestName})`,
      async () => {
        const starter = await env.ARTIFACTS.get("deck-starter");
        return starter.fork(forkTestName, {
          description: `Artifacts diagnostic test repo (slide-of-hand, fork probe). Safe to delete.`,
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

    // Step 3: ghost probe. RUNS UNCONDITIONALLY (even on fork
    // failure) — that's the whole point of the #182 enhancement.
    // If fork() returned 500 but the repo IS there, this step
    // surfaces the "cosmetic failure" pattern.
    forkGhostProbeStep = await runStep(
      `get(${forkTestName})`,
      () => env.ARTIFACTS.get(forkTestName),
      (repo) => ({
        name: repo.name,
        id: repo.id,
        defaultBranch: repo.defaultBranch,
        remote: repo.remote,
      }),
    );
    steps.push(forkGhostProbeStep);

    // Step 4: token mint. Only when we have a real handle (i.e.
    // the ghost probe succeeded). If ghost probe failed, there's
    // nothing to mint against.
    if (forkGhostProbeStep.ok) {
      const mintStep = await runStep(
        `createToken(read, on ${forkTestName})`,
        async () => {
          const repo = await env.ARTIFACTS.get(forkTestName);
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

  // Step 5: direct `create()` probe. Independent of fork — runs even
  // if the baseline lookup failed. The architectural question this
  // answers: when `fork()` is broken, is `create()` a viable
  // workaround?
  const createStep = await runStep(
    `create(${createTestName})`,
    () =>
      env.ARTIFACTS.create(createTestName, {
        description: `Artifacts diagnostic test repo (slide-of-hand, create probe). Safe to delete.`,
        readOnly: false,
        setDefaultBranch: "main",
      }),
    (result) => ({
      name: result.name,
      id: result.id,
      defaultBranch: result.defaultBranch,
      remote: result.remote,
      tokenExpiresAt: result.tokenExpiresAt,
    }),
  );
  steps.push(createStep);

  // Step 6: ghost probe for create. Symmetric with step 3.
  const createGhostProbeStep = await runStep(
    `get(${createTestName})`,
    () => env.ARTIFACTS.get(createTestName),
    (repo) => ({
      name: repo.name,
      id: repo.id,
      defaultBranch: repo.defaultBranch,
      remote: repo.remote,
    }),
  );
  steps.push(createGhostProbeStep);

  // Step 7: list the namespace. Bounded at 50 to keep the response
  // size sane; if total exceeds 50 the cursor field tells us so.
  const listStep = await runStep(
    `list({ limit: 50 })`,
    () => env.ARTIFACTS.list({ limit: 50 }),
    (result) => ({
      total: result.total,
      hasMore: !!result.cursor,
      repos: result.repos.map((r) => ({
        name: r.name,
        description: r.description,
        defaultBranch: r.defaultBranch,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        lastPushAt: r.lastPushAt,
        source: r.source,
        readOnly: r.readOnly,
      })),
    }),
  );
  steps.push(listStep);

  // Derived signals — let humans skim the response.
  const derivedSignals: DerivedSignals = {
    forkApiHealthy: forkStep?.ok ?? false,
    forkCreatedGhostRepo:
      !!forkStep && !forkStep.ok && !!forkGhostProbeStep && forkGhostProbeStep.ok,
    createApiHealthy: createStep.ok,
    createCreatedGhostRepo: !createStep.ok && createGhostProbeStep.ok,
    listApiHealthy: listStep.ok,
    listedRepoCount: listStep.ok
      ? ((listStep.result?.total as number | undefined) ?? null)
      : null,
  };

  const summary = {
    forkTestRepoName: forkTestName,
    createTestRepoName: createTestName,
    steps,
    allOk: steps.every((s) => s.ok),
    failedSteps: steps.filter((s) => !s.ok).map((s) => s.step),
    derivedSignals,
  };

  return Response.json(summary);
}
