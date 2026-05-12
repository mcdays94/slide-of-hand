/**
 * `POST /api/admin/setup/deck-starter` — Worker E one-shot setup
 * endpoint for issue #168 Wave 1.
 *
 * ## What this owns
 *
 * Creates (or confirms the existence of) the `deck-starter` baseline
 * repo in Cloudflare Artifacts. Idempotent — calling repeatedly is
 * safe and returns the existing repo's metadata.
 *
 * Once the baseline is in place, the agent's `createDeckDraft` tool
 * can `fork` from it to spawn new per-user-per-slug draft repos. The
 * fork retains the empty initial state — the agent's first AI gen
 * pass writes the actual deck files.
 *
 * ## Why a permanent endpoint (not a one-off script)
 *
 * Mirrors the pattern from `sandbox-smoke.ts`: an operationally
 * useful diagnostic that doubles as the bring-up step. Calling it
 * after a wrangler.jsonc edit confirms the binding is live and the
 * namespace is reachable. Cheap to leave in place; idempotent so it
 * can't accidentally clobber.
 *
 * ## Auth
 *
 * Admin-gated via `requireAccessAuth`. Service-token auth is fine
 * (the binding doesn't carry user identity).
 */

import { requireAccessAuth } from "./access-auth";
import { ensureDeckStarterRepo } from "./artifacts-client";

export interface DeckStarterSetupEnv {
  ARTIFACTS?: Artifacts;
}

const ROUTE_PATH = "/api/admin/setup/deck-starter";

export async function handleDeckStarterSetup(
  request: Request,
  env: DeckStarterSetupEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE_PATH) return null;

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const denied = requireAccessAuth(request);
  if (denied) return denied;

  if (!env.ARTIFACTS) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "ARTIFACTS binding is not bound. Add it to wrangler.jsonc and redeploy.",
      }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    );
  }

  try {
    const result = await ensureDeckStarterRepo(env.ARTIFACTS);
    if (result.kind === "existed") {
      return Response.json({
        ok: true,
        kind: "existed",
        repo: {
          id: result.repo.id,
          name: result.repo.name,
          remote: result.repo.remote,
          defaultBranch: result.repo.defaultBranch,
        },
      });
    }
    // kind === "created"
    return Response.json(
      {
        ok: true,
        kind: "created",
        repo: {
          id: result.result.id,
          name: result.result.name,
          remote: result.result.remote,
          defaultBranch: result.result.defaultBranch,
          // We deliberately do NOT return the initial token here.
          // The agent flow mints fresh write tokens per draft via
          // `mintWriteToken(repo)` — exposing the initial root
          // token in a response body would let any caller of this
          // endpoint walk away with credentials for the baseline.
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Failed to ensure deck-starter repo: ${message}`,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}
