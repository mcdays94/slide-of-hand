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
  commitAndPushInSandbox,
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

  it("runs each phase inside the workdir via ExecOptions.cwd (no shell-join)", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec.mockResolvedValue(execResult(0));
    await runSandboxTestGate(sandbox, "/work");
    // The Sandbox SDK's ExecOptions accepts `cwd` directly so we
    // don't wrap with `cd ... && ...`. Cleaner reporting + avoids
    // subtle quoting issues when commands contain shell metacharacters.
    for (const call of exec.mock.calls) {
      const [cmd, options] = call;
      expect(cmd).not.toMatch(/^cd /);
      expect(options).toEqual({ cwd: "/work" });
    }
  });

  it("normalizes a trailing slash on the workdir", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec.mockResolvedValue(execResult(0));
    await runSandboxTestGate(sandbox, "/work/");
    expect(exec.mock.calls[0][1]).toEqual({ cwd: "/work" });
  });

  it("uses the default workdir when none is supplied", async () => {
    const { sandbox, exec } = makeSandboxMock();
    exec.mockResolvedValue(execResult(0));
    await runSandboxTestGate(sandbox);
    expect(exec.mock.calls[0][1]).toEqual({ cwd: DEFAULT_WORKDIR });
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

// ─── commitAndPushInSandbox ─────────────────────────────────────────

const goodCommit = {
  branchName: "agent/hello-1715425200000",
  authorName: "alice",
  authorEmail: "1234567+alice@users.noreply.github.com",
  commitMessage: "Agent: tighten the title slide copy",
};

/** 40-char hex SHA. */
const FAKE_SHA = "abcdef0123456789abcdef0123456789abcdef01";

describe("commitAndPushInSandbox — happy path", () => {
  it("writes the commit script, execs it, and returns the parsed SHA + branch", async () => {
    const { sandbox, writeFile, exec } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    exec.mockResolvedValue(execResult(0, { stdout: `${FAKE_SHA}\n` }));

    const result = await commitAndPushInSandbox(sandbox, goodCommit);
    expect(result).toEqual({
      ok: true,
      sha: FAKE_SHA,
      branch: goodCommit.branchName,
    });
    // Single-shot script: write the .sh, then exec bash on it.
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [scriptPath, scriptContent] = writeFile.mock.calls[0];
    expect(scriptPath).toBe("/tmp/agent-commit.sh");
    expect(scriptContent).toMatch(/git checkout -b "\$BRANCH_NAME"/);
    expect(scriptContent).toMatch(/git push -u origin "\$BRANCH_NAME"/);
    expect(scriptContent).toMatch(/git rev-parse HEAD/);
  });

  it("passes branch + commit message + git identity via env vars (no shell escaping)", async () => {
    // Shell-escape gymnastics are how injection bugs creep in. The
    // env-var path is bulletproof — any string is safe as a value.
    const { sandbox, writeFile, exec } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    exec.mockResolvedValue(execResult(0, { stdout: `${FAKE_SHA}\n` }));

    await commitAndPushInSandbox(sandbox, {
      branchName: "agent/hello-1",
      authorName: "alice",
      authorEmail: "alice@x.com",
      // Embedded quotes + newline — wouldn't survive a `git commit -m "..."`
      // shell-interpolation. The env-var path passes the literal bytes.
      commitMessage: `Title: "fix"\nBody: ok`,
    });
    const [, options] = exec.mock.calls[0];
    expect(options).toMatchObject({
      cwd: DEFAULT_WORKDIR,
      env: {
        BRANCH_NAME: "agent/hello-1",
        COMMIT_MSG: `Title: "fix"\nBody: ok`,
        GIT_AUTHOR_NAME: "alice",
        GIT_AUTHOR_EMAIL: "alice@x.com",
        GIT_COMMITTER_NAME: "alice",
        GIT_COMMITTER_EMAIL: "alice@x.com",
      },
    });
  });

  it("uses the supplied workdir when given (normalizing trailing slash)", async () => {
    const { sandbox, writeFile, exec } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    exec.mockResolvedValue(execResult(0, { stdout: `${FAKE_SHA}\n` }));
    await commitAndPushInSandbox(sandbox, goodCommit, "/custom/work/");
    expect(exec.mock.calls[0][1]).toMatchObject({ cwd: "/custom/work" });
  });

  it("trims chatter from earlier git commands and parses the SHA off the last line", async () => {
    // Defensive parsing: if a future git release prints anything
    // extra to stdout from checkout/commit/push, the SHA is still on
    // the final line because `rev-parse HEAD` is the last command.
    const { sandbox, writeFile, exec } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    exec.mockResolvedValue(
      execResult(0, {
        stdout: [
          "Switched to a new branch 'agent/x'",
          "[agent/x 1234567] Agent edit",
          "Branch 'agent/x' set up to track 'origin/agent/x'",
          FAKE_SHA,
          "",
        ].join("\n"),
      }),
    );
    const result = await commitAndPushInSandbox(sandbox, goodCommit);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sha).toBe(FAKE_SHA);
  });
});

describe("commitAndPushInSandbox — input validation", () => {
  it.each([
    ["branch name", { ...goodCommit, branchName: "" }, /branch/i],
    ["branch name (whitespace)", { ...goodCommit, branchName: "   " }, /branch/i],
    ["commit message", { ...goodCommit, commitMessage: "" }, /message/i],
    ["author name", { ...goodCommit, authorName: "" }, /author name/i],
    ["author email", { ...goodCommit, authorEmail: "" }, /author email/i],
  ])(
    "rejects missing %s before spending any sandbox calls",
    async (_label, options, errPattern) => {
      const { sandbox, writeFile, exec } = makeSandboxMock();
      const result = await commitAndPushInSandbox(sandbox, options);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(errPattern);
      expect(writeFile).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalled();
    },
  );
});

describe("commitAndPushInSandbox — error paths", () => {
  it("reports `noEffectiveChanges: true` when git diff --cached is empty (exit 2)", async () => {
    // The degenerate case where the model proposed edits that, after
    // applyFiles, match HEAD byte-for-byte. The bash script signals
    // this with exit 2 + a specific stderr marker.
    const { sandbox, writeFile, exec } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    exec.mockResolvedValue({
      stdout: "",
      stderr: "NO_EFFECTIVE_CHANGES\n",
      exitCode: 2,
      success: false,
    });
    const result = await commitAndPushInSandbox(sandbox, goodCommit);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.noEffectiveChanges).toBe(true);
      expect(result.error).toMatch(/no effective changes/i);
    }
  });

  it("returns ok:false with stderr when the script exits non-zero", async () => {
    const { sandbox, writeFile, exec } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    exec.mockResolvedValue({
      stdout: "",
      stderr: "fatal: Authentication failed for 'https://github.com/...'\n",
      exitCode: 128,
      success: false,
    });
    const result = await commitAndPushInSandbox(sandbox, goodCommit);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exit 128/);
      expect(result.stderr).toMatch(/Authentication failed/);
      // Not the no-changes case.
      expect(result.noEffectiveChanges).toBeUndefined();
    }
  });

  it("returns ok:false when the script succeeded but stdout has no parseable SHA", async () => {
    // Defensive: if the upstream git ever stops printing the SHA on
    // the last line (unlikely, but Git CLI output IS technically
    // "for human consumption"), we don't want to return a garbage SHA.
    const { sandbox, writeFile, exec } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    exec.mockResolvedValue(
      execResult(0, { stdout: "some chatter without a sha\n" }),
    );
    const result = await commitAndPushInSandbox(sandbox, goodCommit);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/SHA/);
    }
  });

  it("returns ok:false when writeFile throws", async () => {
    const { sandbox, writeFile, exec } = makeSandboxMock();
    writeFile.mockRejectedValue(new Error("/tmp not writable"));
    const result = await commitAndPushInSandbox(sandbox, goodCommit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not writable/);
    expect(exec).not.toHaveBeenCalled();
  });

  it("returns ok:false when exec throws (e.g. container died mid-push)", async () => {
    const { sandbox, writeFile, exec } = makeSandboxMock();
    writeFile.mockResolvedValue({ success: true });
    exec.mockRejectedValue(new Error("container EPIPE"));
    const result = await commitAndPushInSandbox(sandbox, goodCommit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/EPIPE/);
  });
});
