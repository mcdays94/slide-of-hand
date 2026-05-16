/**
 * `/preview/<previewId>/<sha>/<path...>` — draft-deck preview route.
 *
 * ## What this module owns
 *
 *   - Match `/preview/<previewId>/<sha>/<path...>` requests.
 *   - Enforce Cloudflare Access (via `requireAccessAuth`) PLUS an
 *     interactive-identity requirement (an email must be present —
 *     service tokens are rejected because preview is a per-user view).
 *   - Resolve the opaque `previewId` against the KV mapping store.
 *   - Gate on owner email match + commit-sha match.
 *   - On a valid hit, fetch the requested object from the
 *     `PREVIEW_BUNDLES` R2 bucket and stream it back with the
 *     `contentType` + `cacheControl` metadata stamped by the bundle
 *     storage helpers (`worker/preview-bundles.ts`, issue #269).
 *
 * ## Path mapping
 *
 *   - `/preview/<id>/<sha>/`                    → `index.html`
 *   - `/preview/<id>/<sha>/index.html`          → `index.html`
 *   - `/preview/<id>/<sha>/assets/foo-XYZ.js`   → `assets/foo-XYZ.js`
 *
 * Path traversal (any `..` or empty segment) is rejected as malformed
 * before any R2 read attempt — see `parsePreviewRoute`.
 *
 * ## Status codes
 *
 *   - 200 → object hit. Body streamed from R2 with stamped headers.
 *   - 400 → malformed URL (bad previewId / sha / path-traversal).
 *   - 403 → no Access auth | service-token auth | owner mismatch.
 *   - 404 → unknown previewId, OR valid previewId+sha but R2 object
 *           does not exist (generic message — same posture as the
 *           unknown-previewId case so a probe can't distinguish
 *           "no such id" from "id exists but bundle is missing").
 *   - 409 → sha mismatch (the previewId is valid but the requested
 *           commit isn't the latest known one). We chose 409 over 404
 *           here because the resource (the previewId) DOES exist; the
 *           client is asking for a stale version of it. The body
 *           includes `expectedSha` so the Studio iframe can refresh.
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
 * The 200 path is body-only: the R2 object body is streamed straight
 * onto the response, and the only headers set are `content-type` and
 * `cache-control` (both derived from the bundle's put-time policy).
 * No mapping fields are echoed back.
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
import {
  getPreviewBundleObject,
  inferPreviewContentType,
  previewBundleCacheControl,
  type PreviewBundlesEnv,
} from "./preview-bundles";
import { parsePreviewRoute } from "../src/lib/draft-previews";

/**
 * Env subset the preview route needs. Combines the KV mapping store
 * (`DECKS`) with the R2 bundle bucket (`PREVIEW_BUNDLES`). `ARTIFACTS`
 * is the binding for draft Artifacts repos — kept here so future
 * slices (e.g. on-demand rebuild) can reach for it without re-threading
 * the env shape.
 */
export interface PreviewEnv extends DraftPreviewStoreEnv, PreviewBundlesEnv {
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

/** Default fallback file served when the request points at the bundle
 * root (`/preview/<id>/<sha>/`). Vite emits this as the deck entry
 * point so it's the deterministic right thing to serve.
 */
const INDEX_DOCUMENT = "index.html";

/**
 * Map a request pathname's trailing slash to `index.html` BEFORE we
 * hand the URL to `parsePreviewRoute`. The parser rejects empty path
 * segments (defence-in-depth against `//` and trailing-slash glitches)
 * so we have to rewrite ourselves rather than ask the parser to treat
 * the empty path as `index.html`. We only rewrite the very specific
 * case of `/preview/<id>/<sha>/` — any other empty segment is still
 * malformed.
 */
function rewriteIndexPath(pathname: string): string {
  if (!pathname.startsWith("/preview/")) return pathname;
  if (!pathname.endsWith("/")) return pathname;
  // `/preview/<id>/<sha>/` has exactly four slashes: leading, after
  // `preview`, after `<id>`, after `<sha>`. The parser separately
  // rejects malformed previewId / sha values, so this is purely a
  // path-shape check.
  const slashCount = (pathname.match(/\//g) ?? []).length;
  if (slashCount !== 4) return pathname;
  return pathname + INDEX_DOCUMENT;
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
  const rewritten = rewriteIndexPath(url.pathname);
  const parse = parsePreviewRoute(rewritten);
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

  // Valid hit. Stream the object from R2. The bundle helpers stamp
  // `contentType` + `cacheControl` onto `httpMetadata` at put time;
  // copy those onto the response so the policy is enforced exactly
  // once (at put time) and read-side is just plumbing.
  const obj = await getPreviewBundleObject(env, {
    previewId: mapping.previewId,
    sha: parse.sha,
    path: parse.path,
  });
  if (!obj) {
    // Generic 404 — same posture as unknown-previewId. We deliberately
    // do NOT echo `previewId`, `path`, or any mapping field here so
    // the missing-object response is indistinguishable in body from
    // a probe against a bogus id.
    return json({ error: "preview not found" }, 404);
  }

  const headers = new Headers();
  const stampedContentType = obj.httpMetadata?.contentType;
  headers.set(
    "content-type",
    stampedContentType ?? inferPreviewContentType(parse.path),
  );
  const stampedCacheControl = obj.httpMetadata?.cacheControl;
  headers.set(
    "cache-control",
    stampedCacheControl ?? previewBundleCacheControl(parse.path),
  );

  return new Response(obj.body, { status: 200, headers });
}
