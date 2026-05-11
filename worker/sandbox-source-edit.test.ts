/**
 * Tests for `worker/sandbox-source-edit.ts` — issue #131 phase 3c
 * slices 2-4 (clone, applyFiles, testGate).
 *
 * The Sandbox SDK can't run in jsdom / happy-dom (it transitively
 * imports `cloudflare:workers`), so each test constructs a narrow
 * `SandboxLike` stub with the four methods the helpers touch
 * (`gitCheckout`, `exec`, `writeFile`, `mkdir`). The helpers are
 * pure functions of those inputs, so the unit-test surface fully
 * pins their behaviour without needing a real container.
 *
 * Real-container-only behaviours not covered here (manual post-deploy
 * verification via the `/api/admin/sandbox/_smoke` endpoint and later
 * by the `proposeSourceEdit` tool):
 *
 *   - `gitCheckout` actually authenticates to GitHub with the token.
 *   - `writeFile` ends up at the right path on the container's FS.
 *   - `npm ci` finds a network route to npm + resolves the lockfile.
 *   - `npm test` finds the right binaries in `$PATH`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyFilesIntoSandbox,
  cloneRepoIntoSandbox,
  runSandboxTestGate,
  DEFAULT_REF,
  DEFAULT_WORKDIR,
  DEFAULT_CLONE_TIMEOUT_MS,
  type SandboxLike,
} from "./sandbox-source-edit";

// ─── Mock Sandbox surface ────────────────────────────────────────────

function makeSandboxMock(): {
  sandbox: SandboxLike;
  gitCheckout: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
} {
  const gitCheckout = vi.fn();
  const exec = vi.fn();
  const writeFile = vi.fn();
  const mkdir = vi.fn();
  return {
    // The shape is wider than what the helpers use, but TypeScript
    // is happy because we cast through the narrow surface they typed
    // against.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sandbox: { gitCheckout, exec, writeFile, mkdir } as any,
    gitCheckout,
    exec,
    writeFile,
    mkdir,
  };
}

const repo = { owner: "mcdays94", repo: "slide-of-hand" };
const token = "gho_test_token";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── cloneRepoIntoSandbox ───────────────────────────────────────────

describe("cloneRepoIntoSandbox — happy path", () => {
  it("clones the configured repo at HEAD of the default ref into /workspace/repo by default", async () => {
    const { sandbox, gitCheckout } = makeSandboxMock();
    gitCheckout.mockResolvedValue({
      success: true,
      repoUrl: "...",
      branch: DEFAULT_REF,
      targetDir: DEFAULT_WORKDIR,
      timestamp: "now",
      exitCode: 0,
    });
    const result = await cloneRepoIntoSandbox(sandbox, { token, repo });
    expect(result).toEqual({
      ok: true,
      workdir: DEFAULT_WORKDIR,
      ref: DEFAULT_REF,
    });
    expect(gitCheckout).toHaveBeenCalledOnce();
    const [repoUrl, options] = gitCheckout.mock.calls[0];
    // Token embedded via GitHub's documented x-access-token convention.
    expect(repoUrl).toBe(
      `https://x-access-token:${token}@github.com/${repo.owner}/${repo.repo}.git`,
    );
    expect(options).toEqual({
      branch: DEFAULT_REF,
      targetDir: DEFAULT_WORKDIR,
      depth: 1,
      cloneTimeoutMs: DEFAULT_CLONE_TIMEOUT_MS,
    });
  });

  it("uses a custom ref + workdir when supplied", async () => {
    const { sandbox, gitCheckout } = makeSandboxMock();
    gitCheckout.mockResolvedValue({
      success: true,
      repoUrl: "...",
      branch: "feat/x",
      targetDir: "/work",
      timestamp: "now",
      exitCode: 0,
    });
    const result = await cloneRepoIntoSandbox(sandbox, {
      token,
      repo,
      ref: "feat/x",
      workdir: "/work",
    });
    expect(result).toEqual({ ok: true, workdir: "/work", ref: "feat/x" });
    const [, options] = gitCheckout.mock.calls[0];
    expect(options).toMatchObject({
      branch: "feat/x",
      targetDir: "/work",
    });
  });

  it("uses a custom clone timeout when supplied", async () => {
    const { sandbox, gitCheckout } = makeSandboxMock();
    gitCheckout.mockResolvedValue({
      success: true,
      repoUrl: "...",
      branch: DEFAULT_REF,
      targetDir: DEFAULT_WORKDIR,
      timestamp: "now",
      exitCode: 0,
    });
    await cloneRepoIntoSandbox(sandbox, {
      token,
      repo,
      cloneTimeoutMs: 5_000,
    });
    const [, options] = gitCheckout.mock.calls[0];
    expect(options).toMatchObject({ cloneTimeoutMs: 5_000 });
  });

  it("falls back to the default ref when an empty/whitespace ref is supplied", async () => {
    const { sandbox, gitCheckout } = makeSandboxMock();
    gitCheckout.mockResolvedValue({
      success: true,
      repoUrl: "...",
      branch: DEFAULT_REF,
      targetDir: DEFAULT_WORKDIR,
      timestamp: "now",
      exitCode: 0,
    });
    const result = await cloneRepoIntoSandbox(sandbox, {
      token,
      repo,
      ref: "   ",
    });
    expect(result).toEqual({
      ok: true,
      workdir: DEFAULT_WORKDIR,
      ref: DEFAULT_REF,
    });
    const [, options] = gitCheckout.mock.calls[0];
    expect(options).toMatchObject({ branch: DEFAULT_REF });
  });
});

describe("cloneRepoIntoSandbox — error paths", () => {
  it("returns a friendly error when the token is empty (no SDK call)", async () => {
    const { sandbox, gitCheckout } = makeSandboxMock();
    const result = await cloneRepoIntoSandbox(sandbox, {
      token: "",
      repo,
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/GitHub OAuth token/i),
    });
    // Critical: never spend a clone attempt with an empty token —
    // the SDK call would just hit the network and 401, wasting time
    // and (potentially) bandwidth budget.
    expect(gitCheckout).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the token is whitespace-only", async () => {
    const { sandbox, gitCheckout } = makeSandboxMock();
    const result = await cloneRepoIntoSandbox(sandbox, {
      token: "   ",
      repo,
    });
    expect(result.ok).toBe(false);
    expect(gitCheckout).not.toHaveBeenCalled();
  });

  it("returns ok:false with exit code when gitCheckout reports success=false", async () => {
    const { sandbox, gitCheckout } = makeSandboxMock();
    gitCheckout.mockResolvedValue({
      success: false,
      repoUrl: "...",
      branch: DEFAULT_REF,
      targetDir: DEFAULT_WORKDIR,
      timestamp: "now",
      exitCode: 128,
    });
    const result = await cloneRepoIntoSandbox(sandbox, { token, repo });
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/exit 128/),
    });
  });

  it("returns ok:false when gitCheckout throws", async () => {
    const { sandbox, gitCheckout } = makeSandboxMock();
    gitCheckout.mockRejectedValue(new Error("Container DNS timeout"));
    const result = await cloneRepoIntoSandbox(sandbox, { token, repo });
    expect(result).toEqual({
      ok: false,
      error: "Container DNS timeout",
    });
  });
});

// ─── applyFilesIntoSandbox ─────────────────────────────────────────

describe("applyFilesIntoSandbox — happy path", () => {
  it("returns ok with empty paths when given an empty file list (no SDK calls)", async () => {
    const { sandbox, writeFile, mkdir } = makeSandboxMock();
    const result = await applyFilesIntoSandbox(sandbox, []);
    expect(result).toEqual({ ok: true, paths: [] });
    expect(writeFile).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("writes a single root-level file without calling mkdir", async () => {
    const { sandbox, writeFile, mkdir } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    const result = await applyFilesIntoSandbox(sandbox, [
      { path: "README.md", content: "hello" },
    ]);
    expect(result).toEqual({ ok: true, paths: ["README.md"] });
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith(
      `${DEFAULT_WORKDIR}/README.md`,
      "hello",
    );
  });

  it("creates parent directories for nested paths before writing", async () => {
    const { sandbox, writeFile, mkdir } = makeSandboxMock();
    mkdir.mockResolvedValue({ success: true });
    writeFile.mockResolvedValue({ success: true });
    const result = await applyFilesIntoSandbox(sandbox, [
      {
        path: "src/decks/public/hello/01-title.tsx",
        content: "// hello",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(mkdir).toHaveBeenCalledWith(
      `${DEFAULT_WORKDIR}/src/decks/public/hello`,
      { recursive: true },
    );
    expect(writeFile).toHaveBeenCalledWith(
      `${DEFAULT_WORKDIR}/src/decks/public/hello/01-title.tsx`,
      "// hello",
    );
  });

  it("writes multiple files in order and returns all paths", async () => {
    const { sandbox, writeFile, mkdir } = makeSandboxMock();
    mkdir.mockResolvedValue({ success: true });
    writeFile.mockResolvedValue({ success: true });
    const result = await applyFilesIntoSandbox(sandbox, [
      { path: "a.txt", content: "a" },
      { path: "src/b.txt", content: "b" },
      { path: "src/c.txt", content: "c" },
    ]);
    expect(result).toEqual({
      ok: true,
      paths: ["a.txt", "src/b.txt", "src/c.txt"],
    });
    expect(writeFile).toHaveBeenCalledTimes(3);
    // The two files inside `src/` each get an mkdir. The recursive
    // flag means the second call is idempotent on the now-existing
    // dir; we don't deduplicate at this layer.
    expect(mkdir).toHaveBeenCalledTimes(2);
  });

  it("uses the supplied workdir instead of the default", async () => {
    const { sandbox, writeFile, mkdir } = makeSandboxMock();
    mkdir.mockResolvedValue({ success: true });
    writeFile.mockResolvedValue({ success: true });
    await applyFilesIntoSandbox(
      sandbox,
      [{ path: "src/x.txt", content: "x" }],
      "/custom/work",
    );
    expect(mkdir).toHaveBeenCalledWith("/custom/work/src", {
      recursive: true,
    });
    expect(writeFile).toHaveBeenCalledWith("/custom/work/src/x.txt", "x");
  });

  it("normalizes a trailing slash on the workdir", async () => {
    const { sandbox, writeFile } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    await applyFilesIntoSandbox(
      sandbox,
      [{ path: "a.txt", content: "a" }],
      "/work/",
    );
    expect(writeFile).toHaveBeenCalledWith("/work/a.txt", "a");
  });
});

describe("applyFilesIntoSandbox — path validation", () => {
  it("rejects an empty path with a friendly error", async () => {
    const { sandbox, writeFile } = makeSandboxMock();
    const result = await applyFilesIntoSandbox(sandbox, [
      { path: "", content: "x" },
    ]);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/empty/i),
      failedPath: "",
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("rejects a path that starts with '/' (must be relative to workdir)", async () => {
    // Allowing leading `/` would let the model write to arbitrary
    // locations inside the container — e.g. /etc/passwd. The
    // workdir-relative contract is the security boundary.
    const { sandbox, writeFile } = makeSandboxMock();
    const result = await applyFilesIntoSandbox(sandbox, [
      { path: "/etc/passwd", content: "evil" },
    ]);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/relative/i),
      failedPath: "/etc/passwd",
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("rejects a path containing '..' segments (no traversal)", async () => {
    const { sandbox, writeFile } = makeSandboxMock();
    const result = await applyFilesIntoSandbox(sandbox, [
      { path: "src/../../etc/passwd", content: "evil" },
    ]);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/\.\./),
      failedPath: "src/../../etc/passwd",
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("rejects a path that resolves to nothing after splitting (e.g. '///')", async () => {
    const { sandbox, writeFile } = makeSandboxMock();
    const result = await applyFilesIntoSandbox(sandbox, [
      { path: "///", content: "x" },
    ]);
    expect(result.ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("stops at the first bad path and does NOT write later files", async () => {
    // A batch is atomic from the caller's POV — if any file is
    // rejected, no other files in the batch should land either,
    // otherwise the working tree gets a partial application that's
    // hard to reason about.
    const { sandbox, writeFile, mkdir } = makeSandboxMock();
    mkdir.mockResolvedValue({ success: true });
    writeFile.mockResolvedValue({ success: true });
    const result = await applyFilesIntoSandbox(sandbox, [
      { path: "a.txt", content: "a" },
      { path: "/bad", content: "b" },
      { path: "c.txt", content: "c" },
    ]);
    expect(result.ok).toBe(false);
    // First file should still be written before we hit the bad one
    // — sequential application; rollback isn't implemented here.
    // The caller orchestrates retry policy.
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(`${DEFAULT_WORKDIR}/a.txt`, "a");
  });
});

describe("applyFilesIntoSandbox — error paths", () => {
  it("returns ok:false with the path that failed when writeFile throws", async () => {
    const { sandbox, writeFile } = makeSandboxMock();
    writeFile.mockRejectedValue(new Error("disk full"));
    const result = await applyFilesIntoSandbox(sandbox, [
      { path: "a.txt", content: "x" },
    ]);
    expect(result).toEqual({
      ok: false,
      error: "disk full",
      failedPath: "a.txt",
    });
  });

  it("returns ok:false when mkdir throws on a nested path", async () => {
    const { sandbox, mkdir, writeFile } = makeSandboxMock();
    mkdir.mockRejectedValue(new Error("EACCES"));
    const result = await applyFilesIntoSandbox(sandbox, [
      { path: "src/x.txt", content: "x" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("EACCES");
      expect(result.failedPath).toBe("src/x.txt");
    }
    expect(writeFile).not.toHaveBeenCalled();
  });
});

// ─── runSandboxTestGate ────────────────────────────────────────────

/**
 * Helper to make exec results matching the SDK's shape.
 */
function execResult(
  exitCode: number,
  opts: { stdout?: string; stderr?: string } = {},
) {
  return {
    stdout: opts.stdout ?? "",
    stderr: opts.stderr ?? "",
    exitCode,
    success: exitCode === 0,
  };
}

describe("runSandboxTestGate — happy path", () => {
  it("returns ok:true with all four phases when every command exits 0", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec.mockResolvedValue(execResult(0, { stdout: "ok" }));
    const result = await runSandboxTestGate(sandbox);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phases).toHaveLength(4);
      expect(result.phases.map((p) => p.phase)).toEqual([
        "install",
        "typecheck",
        "test",
        "build",
      ]);
      // Each phase records command + exit code so the agent can show
      // the user exactly what ran.
      expect(result.phases[0].command).toBe("npm ci");
      expect(result.phases[1].command).toBe("npm run typecheck");
      expect(result.phases[2].command).toBe("npm test");
      expect(result.phases[3].command).toBe("npm run build");
      expect(result.phases.every((p) => p.exitCode === 0)).toBe(true);
    }
    expect(exec).toHaveBeenCalledTimes(4);
  });

  it("runs each phase inside the workdir via 'cd <workdir> && <command>'", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec.mockResolvedValue(execResult(0));
    await runSandboxTestGate(sandbox, "/work");
    // Sandbox's `exec` doesn't take a cwd, so we cd + && the command.
    // The cd is per-call so a failed phase's stale cd doesn't leak
    // to the next one.
    for (const call of exec.mock.calls) {
      const [cmd] = call;
      expect(cmd).toMatch(/^cd \/work && /);
    }
  });

  it("normalizes a trailing slash on the workdir", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec.mockResolvedValue(execResult(0));
    await runSandboxTestGate(sandbox, "/work/");
    expect(exec.mock.calls[0][0]).toMatch(/^cd \/work && /);
  });

  it("uses the default workdir when none is supplied", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec.mockResolvedValue(execResult(0));
    await runSandboxTestGate(sandbox);
    expect(exec.mock.calls[0][0]).toMatch(
      new RegExp(`^cd ${DEFAULT_WORKDIR} && `),
    );
  });
});

describe("runSandboxTestGate — fail-fast", () => {
  it("stops at the first failing phase and returns failedPhase + phases run so far", async () => {
    const { sandbox, exec } = makeSandboxMock();
    // install OK, typecheck fails → no test or build phase should run.
    exec
      .mockResolvedValueOnce(execResult(0))
      .mockResolvedValueOnce(
        execResult(2, { stderr: "type error at src/foo.ts:42" }),
      );
    const result = await runSandboxTestGate(sandbox);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedPhase).toBe("typecheck");
      expect(result.phases).toHaveLength(2);
      expect(result.phases[0].phase).toBe("install");
      expect(result.phases[0].ok).toBe(true);
      expect(result.phases[1].phase).toBe("typecheck");
      expect(result.phases[1].ok).toBe(false);
      expect(result.phases[1].stderr).toMatch(/type error/);
    }
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("fails at install when npm ci exits non-zero", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec.mockResolvedValueOnce(execResult(1, { stderr: "ENOENT lockfile" }));
    const result = await runSandboxTestGate(sandbox);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedPhase).toBe("install");
      expect(result.phases).toHaveLength(1);
    }
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("fails at test when vitest exits non-zero", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec
      .mockResolvedValueOnce(execResult(0))
      .mockResolvedValueOnce(execResult(0))
      .mockResolvedValueOnce(
        execResult(1, { stderr: "1 test failed" }),
      );
    const result = await runSandboxTestGate(sandbox);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedPhase).toBe("test");
      expect(result.phases).toHaveLength(3);
    }
  });

  it("fails at build when vite build exits non-zero", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec
      .mockResolvedValueOnce(execResult(0))
      .mockResolvedValueOnce(execResult(0))
      .mockResolvedValueOnce(execResult(0))
      .mockResolvedValueOnce(
        execResult(1, { stderr: "vite build failed" }),
      );
    const result = await runSandboxTestGate(sandbox);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedPhase).toBe("build");
      expect(result.phases).toHaveLength(4);
    }
  });
});

describe("runSandboxTestGate — error surface", () => {
  it("records phase failure when exec throws (e.g. container connection drops mid-phase)", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec
      .mockResolvedValueOnce(execResult(0))
      .mockRejectedValueOnce(new Error("container connection reset"));
    const result = await runSandboxTestGate(sandbox);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedPhase).toBe("typecheck");
      // Throws are translated into a phase result with exitCode -1
      // and the error message in stderr.
      const failed = result.phases[1];
      expect(failed.ok).toBe(false);
      expect(failed.exitCode).toBe(-1);
      expect(failed.stderr).toMatch(/container connection reset/);
    }
  });

  it("treats success=true but exitCode!=0 as a failure (defence against shape drift)", async () => {
    // Belt and braces: if a future SDK version starts reporting
    // `success: true, exitCode: 1` (which is contradictory), trust
    // the exit code. We've been bitten by SDK shape drift on
    // adjacent surfaces before.
    const { sandbox, exec } = makeSandboxMock();
    exec.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      exitCode: 1,
      success: true,
    });
    const result = await runSandboxTestGate(sandbox);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedPhase).toBe("install");
    }
  });
});
