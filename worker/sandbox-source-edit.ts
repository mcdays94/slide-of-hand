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
    // `cd <workdir> && <command>` because Sandbox's `exec` doesn't
    // accept a cwd option directly (the workdir is at the container
    // level, not per-call). Using a subshell keeps the boundary
    // clean — the working directory change doesn't leak to the next
    // phase's exec.
    const result = await sandbox.exec(`cd ${workdir} && ${command}`);
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
