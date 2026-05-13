/**
 * Tests for `worker/sandbox-artifacts.ts` (issue #168 Wave 1 / Worker A).
 *
 * Pure unit coverage of the clone + commit/push helpers. The Sandbox
 * surface is narrowed to `SandboxLike` (re-used from
 * `worker/sandbox-source-edit.ts`) and mocked via `vi.fn()` shapes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  cloneArtifactsRepoIntoSandbox,
  commitAndPushToArtifactsInSandbox,
} from "./sandbox-artifacts";
import type { SandboxLike } from "./sandbox-source-edit";

function makeSandboxStub(overrides: Partial<SandboxLike> = {}): SandboxLike {
  const notStubbed = (m: string) => () => {
    throw new Error(`SandboxLike.${m} not stubbed`);
  };
  return {
    gitCheckout: vi.fn(notStubbed("gitCheckout")),
    exec: vi.fn(notStubbed("exec")),
    writeFile: vi.fn(notStubbed("writeFile")),
    mkdir: vi.fn(notStubbed("mkdir")),
    ...overrides,
  } as unknown as SandboxLike;
}

const FAKE_URL =
  "https://x:art_v1_xxxx@1bcef46c.artifacts.cloudflare.net/git/slide-of-hand-drafts/alice-my.git";

describe("cloneArtifactsRepoIntoSandbox", () => {
  it("issues raw `git clone` + `git checkout -B main` (no -b on clone — unborn-branch safe)", async () => {
    // Both exec calls succeed: clone produces an empty (or
    // non-empty) working tree; checkout force-creates/resets main.
    const execMock = vi.fn().mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const sandbox = makeSandboxStub({
      exec: execMock as SandboxLike["exec"],
    });

    const result = await cloneArtifactsRepoIntoSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workdir).toBe("/workspace/repo");
      expect(result.ref).toBe("main");
    }
    expect(execMock).toHaveBeenCalledTimes(2);
    // First call: clone. Critically, NO `-b <ref>` — that's the
    // whole point of the post-#182 fix.
    const cloneCall = execMock.mock.calls[0][0] as string;
    expect(cloneCall).toContain(`git clone "${FAKE_URL}" "/workspace/repo"`);
    expect(cloneCall).not.toMatch(/-b\s/);
    // Second call: ensure local main branch.
    const checkoutCall = execMock.mock.calls[1][0] as string;
    expect(checkoutCall).toBe(
      `git -C "/workspace/repo" checkout -B "main"`,
    );
  });

  it("honours custom workdir + ref", async () => {
    const execMock = vi.fn().mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const sandbox = makeSandboxStub({
      exec: execMock as SandboxLike["exec"],
    });

    await cloneArtifactsRepoIntoSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
      workdir: "/tmp/foo",
      ref: "feature",
    });
    const cloneCall = execMock.mock.calls[0][0] as string;
    expect(cloneCall).toBe(`git clone "${FAKE_URL}" "/tmp/foo"`);
    const checkoutCall = execMock.mock.calls[1][0] as string;
    expect(checkoutCall).toBe(`git -C "/tmp/foo" checkout -B "feature"`);
  });

  it("succeeds on an empty/unborn-branch remote (the bug this fix targets)", async () => {
    // Plain `git clone` on an empty remote prints the empty-repo
    // warning to stderr but exits 0. The subsequent `git checkout -B
    // main` force-creates the local branch since `main` is unborn
    // locally too. Both should be treated as success.
    const execMock = vi.fn().mockImplementation(async (cmd: string) => ({
      success: true,
      stdout: "",
      stderr: cmd.includes("clone")
        ? "warning: You appear to have cloned an empty repository.\n"
        : "Switched to a new branch 'main'\n",
      exitCode: 0,
    }));
    const sandbox = makeSandboxStub({
      exec: execMock as SandboxLike["exec"],
    });

    const result = await cloneArtifactsRepoIntoSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ref).toBe("main");
    }
  });

  it("returns an error when `git clone` fails (e.g. auth)", async () => {
    const execMock = vi.fn().mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "fatal: authentication failed",
      exitCode: 128,
    });
    const sandbox = makeSandboxStub({
      exec: execMock as SandboxLike["exec"],
    });

    const result = await cloneArtifactsRepoIntoSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/git clone failed/);
    }
    // Only the clone was attempted — we don't proceed to checkout
    // on a failed clone.
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("returns an error when `git checkout -B` fails", async () => {
    // Clone succeeded, but the checkout failed somehow (corrupt
    // working tree, fs error, etc.). Surface as a distinct error so
    // operators know which phase failed.
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        success: false,
        stdout: "",
        stderr: "fatal: invalid reference: main",
        exitCode: 128,
      });
    const sandbox = makeSandboxStub({
      exec: execMock as SandboxLike["exec"],
    });

    const result = await cloneArtifactsRepoIntoSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/git checkout -B main failed/);
    }
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("returns an error when exec throws", async () => {
    const sandbox = makeSandboxStub({
      exec: vi
        .fn()
        .mockRejectedValue(new Error("network down")) as SandboxLike["exec"],
    });

    const result = await cloneArtifactsRepoIntoSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/network down/);
  });
});

describe("commitAndPushToArtifactsInSandbox", () => {
  let execMock: ReturnType<typeof vi.fn>;
  let writeFileMock: ReturnType<typeof vi.fn>;
  let sandbox: SandboxLike;

  beforeEach(() => {
    execMock = vi.fn();
    writeFileMock = vi.fn().mockResolvedValue(undefined);
    sandbox = makeSandboxStub({
      exec: execMock as SandboxLike["exec"],
      writeFile: writeFileMock as SandboxLike["writeFile"],
    });
  });

  it("writes the commit script, invokes bash, returns the SHA on success", async () => {
    execMock.mockResolvedValueOnce({
      success: true,
      stdout:
        "[main 1234567] Initial commit\n" +
        "abc1234567890abcdef1234567890abcdef12345\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await commitAndPushToArtifactsInSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
      branchName: "main",
      commitMessage: "Initial commit",
      authorName: "Alice",
      authorEmail: "alice@example.com",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sha).toBe("abc1234567890abcdef1234567890abcdef12345");
      expect(result.branch).toBe("main");
    }
    expect(writeFileMock).toHaveBeenCalledWith(
      "/tmp/artifacts-commit.sh",
      expect.stringContaining("git -c protocol.version=1 push -u"),
    );
    const [, opts] = execMock.mock.calls[0];
    expect(opts.cwd).toBe("/workspace/repo");
    expect(opts.env.REMOTE_URL).toBe(FAKE_URL);
    expect(opts.env.GIT_AUTHOR_NAME).toBe("Alice");
    expect(opts.env.GIT_AUTHOR_EMAIL).toBe("alice@example.com");
  });

  it("forwards a promptNote and reports promptNotePushed=true on success", async () => {
    execMock.mockResolvedValueOnce({
      success: true,
      stdout: "abc1234567890abcdef1234567890abcdef12345\n",
      stderr: "NOTES_PUSHED\n",
      exitCode: 0,
    });
    const result = await commitAndPushToArtifactsInSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
      branchName: "main",
      commitMessage: "iter",
      authorName: "x",
      authorEmail: "x@example.com",
      promptNote: "user said: build a deck about X",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promptNotePushed).toBe(true);
    const [, opts] = execMock.mock.calls[0];
    expect(opts.env.PROMPT_NOTE).toBe("user said: build a deck about X");
  });

  it("reports promptNotePushed=false when the notes push fails", async () => {
    execMock.mockResolvedValueOnce({
      success: true,
      stdout: "abc1234567890abcdef1234567890abcdef12345\n",
      stderr: "NOTES_PUSH_FAILED\n",
      exitCode: 0,
    });
    const result = await commitAndPushToArtifactsInSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
      branchName: "main",
      commitMessage: "iter",
      authorName: "x",
      authorEmail: "x@example.com",
      promptNote: "prompt",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promptNotePushed).toBe(false);
  });

  it("returns noEffectiveChanges when nothing to commit", async () => {
    execMock.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "NO_EFFECTIVE_CHANGES\n",
      exitCode: 2,
    });

    const result = await commitAndPushToArtifactsInSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
      branchName: "main",
      commitMessage: "no changes",
      authorName: "x",
      authorEmail: "x@example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.noEffectiveChanges).toBe(true);
    }
  });

  it("returns error on non-zero non-NO_EFFECTIVE_CHANGES exit", async () => {
    execMock.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "fatal: authentication failed",
      exitCode: 128,
    });
    const result = await commitAndPushToArtifactsInSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
      branchName: "main",
      commitMessage: "x",
      authorName: "x",
      authorEmail: "x@example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Commit \/ push failed/);
      expect(result.stderr).toMatch(/authentication failed/);
    }
  });

  it("rejects empty branchName, commitMessage, authorName, authorEmail", async () => {
    const cases = [
      {
        branchName: "",
        commitMessage: "x",
        authorName: "x",
        authorEmail: "x@x",
      },
      {
        branchName: "x",
        commitMessage: "",
        authorName: "x",
        authorEmail: "x@x",
      },
      { branchName: "x", commitMessage: "x", authorName: "", authorEmail: "x@x" },
      { branchName: "x", commitMessage: "x", authorName: "x", authorEmail: "" },
    ];
    for (const c of cases) {
      const r = await commitAndPushToArtifactsInSandbox(sandbox, {
        authenticatedUrl: FAKE_URL,
        ...c,
      });
      expect(r.ok).toBe(false);
    }
  });

  it("returns error when bash throws", async () => {
    execMock.mockRejectedValueOnce(new Error("sandbox crash"));
    const result = await commitAndPushToArtifactsInSandbox(sandbox, {
      authenticatedUrl: FAKE_URL,
      branchName: "main",
      commitMessage: "x",
      authorName: "x",
      authorEmail: "x@example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sandbox crash/);
  });
});
