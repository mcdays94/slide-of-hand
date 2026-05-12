/**
 * Pure-function helpers for the Sandbox-validated source-edit flow
 * (issue #131 phase 3c, slices 2-4).
 *
 * The agent's eventual `proposeSourceEdit` tool composes these three
 * helpers in sequence inside a fresh Sandbox container:
 *
 *   1. `cloneRepoIntoSandbox`  — shallow git-clone the source repo
 *      using the user's GitHub OAuth token.
 *   2. `applyFilesIntoSandbox` — write the model's proposed file
 *      edits into the cloned working tree.
 *   3. `runSandboxTestGate`    — run `npm ci` → `npm run typecheck`
 *      → `npm test` → `npm run build`, capturing each phase's
 *      output and failing fast.
 *
 * Each helper is exported as a free function (not a method) so the
 * agent tool layer can compose them sequentially, log between
 * phases, and surface intermediate results to the user via the chat
 * UI. They take a narrow `SandboxLike` interface — not the full
 * `Sandbox` type — so unit tests can mock the surface without
 * importing the SDK's container-backed runtime.
 *
 * **Where these run.** Always inside a Cloudflare Sandbox DO
 * instance. Never invoke from the Worker fetch handler directly —
 * they're slow (10-90 seconds total) and need to be wrapped by a
 * UI-facing tool that streams progress.
 *
 * **Why this lives outside `agent-tools.ts`.** The agent tools file
 * is the AI SDK boundary — `tool()` definitions with `inputSchema`
 * + `execute`. These helpers are reusable below that boundary; if
 * we ever add a non-agent surface that needs the same flow (e.g. an
 * admin "rebase + retest a stale PR" button), it can call these
 * directly without dragging the agent's tool machinery along.
 */

import type { Sandbox } from "@cloudflare/sandbox";

// ─── Narrow Sandbox surface ──────────────────────────────────────────
//
// We narrow `Sandbox` to just the methods used here for two reasons:
//   1. Tests can mock the surface with a few `vi.fn()` lines rather
//      than constructing a full Sandbox-shaped object.
//   2. If a future Sandbox SDK version reshapes the broader surface,
//      these helpers only break if the specific methods we use
//      change — not on every unrelated revision.

export type SandboxLike = Pick<
  Sandbox,
  "gitCheckout" | "exec" | "writeFile" | "mkdir"
>;

// ─── Helper 1: cloneRepoIntoSandbox ─────────────────────────────────

export interface CloneRepoOptions {
  /**
   * GitHub OAuth token used to authenticate the clone. Per-user
   * token from `GITHUB_TOKENS` KV, looked up at the agent tool layer
   * via the request's Access email. The token is embedded in the
   * clone URL as `x-access-token:<token>@github.com/...` — fine here
   * because the Sandbox container is ephemeral and torn down right
   * after the test gate, so no token leaks survive to disk or shell
   * history.
   */
  token: string;
  /**
   * Owner + repo for the clone target. Always the configured
   * `TARGET_REPO` from `worker/github-client.ts` in production;
   * exposed as a parameter so tests can pin a different value
   * without monkey-patching the constants.
   */
  repo: { owner: string; repo: string };
  /** Ref to check out. Defaults to `"main"`. */
  ref?: string;
  /** Target directory inside the sandbox. Defaults to `"/workspace/repo"`. */
  workdir?: string;
  /**
   * Clone timeout in milliseconds. Defaults to 60 seconds — the
   * source repo is small (<50 MB) and a shallow clone over a fast
   * link is sub-10 seconds in practice, so 60s gives us 6x headroom.
   */
  cloneTimeoutMs?: number;
}

export type CloneRepoResult =
  | { ok: true; workdir: string; ref: string }
  | { ok: false; error: string };

/** Default workdir inside the sandbox container. */
export const DEFAULT_WORKDIR = "/workspace/repo";

/** Default ref to check out. Mirrors GitHub's default branch convention. */
export const DEFAULT_REF = "main";

/** Default clone timeout. See `CloneRepoOptions.cloneTimeoutMs`. */
export const DEFAULT_CLONE_TIMEOUT_MS = 60_000;

export async function cloneRepoIntoSandbox(
  sandbox: SandboxLike,
  options: CloneRepoOptions,
): Promise<CloneRepoResult> {
  const token = options.token.trim();
  if (!token) {
    // Defensive: an empty token would still try to clone (the URL
    // would be `https://x-access-token:@github.com/...` which GitHub
    // rejects with a permission error). Catch it earlier so the
    // caller's error surface is friendlier.
    return {
      ok: false,
      error: "Missing GitHub OAuth token. Connect GitHub in Settings.",
    };
  }
  const ref = (options.ref ?? DEFAULT_REF).trim() || DEFAULT_REF;
  const workdir = (options.workdir ?? DEFAULT_WORKDIR).trim() || DEFAULT_WORKDIR;
  // GitHub's documented OAuth-over-HTTPS pattern. The `x-access-token`
  // username is a GitHub convention — the actual auth happens via
  // the token's bearer value embedded as the password.
  const repoUrl = `https://x-access-token:${token}@github.com/${options.repo.owner}/${options.repo.repo}.git`;
  try {
    const result = await sandbox.gitCheckout(repoUrl, {
      branch: ref,
      targetDir: workdir,
      depth: 1,
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

// ─── Helper 2: applyFilesIntoSandbox ────────────────────────────────

export interface FileEdit {
  /**
   * Path relative to the workdir. Always forward-slash-separated;
   * leading slashes are stripped to avoid path-traversal accidents.
   * Paths containing `..` segments are rejected.
   */
  path: string;
  content: string;
}

export type ApplyFilesResult =
  | { ok: true; paths: string[] }
  | { ok: false; error: string; failedPath?: string };

/**
 * Reject paths that would escape the workdir — leading `/`, `..`
 * segments, or empty path. Returns a friendly error string if the
 * path is bad; `null` if it's fine.
 */
function validateRelativePath(path: string): string | null {
  if (!path || path.length === 0) return "Empty path";
  if (path.startsWith("/")) return "Path must be relative (no leading '/')";
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.some((s) => s === "..")) return "Path may not contain '..'";
  if (segments.length === 0) return "Path resolves to nothing";
  return null;
}

/**
 * Compute the parent directory of a relative file path. Returns `""`
 * for files directly in the workdir.
 */
function parentDir(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? "" : relativePath.slice(0, idx);
}

export async function applyFilesIntoSandbox(
  sandbox: SandboxLike,
  files: readonly FileEdit[],
  workdir: string = DEFAULT_WORKDIR,
): Promise<ApplyFilesResult> {
  if (files.length === 0) {
    return { ok: true, paths: [] };
  }
  const trimmedWorkdir = workdir.replace(/\/+$/, "");
  const written: string[] = [];
  for (const edit of files) {
    const pathError = validateRelativePath(edit.path);
    if (pathError) {
      return { ok: false, error: pathError, failedPath: edit.path };
    }
    const relative = edit.path;
    const absolute = `${trimmedWorkdir}/${relative}`;
    const parent = parentDir(relative);
    try {
      if (parent.length > 0) {
        // Always recursive — the Sandbox mkdir is idempotent on an
        // existing directory, so writing siblings into the same
        // directory across multiple edits is fine.
        await sandbox.mkdir(`${trimmedWorkdir}/${parent}`, {
          recursive: true,
        });
      }
      await sandbox.writeFile(absolute, edit.content);
      written.push(relative);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        failedPath: relative,
      };
    }
  }
  return { ok: true, paths: written };
}

// ─── Helper 3: runSandboxTestGate ───────────────────────────────────

export type TestGatePhase = "install" | "typecheck" | "test" | "build";

export interface PhaseResult {
  phase: TestGatePhase;
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type TestGateResult =
  | { ok: true; phases: PhaseResult[] }
  | { ok: false; failedPhase: TestGatePhase; phases: PhaseResult[] };

/**
 * Commands run for each phase. Hard-coded against this repo's
 * `package.json` scripts. If the project's commands change (e.g.
 * `npm test` becomes a different runner), update the relevant entry
 * here and the test fixtures will exercise the new command.
 */
const PHASE_COMMANDS: Record<TestGatePhase, string> = {
  install: "npm ci",
  typecheck: "npm run typecheck",
  test: "npm test",
  build: "npm run build",
};

/** Order matters — failures fail-fast at the FIRST phase to error. */
const PHASE_ORDER: TestGatePhase[] = [
  "install",
  "typecheck",
  "test",
  "build",
];

export async function runSandboxTestGate(
  sandbox: SandboxLike,
  workdir: string = DEFAULT_WORKDIR,
): Promise<TestGateResult> {
  const trimmedWorkdir = workdir.replace(/\/+$/, "");
  const phases: PhaseResult[] = [];
  for (const phase of PHASE_ORDER) {
    const command = PHASE_COMMANDS[phase];
    const phaseResult = await runPhase(
      sandbox,
      phase,
      command,
      trimmedWorkdir,
    );
    phases.push(phaseResult);
    if (!phaseResult.ok) {
      return { ok: false, failedPhase: phase, phases };
    }
  }
  return { ok: true, phases };
}

async function runPhase(
  sandbox: SandboxLike,
  phase: TestGatePhase,
  command: string,
  workdir: string,
): Promise<PhaseResult> {
  try {
    // The Sandbox SDK's ExecOptions accepts `cwd` so we don't have
    // to wrap the command with `cd ... && ...`. Cleaner reporting
    // (the recorded `command` stays as `npm ci` rather than the
    // shell-joined form) and avoids subtle quoting issues when the
    // command itself contains `&&` / `|`.
    const result = await sandbox.exec(command, { cwd: workdir });
    return {
      phase,
      ok: result.success && result.exitCode === 0,
      command,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? -1,
    };
  } catch (err) {
    return {
      phase,
      ok: false,
      command,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: -1,
    };
  }
}

// ─── Helper 4: commitAndPushInSandbox ──────────────────────────────

export interface CommitAndPushOptions {
  /**
   * Branch name to create + push. Convention: `agent/<slug>-<timestamp>`
   * so it's obvious in the GitHub UI that this branch came from the
   * in-Studio agent and not from a hand-driven workflow.
   */
  branchName: string;
  /**
   * Git author name. Surfaced in the commit metadata + the PR's
   * commit list. The caller (`runProposeSourceEdit`) passes
   * `SLIDE_OF_HAND_COMMIT_IDENTITY.name` here — see
   * `worker/github-client.ts` for the "Cutindah" post-mortem on why
   * per-user OAuth-derived identities mis-attribute and why the
   * project owner's identity is pinned.
   */
  authorName: string;
  /**
   * Git author email. Verified for GitHub commit attribution. The
   * caller passes `SLIDE_OF_HAND_COMMIT_IDENTITY.email` —
   * `amtccdias@gmail.com` is the project owner's verified email on
   * `mcdays94`'s GitHub account.
   */
  authorEmail: string;
  /**
   * Human-readable commit message. Used verbatim — the script passes
   * it through an env var so embedded quotes / newlines don't need
   * shell escaping.
   */
  commitMessage: string;
}

export type CommitAndPushResult =
  | {
      ok: true;
      /** The new commit's full 40-char SHA. */
      sha: string;
      /** Echo back the branch we pushed for downstream PR-open use. */
      branch: string;
    }
  | {
      ok: false;
      /** True only when the diff was empty after `git add -A`. */
      noEffectiveChanges?: boolean;
      error: string;
      /** Captured stderr from the failing step (empty if the SDK call itself threw). */
      stderr?: string;
    };

/**
 * Path inside the sandbox where the commit script is written. Single
 * fixed path because the sandbox is single-use per chat turn; if
 * `commitAndPushInSandbox` is called more than once (e.g. retry), it
 * just overwrites the previous script.
 */
const COMMIT_SCRIPT_PATH = "/tmp/agent-commit.sh";

/**
 * Commit script — written to a file inside the sandbox and executed
 * with the relevant inputs piped in via env vars. Lives as a file
 * (rather than a long `bash -c '...'` literal) so the script's quoting
 * stays simple bash and the JS string in this module doesn't need
 * shell-escape gymnastics for branch names / commit messages.
 *
 * Exit codes:
 *   - 0      = commit + push succeeded; commit SHA is on stdout.
 *   - 2      = `git add -A` found nothing to commit (degenerate case
 *              where the model proposed edits but they were no-ops vs.
 *              HEAD). Stderr has the `NO_EFFECTIVE_CHANGES` marker.
 *   - other  = git failed at some step; stderr has the underlying
 *              error.
 */
const COMMIT_SCRIPT = `#!/bin/bash
set -e
git checkout -b "$BRANCH_NAME"
git add -A
if git diff --cached --quiet; then
  echo "NO_EFFECTIVE_CHANGES" >&2
  exit 2
fi
git commit -m "$COMMIT_MSG"
git push -u origin "$BRANCH_NAME"
git rev-parse HEAD
`;

/**
 * Inside the cloned sandbox repo: create a fresh branch, commit
 * everything in the working tree, push to origin, return the commit
 * SHA. Wrapper around a single `sandbox.exec(bash agent-commit.sh)`
 * call — the bash script handles fail-fast + the no-effective-changes
 * special case; this function translates the result into our typed
 * union.
 *
 * Identity: passed via the standard `GIT_AUTHOR_*` / `GIT_COMMITTER_*`
 * env vars which git natively respects. Avoids touching `git config`
 * (which would persist into the cloned repo and surprise any later
 * scripts that read it).
 *
 * **Why `git add -A`** (which the project's own commit discipline
 * forbids elsewhere): the sandbox starts as a clean clone, then
 * `applyFilesIntoSandbox` is the ONLY thing that mutates the tree.
 * `git add -A` therefore tracks exactly the files the model proposed
 * — and only those. The sandbox is destroyed after this call, so
 * there's no broader workspace to accidentally include. The project's
 * "no `git add -A` in your own checkout" rule still applies for the
 * orchestrator / worker.
 */
export async function commitAndPushInSandbox(
  sandbox: SandboxLike,
  options: CommitAndPushOptions,
  workdir: string = DEFAULT_WORKDIR,
): Promise<CommitAndPushResult> {
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
        BRANCH_NAME: branchName,
        COMMIT_MSG: commitMessage,
        // Set BOTH author + committer so the commit is attributed
        // consistently — git falls back to system identity for either
        // if only one is set, which would surface as a mismatched
        // "Committed by" line on GitHub.
        GIT_AUTHOR_NAME: authorName,
        GIT_AUTHOR_EMAIL: authorEmail,
        GIT_COMMITTER_NAME: authorName,
        GIT_COMMITTER_EMAIL: authorEmail,
      },
    });
    if (result.exitCode === 2 && /NO_EFFECTIVE_CHANGES/.test(result.stderr ?? "")) {
      return {
        ok: false,
        noEffectiveChanges: true,
        error: "No effective changes to commit (working tree matches HEAD).",
        stderr: result.stderr,
      };
    }
    if (!result.success || result.exitCode !== 0) {
      return {
        ok: false,
        error: `Commit / push failed (exit ${result.exitCode ?? "unknown"})`,
        stderr: result.stderr ?? "",
      };
    }
    // `git rev-parse HEAD` is the last command — its full-SHA output
    // is the last non-empty line of stdout. Defensive parsing in
    // case earlier git commands leak chatter to stdout.
    const lines = (result.stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const sha = lines[lines.length - 1] ?? "";
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      return {
        ok: false,
        error: `Commit succeeded but could not parse SHA from stdout`,
        stderr: result.stderr ?? "",
      };
    }
    return { ok: true, sha, branch: branchName };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
