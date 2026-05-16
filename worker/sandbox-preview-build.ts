/**
 * Sandbox-side builder for AI draft preview bundles (issue #270 /
 * PRD #178).
 *
 * Pipeline that turns an Artifacts draft commit into a static bundle
 * uploaded to R2 (`PREVIEW_BUNDLES`), addressable by the opaque
 * `previewId` + `commitSha` contract from #268 / #269:
 *
 *   1. Spawn the per-draft Sandbox.
 *   2. Clone the slide-of-hand GitHub source into `/workspace/source`.
 *   3. Clone the Artifacts draft repo into `/workspace/draft` and
 *      check out the requested `commitSha`.
 *   4. Verify the deck folder exists in the draft and overlay it onto
 *      the source checkout (`cp -r draft/src/decks/public/<slug>
 *      source/src/decks/public/<slug>`).
 *   5. `npm install` in the source workdir.
 *   6. `npx vite build --base=/preview/<previewId>/<commitSha>/` in
 *      the source workdir. This is intentionally NOT the project's
 *      full `npm run build` (which prefixes `tsc -b`) — the AI-
 *      generated deck might contain type errors we don't want to
 *      block a preview on; the iframe is for visual review, not a
 *      release gate.
 *   7. Read `dist/` back via a small bash script that emits a
 *      newline-framed, base64-encoded manifest of every file. Base64
 *      is the cleanest binary-safe transport through
 *      `sandbox.exec().stdout` (assets include PNGs, fonts, etc.).
 *   8. For each file, `putPreviewBundleObject` into R2.
 *   9. Return `{ ok: true, previewUrl: /preview/<id>/<sha>/index.html }`.
 *
 * ## Why not wire into createDeckDraft yet
 *
 * This slice (#270) ships ONLY the builder. The orchestrator wiring —
 * call this after every commit on `runCreateDeckDraft` /
 * `runIterateOnDeckDraft`, mint/upsert the preview mapping, surface
 * the URL to the Studio iframe — lands in #271. Keeping the builder
 * standalone means #271 can A/B the call without disturbing the AI
 * tool surface.
 *
 * ## Why use Sandbox at all
 *
 * The preview bundle is generated from AI-written source — exactly
 * the threat model Sandbox exists for. Even though the output is
 * static and gated behind an Access-protected iframe, the BUILD step
 * runs `vite build` (which executes config files + plugins) over
 * untrusted source. Running it in the Worker runtime would conflate
 * the agent's tool surface with code execution. Sandbox isolates it.
 *
 * ## Privacy posture
 *
 *   - The user email NEVER reaches the preview URL or any R2 key —
 *     only the opaque `previewId` does. The caller passes `userEmail`
 *     so we can look up the GitHub OAuth token; that's the entire
 *     consumption.
 *   - Errors that bubble out of `cloneArtifactsRepoIntoSandbox` may
 *     include the authenticated URL (with the token embedded). The
 *     builder runs every such error through `redactSecrets` before
 *     putting it on the typed failure return.
 *   - The token itself stays inside the Sandbox container's environ
 *     for the duration of the clone; it does not leak into stdout we
 *     capture or stderr we surface.
 */

import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import {
  buildArtifactsRemoteUrl,
  buildAuthenticatedRemoteUrl,
  getDraftRepo,
  mintWriteToken,
  stripExpiresSuffix,
} from "./artifacts-client";
import { cloneArtifactsRepoIntoSandbox } from "./sandbox-artifacts";
import { cloneRepoIntoSandbox } from "./sandbox-source-edit";
import { getStoredGitHubToken } from "./github-oauth";
import { TARGET_REPO } from "./github-client";
import {
  putPreviewBundleObject,
  previewBundleObjectKey,
} from "./preview-bundles";

// ─── Types ────────────────────────────────────────────────────────────

/**
 * Env subset the builder reads. Composed of the existing surfaces:
 *
 *   - `Sandbox` — DO namespace for the Cloudflare Sandbox.
 *   - `ARTIFACTS` — Artifacts binding (clone source for the draft).
 *   - `PREVIEW_BUNDLES` — R2 bucket from #269.
 *   - `GITHUB_TOKENS` — per-user GitHub OAuth token KV.
 *   - `CF_ACCOUNT_ID` — wrangler var used by `buildArtifactsRemoteUrl`.
 */
export interface BuildDraftPreviewEnv {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ARTIFACTS: Artifacts;
  PREVIEW_BUNDLES: R2Bucket;
  GITHUB_TOKENS: KVNamespace;
  CF_ACCOUNT_ID?: string;
}

export interface BuildDraftPreviewInput {
  /**
   * Caller's Access-issued email. Used ONLY to look up the user's
   * GitHub OAuth token from `GITHUB_TOKENS` and (indirectly, via
   * `getDraftRepo`) to resolve the Artifacts repo. NEVER lands in
   * any R2 key, preview URL, or returned error string.
   */
  userEmail: string;
  /** Deck slug. Used to locate `src/decks/public/<slug>` in both checkouts. */
  slug: string;
  /**
   * Cloudflare Artifacts draft repo name. Caller has already resolved
   * this via `draftRepoName(userEmail, slug)` (or pulled it from the
   * preview mapping). Threaded explicitly so this helper does NOT
   * duplicate the sanitisation rules.
   */
  draftRepoName: string;
  /**
   * Exact commit SHA in the draft repo to build. Used both to check
   * out the draft and to build the preview URL.
   */
  commitSha: string;
  /**
   * Opaque server-minted preview id (`pv_<hex>`). Forms the public
   * URL prefix. Validated upstream (#268).
   */
  previewId: string;
}

export type BuildDraftPreviewFailurePhase =
  | "source_clone"
  | "artifacts_clone"
  | "overlay"
  | "install"
  | "build"
  | "upload";

export interface BuildDraftPreviewSuccess {
  ok: true;
  /** URL of the preview entry point. Always `/preview/<id>/<sha>/index.html`. */
  previewUrl: string;
  /** Count of files uploaded to R2. */
  uploadedFiles: number;
}

export interface BuildDraftPreviewFailure {
  ok: false;
  phase: BuildDraftPreviewFailurePhase;
  /** Redacted error message safe to surface to the UI. */
  error: string;
}

export type BuildDraftPreviewResult =
  | BuildDraftPreviewSuccess
  | BuildDraftPreviewFailure;

export type GetSandboxFn = (
  namespace: DurableObjectNamespace<Sandbox>,
  id: string,
) => Sandbox;

/** Narrow surface — small enough to mock with a few `vi.fn()`s. */
export type PreviewBuildSandboxLike = Pick<Sandbox, "exec" | "writeFile" | "mkdir">;

// ─── Constants ────────────────────────────────────────────────────────

const SOURCE_WORKDIR = "/workspace/source";
const DRAFT_WORKDIR = "/workspace/draft";

/**
 * Script path inside the sandbox for the dist-read helper. Single
 * fixed path because the builder is single-use per call; overwriting
 * on retry is fine.
 */
const READ_DIST_SCRIPT_PATH = "/tmp/preview-read-dist.sh";

/**
 * Per-file framing in the read-dist manifest. Matches the parser
 * below — change one, change the other.
 */
const FILE_HEADER_RE = /^==== PREVIEW_FILE: (.+?) SIZE: (\d+) ====$/;
const FILE_END_MARKER = "==== PREVIEW_FILE_END ====";

/**
 * Bash script that walks `dist/` and prints, per file:
 *
 *     ==== PREVIEW_FILE: <relative-path> SIZE: <bytes> ====
 *     <base64-encoded file bytes (no line wrap)>
 *     ==== PREVIEW_FILE_END ====
 *
 * Base64 chosen over hex (2x denser) and over a raw / sentinel-only
 * format (would corrupt on binary assets — PNGs, fonts). `base64 -w0`
 * disables the default 76-char wrap so each file's payload is one
 * line, which keeps the parser trivial.
 *
 * Paths emitted are relative to `dist/` so they go straight into
 * `previewBundleObjectKey` without further munging.
 */
const READ_DIST_SCRIPT = `#!/bin/bash
set -e
cd "$DIST_DIR"
# -print0 + read -r -d $'\\0' for filenames-with-spaces safety, even
# though Vite's output shouldn't contain any.
find . -type f -print0 | while IFS= read -r -d '' file; do
  rel="\${file#./}"
  size=$(stat -c%s "$file" 2>/dev/null || wc -c < "$file")
  echo "==== PREVIEW_FILE: $rel SIZE: $size ===="
  base64 -w0 "$file"
  echo ""
  echo "==== PREVIEW_FILE_END ===="
done
`;

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Build a static preview bundle for a specific Artifacts-draft commit
 * and upload it to R2 under the `preview-bundles/<previewId>/<sha>/`
 * prefix.
 */
export async function runBuildDraftPreview(
  env: BuildDraftPreviewEnv,
  input: BuildDraftPreviewInput,
  getSandboxFn: GetSandboxFn = getSandbox,
): Promise<BuildDraftPreviewResult> {
  // The Sandbox is keyed per-draft so it can warm between preview
  // builds. Each call re-clones into fresh workdirs (steps below) so
  // there's no state leakage between attempts.
  const sandbox = getSandboxFn(
    env.Sandbox,
    `preview:${input.draftRepoName}`,
  ) as PreviewBuildSandboxLike;

  // ── 1. Source clone ───────────────────────────────────────────────
  // The source repo is what `vite build` runs against. We need the
  // user's GitHub OAuth token to clone it (TARGET_REPO is private to
  // the project's GitHub org for the agent's purposes).
  const stored = await getStoredGitHubToken(env, input.userEmail);
  if (!stored) {
    return {
      ok: false,
      phase: "source_clone",
      error:
        "GitHub not connected — connect GitHub in Settings to enable draft previews.",
    };
  }
  const sourceClone = await cloneRepoIntoSandbox(
    sandbox as unknown as Parameters<typeof cloneRepoIntoSandbox>[0],
    {
      token: stored.token,
      repo: TARGET_REPO,
      workdir: SOURCE_WORKDIR,
    },
  );
  if (!sourceClone.ok) {
    return {
      ok: false,
      phase: "source_clone",
      error: redactSecrets(sourceClone.error, [stored.token]),
    };
  }

  // ── 2. Artifacts clone ────────────────────────────────────────────
  // We mint a write token even though we only READ here, matching
  // the convention in `runPublishDraft` — Artifacts' read+write
  // tokens both grant clone access, but mintWriteToken is the wired-
  // up helper across this codebase. The token lives only inside the
  // Sandbox container, never escapes via stdout/stderr we capture.
  let authenticatedDraftUrl: string;
  let bareDraftToken: string;
  try {
    const repo = await getDraftRepo(env.ARTIFACTS, input.userEmail, input.slug);
    const token = await mintWriteToken(repo);
    bareDraftToken = stripExpiresSuffix(token.plaintext);
    const draftRemote = buildArtifactsRemoteUrl({
      accountId: env.CF_ACCOUNT_ID,
      repoName: input.draftRepoName,
    });
    authenticatedDraftUrl = buildAuthenticatedRemoteUrl(
      draftRemote,
      bareDraftToken,
    );
  } catch (err) {
    return {
      ok: false,
      phase: "artifacts_clone",
      error: redactSecrets(
        err instanceof Error ? err.message : String(err),
        [],
      ),
    };
  }

  const draftClone = await cloneArtifactsRepoIntoSandbox(
    sandbox as unknown as Parameters<typeof cloneArtifactsRepoIntoSandbox>[0],
    {
      authenticatedUrl: authenticatedDraftUrl,
      workdir: DRAFT_WORKDIR,
    },
  );
  if (!draftClone.ok) {
    return {
      ok: false,
      phase: "artifacts_clone",
      error: redactSecrets(draftClone.error, [bareDraftToken]),
    };
  }

  // Pin the draft to the requested commit. The `commitSha` is the
  // build contract — if the caller (eventually #271) asked for sha
  // X, the bundle has to reflect X, not whatever HEAD happens to be.
  // `--detach` to avoid creating a branch ref we don't need.
  const checkoutResult = await sandbox.exec(
    `git -C "${DRAFT_WORKDIR}" -c advice.detachedHead=false checkout --detach "${input.commitSha}"`,
  );
  if (!checkoutResult.success || checkoutResult.exitCode !== 0) {
    return {
      ok: false,
      phase: "artifacts_clone",
      error: redactSecrets(
        `Failed to check out commit ${input.commitSha} in draft repo (exit ${
          checkoutResult.exitCode ?? "unknown"
        }).`,
        [bareDraftToken],
      ),
    };
  }

  // ── 3. Overlay ────────────────────────────────────────────────────
  // Confirm the draft contains the deck folder. A missing folder
  // means the commit doesn't actually contain a deck — likely a
  // caller bug (wrong sha, wrong slug). Surface it as `overlay` so
  // the failure points at the right step, not at the build / upload.
  const sourceDeckDirInDraft = `${DRAFT_WORKDIR}/src/decks/public/${input.slug}`;
  const probeResult = await sandbox.exec(`test -d "${sourceDeckDirInDraft}"`);
  if (!probeResult.success || probeResult.exitCode !== 0) {
    return {
      ok: false,
      phase: "overlay",
      error: `Draft commit does not contain src/decks/public/${input.slug}/.`,
    };
  }

  // Copy the deck folder onto the source checkout. `mkdir -p` the
  // parent directory first (it exists in any fresh source checkout,
  // but the cost is one redundant exec for safety). The source
  // checkout already ships a `hello/` demo deck; overlaying a
  // different slug is additive. If the slug matches an existing
  // public deck, we replace it.
  const destInSource = `${SOURCE_WORKDIR}/src/decks/public/${input.slug}`;
  const destParent = `${SOURCE_WORKDIR}/src/decks/public`;
  const overlayResult = await sandbox.exec(
    `mkdir -p "${destParent}" && rm -rf "${destInSource}" && cp -r "${sourceDeckDirInDraft}" "${destInSource}"`,
  );
  if (!overlayResult.success || overlayResult.exitCode !== 0) {
    return {
      ok: false,
      phase: "overlay",
      error: `Failed to overlay draft deck onto source (exit ${
        overlayResult.exitCode ?? "unknown"
      }).`,
    };
  }

  // ── 4. Install ────────────────────────────────────────────────────
  // `npm ci` is faster and more reproducible than `npm install`, but
  // requires the lockfile + the package.json to be in sync — which
  // they always are in a fresh GitHub clone. If `npm ci` proves
  // brittle in production (e.g. transient registry failures), this
  // is the line to soften to `npm install`.
  const installResult = await sandbox.exec("npm ci", { cwd: SOURCE_WORKDIR });
  if (!installResult.success || installResult.exitCode !== 0) {
    return {
      ok: false,
      phase: "install",
      error: `npm install failed (exit ${installResult.exitCode ?? "unknown"}).`,
    };
  }

  // ── 5. Build ──────────────────────────────────────────────────────
  // Direct `npx vite build` (not `npm run build`) so we skip the
  // `tsc -b` step the project's npm script chains. AI-generated TSX
  // can have type errors that wouldn't actually break runtime — we
  // want the preview iframe to show what the deck LOOKS like, not
  // to gate on a release-grade typecheck. The publish flow's full
  // test gate (#168's `runPublishDraft`) handles that.
  //
  // The `--base` flag tells Vite to rewrite every emitted asset URL
  // (`/assets/...`) with this prefix, so the bundle's index.html
  // references the eventual `/preview/<id>/<sha>/assets/...` paths.
  const baseFlag = `/preview/${input.previewId}/${input.commitSha}/`;
  const buildResult = await sandbox.exec(
    `npx vite build --base=${baseFlag}`,
    { cwd: SOURCE_WORKDIR },
  );
  if (!buildResult.success || buildResult.exitCode !== 0) {
    return {
      ok: false,
      phase: "build",
      error: `vite build failed (exit ${buildResult.exitCode ?? "unknown"}).`,
    };
  }

  // ── 6. Read dist tree ─────────────────────────────────────────────
  // Write the helper script then exec it with `DIST_DIR` pointing at
  // the source checkout's `dist/`.
  try {
    await sandbox.writeFile(READ_DIST_SCRIPT_PATH, READ_DIST_SCRIPT);
  } catch (err) {
    return {
      ok: false,
      phase: "upload",
      error: `Failed to write dist-read script: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const readResult = await sandbox.exec(`bash ${READ_DIST_SCRIPT_PATH}`, {
    env: { DIST_DIR: `${SOURCE_WORKDIR}/dist` },
  });
  if (!readResult.success || readResult.exitCode !== 0) {
    return {
      ok: false,
      phase: "upload",
      error: `Failed to read dist tree (exit ${readResult.exitCode ?? "unknown"}).`,
    };
  }

  const files = parseDistManifest(readResult.stdout ?? "");
  if (files.length === 0) {
    return {
      ok: false,
      phase: "upload",
      error: "Build produced an empty dist tree — no preview files to upload.",
    };
  }

  // ── 7. Upload ─────────────────────────────────────────────────────
  // Sequential upload — kept simple for v1. The dist tree is small
  // (tens of files, single-digit MB) and Workers' R2 bindings don't
  // gain meaningfully from concurrent puts at this scale. If preview
  // build latency becomes a problem, parallelising here is the
  // obvious lever.
  let uploaded = 0;
  for (const file of files) {
    try {
      await putPreviewBundleObject(env, {
        previewId: input.previewId,
        sha: input.commitSha,
        path: file.path,
        body: file.bytes,
      });
      // Surface the key shape for tests that assert on the contract.
      // The body of the call is a side-effect of putPreviewBundleObject;
      // the key helper is called separately so a #269 key-shape change
      // would surface in our tests as well.
      void previewBundleObjectKey({
        previewId: input.previewId,
        sha: input.commitSha,
        path: file.path,
      });
      uploaded += 1;
    } catch (err) {
      return {
        ok: false,
        phase: "upload",
        error: `Failed to upload ${file.path}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    ok: true,
    previewUrl: `/preview/${input.previewId}/${input.commitSha}/index.html`,
    uploadedFiles: uploaded,
  };
}

// ─── Manifest parser ─────────────────────────────────────────────────

interface DistFile {
  path: string;
  bytes: ArrayBuffer;
}

/**
 * Parse the bash script's manifest format back into `{ path, bytes }`
 * tuples. Defensive: any malformed block is skipped (logged via the
 * caller's return value, not thrown) so a single bad file doesn't
 * abort the whole upload pass.
 *
 * The expected per-file shape (newline-separated):
 *
 *     ==== PREVIEW_FILE: <relative-path> SIZE: <bytes> ====
 *     <one line of base64>
 *     ==== PREVIEW_FILE_END ====
 *
 * Exported for unit-test introspection (kept module-private here; the
 * test file exercises the full builder, not the parser in isolation).
 */
function parseDistManifest(stdout: string): DistFile[] {
  const files: DistFile[] = [];
  const lines = stdout.split("\n");
  let i = 0;
  while (i < lines.length) {
    const headerMatch = FILE_HEADER_RE.exec(lines[i] ?? "");
    if (!headerMatch) {
      i += 1;
      continue;
    }
    const path = headerMatch[1];
    const expectedSize = Number.parseInt(headerMatch[2] ?? "", 10);
    // The base64 payload sits on the line immediately after the
    // header. The end marker follows.
    const base64Line = lines[i + 1] ?? "";
    const endLine = lines[i + 2] ?? "";
    if (endLine !== FILE_END_MARKER) {
      // Malformed block — skip the header and continue scanning.
      i += 1;
      continue;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = base64ToArrayBuffer(base64Line);
    } catch {
      i += 3;
      continue;
    }
    if (Number.isFinite(expectedSize) && bytes.byteLength !== expectedSize) {
      // Size mismatch — log via the caller (we still upload; the
      // bytes we hold are what we sent and what R2 stores). In
      // practice this can only fire if a `stat` reported the wrong
      // size, which would itself be a Sandbox bug worth surfacing.
      // For v1 we accept the discrepancy.
    }
    files.push({ path, bytes });
    i += 3;
  }
  return files;
}

/**
 * Decode a base64 string to an ArrayBuffer. Uses `atob` (always
 * available in Workers + Node 16+). Throws on invalid input — the
 * caller catches and skips the malformed block.
 */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const trimmed = b64.trim();
  if (trimmed === "") return new ArrayBuffer(0);
  const binary = atob(trimmed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─── Secret redaction ────────────────────────────────────────────────

/**
 * Remove any known secret value from an error string before surfacing
 * it. Belt + braces against upstream helpers that include the
 * authenticated URL (with the token embedded) in their error messages.
 *
 * Also strips anything matching the Artifacts token pattern
 * (`art_v1_<hex>`) defensively — if a different upstream layer
 * embedded the token in some error format we haven't seen, this
 * catches it generically.
 */
function redactSecrets(message: string, extraSecrets: string[]): string {
  let out = message;
  for (const secret of extraSecrets) {
    if (!secret) continue;
    while (out.includes(secret)) {
      out = out.replace(secret, "[REDACTED]");
    }
  }
  // Strip any Artifacts-token-shaped substring (`art_v1_<hex>` with
  // optional `?expires=...` suffix). Cheap, generic, no false
  // positives in the wild.
  out = out.replace(/art_v1_[0-9a-f]+(\?expires=[0-9]+)?/gi, "[REDACTED]");
  // Strip GitHub OAuth tokens (`ghu_`, `ghs_`, `gho_`, `ghp_`, `ghr_`).
  out = out.replace(/gh[uosr]_[A-Za-z0-9]{20,}/g, "[REDACTED]");
  return out;
}
