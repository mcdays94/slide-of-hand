/**
 * Sandbox smoke endpoint — `/api/admin/sandbox/_smoke` (issue #131
 * phase 3c, slice 0).
 *
 * Tiny, permanent operational diagnostic: spawns the `Sandbox` Durable
 * Object, runs a one-shot `echo` command inside the container, and
 * returns the stdout / stderr / exitCode. The endpoint exists so we
 * can verify the Cloudflare Sandbox infrastructure is wired correctly
 * — without touching any of the higher-level phase 3c flows (clone +
 * apply + test gate + PR open).
 *
 * Why bake this in as a permanent endpoint (not a throwaway):
 *
 *   1. Phase 3c's `proposeSourceEdit` flow takes 30-90 seconds to
 *      run end-to-end. When it breaks in production, the first
 *      diagnostic question is "is the sandbox even alive?". This
 *      endpoint answers that in ~1 second.
 *   2. Container deployments are eventually-consistent — there's a
 *      2-3 minute provisioning window after first deploy. This
 *      endpoint lets us pin down "is the sandbox up yet?" without
 *      running the full proposeSourceEdit gauntlet.
 *   3. The Access gate makes the cost / risk negligible — only
 *      authenticated admins can hit it, and the command is hard-
 *      coded `echo` (no user-supplied input).
 *
 * The handler routes through `requireAccessAuth` like every other
 * `/api/admin/*` endpoint — defense in depth on top of Cloudflare
 * Access's edge enforcement.
 */

import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { requireAccessAuth } from "./access-auth";

export interface SandboxSmokeEnv {
  /**
   * The `Sandbox` Durable Object namespace, declared in wrangler.jsonc
   * as `{ class_name: "Sandbox", name: "Sandbox" }` and re-exported
   * from `worker/index.ts`.
   *
   * Typed as `DurableObjectNamespace<Sandbox>` so `getSandbox` from
   * `@cloudflare/sandbox` picks up the full RPC surface (`exec`,
   * `writeFile`, `readFile`, ...) at call sites — without the type
   * parameter the SDK rejects the binding at the `getSandbox` call
   * because its method surface is unknown.
   */
  Sandbox: DurableObjectNamespace<Sandbox>;
}

/**
 * Fetch-handler entry. Returns `null` for paths outside this module's
 * surface so the main fetch chain can fall through.
 *
 * Exposed surface:
 *   GET /api/admin/sandbox/_smoke
 *     → 200 { ok: true, stdout, stderr, exitCode, sandboxVersion? }
 *     → 200 { ok: false, error } when the sandbox spawned but errored
 *     → 500 { ok: false, error } when something at the SDK layer threw
 */
export async function handleSandboxSmoke(
  request: Request,
  env: SandboxSmokeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/sandbox/_smoke") return null;
  if (request.method !== "GET") {
    return Response.json(
      { ok: false, error: "Method not allowed" },
      { status: 405 },
    );
  }

  const denied = requireAccessAuth(request);
  if (denied) return denied;

  return runSandboxSmoke(env);
}

/**
 * Pure-ish executor for the smoke check — factored out so tests can
 * exercise it with a mocked `getSandbox` without going through the
 * routing layer. Real callers go through `handleSandboxSmoke`.
 */
export async function runSandboxSmoke(
  env: SandboxSmokeEnv,
): Promise<Response> {
  try {
    // Singleton sandbox ID for the smoke check. We deliberately do
    // NOT key per-user / per-deck — this is an infrastructure health
    // probe, not a per-tenant flow, and reusing one instance keeps
    // the container warm so subsequent smoke checks are sub-second.
    const sandbox = getSandbox(env.Sandbox, "_smoke");
    const result = await sandbox.exec("echo hello from sandbox");
    return Response.json({
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      success: result.success,
    });
  } catch (err) {
    // The SDK throws when the container can't be reached (not
    // provisioned yet, networking error, version mismatch, etc.).
    // Surface the message so operators can diagnose quickly.
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
