/**
 * `/preview/<previewId>/<sha>/<path...>` — draft-deck preview route.
 *
 * ## Status
 *
 * Route + owner + sha gate are wired (issue #268). The actual bundle
 * fetch + serve is NOT — `handlePreview` returns a deterministic 501
 * stub on a valid hit, with the parsed `previewId`, `slug`, `sha`, and
 * requested `path` echoed for debugging. The bundle-serving work
 * lands in the follow-up slices (#269 R2 storage, #270 build pipeline,
 * #271 commit→preview wiring).
 *
 * ## What this module owns
 *
 *   - Match `/preview/<previewId>/<sha>/<path...>` requests.
 *   - Enforce Cloudflare Access (via `requireAccessAuth`) PLUS an
 *     interactive-identity requirement (an email must be present —
 *     service tokens are rejected because preview is a per-user view).
 *   - Resolve the opaque `previewId` against the KV mapping store.
 *   - Gate on owner email match + commit-sha match.
 *   - Return a deterministic 501 stub on a valid hit.
 *
 * ## Status codes
 *
 *   - 200 → never (the route currently returns 501 on success).
 *   - 400 → malformed URL (bad previewId / sha / path-traversal).
 *   - 403 → no Access auth | service-token auth | owner mismatch.
 *   - 404 → unknown previewId.
 *   - 409 → sha mismatch (the previewId is valid but the requested
 *           commit isn't the latest known one). We chose 409 over 404
 *           here because the resource (the previewId) DOES exist; the
 *           client is asking for a stale version of it. 409 also lets
 *           future slices serve a deterministic response body that
 *           includes `expectedSha` so the Studio iframe can refresh.
 *   - 501 → valid hit (stubbed bundle pipeline).
 *
 * ## Privacy posture
 *
 * `ownerEmail` and `draftRepoName` are stored in KV (`DECKS`) but
 * NEVER appear in any response body or response header. The 403 +
 * 404 + 409 responses all use generic messages so a probe can't
 * distinguish "unknown id" from "wrong owner" reliably (timing aside).
 * Owner emails are also never logged — the only place an email is
 * read is the Access header, which is request-scoped.
 *
 * ## Auth
 *
 * `requireAccessAuth` accepts both interactive emails and service
 * tokens. For preview we tighten that to interactive-only because
 * the owner check is by email and a service-token-only request has
 * no email to compare. Returning 403 in this case avoids a confusing
 * "passed Access but always 403" state.
 */

import { getAccessUserEmail, requireAccessAuth } from "./access-auth";
import {
  getDraftPreviewMapping,
  type DraftPreviewStoreEnv,
} from "./draft-previews-store";
import { parsePreviewRoute } from "../src/lib/draft-previews";

/**
 * Env subset the preview route needs. `ARTIFACTS` is the binding for
 * draft Artifacts repos (used in #270 once the bundle build lands).
 * `DECKS` is the existing KV namespace where opaque-id → mapping
 * records live (issue #268). No new Cloudflare binding is introduced.
 */
export interface PreviewEnv extends DraftPreviewStoreEnv {
  ARTIFACTS: Artifacts;
}

const NO_STORE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: NO_STORE_HEADERS,
  });
}

/** Owner-mismatch comparison uses normalized lowercase emails. */
function emailsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Fetch-handler entry. Returns `null` for paths outside `/preview/*`
 * so the main fetch chain falls through.
 */
export async function handlePreview(
  request: Request,
  env: PreviewEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const parse = parsePreviewRoute(url.pathname);
  if (!parse.ok && parse.reason === "not-preview") return null;

  // Auth gate is run BEFORE we surface malformed-URL errors so
  // unauthenticated probes can't enumerate path shapes.
  const denied = requireAccessAuth(request);
  if (denied) return denied;

  // Preview is a per-user surface — the owner check is by email.
  // Service-token requests pass Access but carry no email. Reject
  // explicitly so the caller gets a clear "this surface needs a
  // user" signal rather than a confusing 403 owner-mismatch.
  const email = getAccessUserEmail(request);
  if (!email) {
    return json(
      {
        error:
          "forbidden — draft preview requires interactive Cloudflare Access " +
          "authentication (an authenticated user email)",
      },
      403,
    );
  }

  if (!parse.ok) {
    return json({ error: "malformed preview URL" }, 400);
  }

  const mapping = await getDraftPreviewMapping(env, parse.previewId);
  if (!mapping) {
    // Generic message: don't reveal whether the previewId ever
    // existed, who owns it, or which draft repo it backs.
    return json({ error: "preview not found" }, 404);
  }

  if (!emailsMatch(mapping.ownerEmail, email)) {
    // Same posture as the 404: don't leak ownerEmail or draftRepoName.
    // The 403/404 distinction is also intentionally minimal — a
    // probe that already knows a valid previewId can still tell
    // "exists but not mine" from "doesn't exist", but only by
    // brute-forcing the 64-bit opaque id, which is the threat
    // model the opaque-id design defends against.
    return json({ error: "forbidden" }, 403);
  }

  if (mapping.latestCommitSha !== parse.sha) {
    // 409 Conflict: the resource exists but the client is asking
    // for the wrong version. The Studio iframe can read
    // `expectedSha` and reload with the latest commit.
    return json(
      {
        error: "sha mismatch — preview has been updated",
        previewId: mapping.previewId,
        slug: mapping.slug,
        expectedSha: mapping.latestCommitSha,
        requestedSha: parse.sha,
      },
      409,
    );
  }

  // Valid hit. The bundle pipeline is stubbed — return a
  // deterministic 501 with the parsed fields echoed so debugging
  // a real request shape is easy until #270/#271 land.
  return json(
    {
      ok: false,
      error:
        "draft preview bundle pipeline is not implemented yet " +
        "(issues #269 / #270 / #271). The route + opaque-id contract " +
        "(issue #268) is in place; returning the parsed request shape " +
        "for debugging.",
      previewId: mapping.previewId,
      slug: mapping.slug,
      sha: parse.sha,
      path: parse.path,
    },
    501,
  );
}
