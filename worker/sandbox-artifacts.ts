/**
 * Sandbox helpers for Cloudflare Artifacts repos (issue #168 Wave 1 /
 * Worker A).
 *
 * Sibling to `worker/sandbox-source-edit.ts` (which handles the
 * GitHub source-edit flow). These helpers handle clone + commit/push
 * against the Cloudflare Artifacts git protocol, which has three
 * notable differences from GitHub:
 *
 *   1. Authentication is via HTTP Basic in the URL with `x` as the
 *      placeholder username and the bare token (sans `?expires=`
 *      suffix) in the password slot. Built upstream by
 *      `buildAuthenticatedRemoteUrl()` in `worker/artifacts-client.ts`.
 *
 *   2. Push must use git protocol v1 — Artifacts doesn't support v2
 *      `git-receive-pack`. We force `-c protocol.version=1` on every
 *      push.
 *
 *   3. Fresh Artifacts repos are EMPTY (no initial commit). `git
 *      clone` of an empty repo succeeds but produces an empty working
 *      tree. The first push therefore has to `-u origin <branch>` to
 *      establish upstream on first contact.
 *
 * The Sandbox-side commit identity is taken from the caller — the
 * agent flow passes the user's Access-issued email + a display name.
 * The token itself never leaves the URL (no env-var spillage to the
 * commit's stored config), so a captured Sandbox image can't leak
 * write credentials past its TTL.
 */

import type { SandboxLike } from "./sandbox-source-edit";
import { DEFAULT_WORKDIR } from "./sandbox-source-edit";

// ─── Clone ───────────────────────────────────────────────────────────

export interface CloneArtifactsOptions {
  /**
   * Pre-authenticated HTTPS clone URL. Build via
   * `buildAuthenticatedRemoteUrl(remote, token)` so the token is
   * embedded in HTTP Basic credentials with `x` as the placeholder
   * username.
   */
  authenticatedUrl: string;
  /** Target directory inside the sandbox. Defaults to `/workspace/repo`. */
  workdir?: string;
  /** Branch to check out. Defaults to `"main"`. */
  ref?: string;
  /** Clone timeout in ms. Defaults to 60s. */
  cloneTimeoutMs?: number;
  /** Shallow clone depth. Defaults to 1 (we never need full history). */
  depth?: number;
}

export type CloneArtifactsResult =
  | { ok: true; workdir: string; ref: string }
  | { ok: false; error: string };

export const DEFAULT_CLONE_TIMEOUT_MS = 60_000;

export async function cloneArtifactsRepoIntoSandbox(
  sandbox: SandboxLike,
  options: CloneArtifactsOptions,
): Promise<CloneArtifactsResult> {
  const workdir =
    (options.workdir ?? DEFAULT_WORKDIR).trim() || DEFAULT_WORKDIR;
  const ref = (options.ref ?? "main").trim() || "main";
  try {
    const result = await sandbox.gitCheckout(options.authenticatedUrl, {
      branch: ref,
      targetDir: workdir,
      depth: options.depth ?? 1,
      cloneTimeoutMs: options.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS,
    });
    if (!result.success) {
      return {
        ok: false,
        error: `git clone failed (exit ${result.exitCode ?? "unknown"})`,
      };
    }
    return { ok: true, workdir, ref };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Commit + push ───────────────────────────────────────────────────

export interface CommitAndPushArtifactsOptions {
  /**
   * Pre-authenticated HTTPS push URL. Usually the same as the clone
   * URL, with the same token (or a fresh one minted for the push).
   */
  authenticatedUrl: string;
  /** Branch to push. Forks default to `main`; iterations stay on `main`. */
  branchName: string;
  commitMessage: string;
  /**
   * Git author identity for the Artifacts commit. Per-user is
   * INTENTIONAL here — Artifacts repos are per-user drafts named
   * `${userEmail}-${slug}`, so the repo's history naturally
   * reflects who drove each iteration. Use the user's Access-issued
   * email directly.
   *
   * Note: this is DIFFERENT from GitHub-bound commits (e.g.
   * `runProposeSourceEdit`), which pin to `SLIDE_OF_HAND_COMMIT_IDENTITY`
   * (the project owner) regardless of who's authenticated. See
   * `worker/github-client.ts` for the "Cutindah" post-mortem.
   */
  authorName: string;
  authorEmail: string;
  /**
   * Optional git-notes payload. If set, attaches a note to the new
   * commit under the `refs/notes/prompts` ref so prompt history travels
   * with the repo. Notes are pushed separately via `git push origin
   * refs/notes/prompts`.
   */
  promptNote?: string;
}

export type CommitAndPushArtifactsResult =
  | {
      ok: true;
      sha: string;
      branch: string;
      promptNotePushed?: boolean;
    }
  | {
      ok: false;
      noEffectiveChanges?: boolean;
      error: string;
      stderr?: string;
    };

const COMMIT_SCRIPT_PATH = "/tmp/artifacts-commit.sh";

/**
 * Commit script. Writes to a file in the sandbox and runs with
 * relevant inputs via env vars. Lives as a file (not an inline bash
 * literal) to keep quoting sane for branch names and commit messages.
 *
 * Exit codes:
 *   - 0 = success; commit SHA is on stdout's last line.
 *   - 2 = no effective changes (working tree matches HEAD or the
 *         initial commit had nothing to commit).
 *   - other = git failed; stderr has the underlying error.
 *
 * Push notes: when `PROMPT_NOTE` is non-empty, the script attaches a
 * git note to the new commit and pushes the notes ref alongside the
 * main push. If the notes push fails, the script writes
 * `NOTES_PUSH_FAILED` to stderr but does NOT fail the overall commit
 * — losing prompt history is regrettable but not fatal.
 */
const COMMIT_SCRIPT = `#!/bin/bash
set -e

git checkout -B "$BRANCH_NAME"
git add -A
if git diff --cached --quiet; then
  echo "NO_EFFECTIVE_CHANGES" >&2
  exit 2
fi
git commit -m "$COMMIT_MSG"

# Force protocol v1 — Artifacts does not support v2 receive-pack.
# Always pass -u so the first push on an empty repo establishes
# upstream cleanly; harmless on subsequent pushes (just refreshes
# the tracking config).
git -c protocol.version=1 push -u "$REMOTE_URL" "$BRANCH_NAME"

if [ -n "$PROMPT_NOTE" ]; then
  git notes --ref=refs/notes/prompts add -m "$PROMPT_NOTE" HEAD 2>&1 || true
  if git -c protocol.version=1 push "$REMOTE_URL" refs/notes/prompts:refs/notes/prompts 2>&1; then
    echo "NOTES_PUSHED" >&2
  else
    echo "NOTES_PUSH_FAILED" >&2
  fi
fi

git rev-parse HEAD
`;

export async function commitAndPushToArtifactsInSandbox(
  sandbox: SandboxLike,
  options: CommitAndPushArtifactsOptions,
  workdir: string = DEFAULT_WORKDIR,
): Promise<CommitAndPushArtifactsResult> {
  const trimmedWorkdir = workdir.replace(/\/+$/, "");
  const branchName = options.branchName.trim();
  const commitMessage = options.commitMessage.trim();
  const authorName = options.authorName.trim();
  const authorEmail = options.authorEmail.trim();
  if (!branchName) return { ok: false, error: "Missing branch name" };
  if (!commitMessage) return { ok: false, error: "Missing commit message" };
  if (!authorName) return { ok: false, error: "Missing author name" };
  if (!authorEmail) return { ok: false, error: "Missing author email" };

  try {
    await sandbox.writeFile(COMMIT_SCRIPT_PATH, COMMIT_SCRIPT);
    const result = await sandbox.exec(`bash ${COMMIT_SCRIPT_PATH}`, {
      cwd: trimmedWorkdir,
      env: {
        REMOTE_URL: options.authenticatedUrl,
        BRANCH_NAME: branchName,
        COMMIT_MSG: commitMessage,
        PROMPT_NOTE: options.promptNote ?? "",
        GIT_AUTHOR_NAME: authorName,
        GIT_AUTHOR_EMAIL: authorEmail,
        GIT_COMMITTER_NAME: authorName,
        GIT_COMMITTER_EMAIL: authorEmail,
      },
    });

    const stderr = result.stderr ?? "";
    if (result.exitCode === 2 && /NO_EFFECTIVE_CHANGES/.test(stderr)) {
      return {
        ok: false,
        noEffectiveChanges: true,
        error: "No effective changes to commit (working tree matches HEAD).",
        stderr,
      };
    }
    if (!result.success || result.exitCode !== 0) {
      return {
        ok: false,
        error: `Commit / push failed (exit ${result.exitCode ?? "unknown"})`,
        stderr,
      };
    }

    const lines = (result.stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const sha = lines[lines.length - 1] ?? "";
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      return {
        ok: false,
        error: "Commit succeeded but could not parse SHA from stdout",
        stderr,
      };
    }

    const promptNotePushed = /NOTES_PUSHED/.test(stderr);

    return {
      ok: true,
      sha,
      branch: branchName,
      ...(options.promptNote ? { promptNotePushed } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
