/**
 * Tests for `worker/sandbox-preview-build.ts` (issue #270 / PRD #178).
 *
 * The builder composes a long chain of collaborators (Sandbox exec,
 * GitHub clone, Artifacts clone, R2 upload). We mock every one of
 * them and assert on the orchestrator-level contract:
 *
 *   - Sequencing: source clone → artifacts clone → overlay → install
 *     → build → read dist → upload.
 *   - Each failure mode short-circuits and returns the right `phase`.
 *   - The built bundle base path contains `/preview/<previewId>/<sha>/`
 *     so the eventual route serves correctly.
 *   - Uploaded object keys use the `preview-bundles/<previewId>/<sha>/`
 *     shape (i.e. delegate to #269's `previewBundleObjectKey`).
 *   - The user email never appears in the preview URL or any upload
 *     key — only the opaque `previewId` is exposed.
 *   - The token used to clone the Artifacts repo is never exposed
 *     in any returned error string (defence-in-depth: a leaked
 *     token in a stderr that gets propagated to a UI would be bad).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

const {
  getDraftRepoMock,
  mintWriteTokenMock,
  buildAuthenticatedRemoteUrlMock,
  buildArtifactsRemoteUrlMock,
  stripExpiresSuffixMock,
} = vi.hoisted(() => ({
  getDraftRepoMock: vi.fn(),
  mintWriteTokenMock: vi.fn(),
  buildAuthenticatedRemoteUrlMock: vi.fn(
    (remote: string, token: string) => `https://x:${token}@${remote.replace(/^https:\/\//, "")}`,
  ),
  buildArtifactsRemoteUrlMock: vi.fn(
    (opts: { accountId: string; repoName: string }) =>
      `https://${opts.accountId}.artifacts.cloudflare.net/git/slide-of-hand-drafts/${opts.repoName}.git`,
  ),
  stripExpiresSuffixMock: vi.fn((t: string) => t.replace(/\?expires=.*$/, "")),
}));
vi.mock("./artifacts-client", () => ({
  getDraftRepo: getDraftRepoMock,
  mintWriteToken: mintWriteTokenMock,
  buildAuthenticatedRemoteUrl: buildAuthenticatedRemoteUrlMock,
  buildArtifactsRemoteUrl: buildArtifactsRemoteUrlMock,
  stripExpiresSuffix: stripExpiresSuffixMock,
}));

const { cloneArtifactsRepoIntoSandboxMock } = vi.hoisted(() => ({
  cloneArtifactsRepoIntoSandboxMock: vi.fn(),
}));
vi.mock("./sandbox-artifacts", () => ({
  cloneArtifactsRepoIntoSandbox: cloneArtifactsRepoIntoSandboxMock,
}));

const { cloneRepoIntoSandboxMock } = vi.hoisted(() => ({
  cloneRepoIntoSandboxMock: vi.fn(),
}));
vi.mock("./sandbox-source-edit", async () => {
  const actual =
    await vi.importActual<typeof import("./sandbox-source-edit")>(
      "./sandbox-source-edit",
    );
  return {
    ...actual,
    cloneRepoIntoSandbox: cloneRepoIntoSandboxMock,
  };
});

const { getStoredGitHubTokenMock } = vi.hoisted(() => ({
  getStoredGitHubTokenMock: vi.fn(),
}));
vi.mock("./github-oauth", () => ({
  getStoredGitHubToken: getStoredGitHubTokenMock,
}));

const { getSandboxMock } = vi.hoisted(() => ({
  getSandboxMock: vi.fn(),
}));
vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: getSandboxMock,
}));

const { putPreviewBundleObjectMock, previewBundleObjectKeyMock } = vi.hoisted(() => ({
  putPreviewBundleObjectMock: vi.fn(),
  previewBundleObjectKeyMock: vi.fn(),
}));
vi.mock("./preview-bundles", async () => {
  const actual =
    await vi.importActual<typeof import("./preview-bundles")>(
      "./preview-bundles",
    );
  return {
    ...actual,
    putPreviewBundleObject: putPreviewBundleObjectMock,
    // Pass-through to the real helper so we can assert on the key
    // shape the builder ends up generating.
    previewBundleObjectKey: (input: {
      previewId: string;
      sha: string;
      path: string;
    }) => {
      previewBundleObjectKeyMock(input);
      return actual.previewBundleObjectKey(input);
    },
  };
});

import { runBuildDraftPreview } from "./sandbox-preview-build";
import type {
  BuildDraftPreviewEnv,
  BuildDraftPreviewFailurePhase,
} from "./sandbox-preview-build";

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_ACCOUNT_ID = "test-account-id-32chars-of-hex00";
const TEST_PREVIEW_ID = "pv_0123456789abcdef";
const TEST_SHA = "abc1234567890abcdef1234567890abcdef12345";
const TEST_DRAFT_REPO = "alice-example-com-mydeck";
const TEST_SLUG = "mydeck";
const TEST_USER_EMAIL = "alice@example.com";

type ExecResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

interface SandboxStub {
  exec: ReturnType<
    typeof vi.fn<
      (cmd: string, opts?: { cwd?: string; env?: Record<string, string> }) => Promise<ExecResult>
    >
  >;
  writeFile: ReturnType<typeof vi.fn<(path: string, content: string) => Promise<void>>>;
  mkdir: ReturnType<typeof vi.fn<(path: string, opts?: { recursive?: boolean }) => Promise<void>>>;
}

function makeSandboxStub(): SandboxStub {
  return {
    exec: vi.fn(
      async (
        _cmd: string,
        _opts?: { cwd?: string; env?: Record<string, string> },
      ): Promise<ExecResult> => ({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
    ),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
  };
}

function makeEnv(): BuildDraftPreviewEnv {
  return {
    Sandbox: {} as unknown as BuildDraftPreviewEnv["Sandbox"],
    ARTIFACTS: { get: vi.fn() } as unknown as Artifacts,
    PREVIEW_BUNDLES: {
      // The builder doesn't call the bucket directly — it delegates
      // through `putPreviewBundleObject`. The mock object is enough
      // to satisfy the type.
    } as unknown as R2Bucket,
    GITHUB_TOKENS: {} as KVNamespace,
    CF_ACCOUNT_ID: TEST_ACCOUNT_ID,
  };
}

const happyPathInput = () => ({
  userEmail: TEST_USER_EMAIL,
  slug: TEST_SLUG,
  draftRepoName: TEST_DRAFT_REPO,
  commitSha: TEST_SHA,
  previewId: TEST_PREVIEW_ID,
});

/**
 * Default exec impl: every `test -d` against the deck folder succeeds
 * (the overlay-source check); the "read dist tree" exec returns a
 * canned manifest with two files; every other exec returns success.
 */
function setHappyPathExec(sandbox: SandboxStub) {
  sandbox.exec.mockImplementation(
    async (cmd: string, _opts?: { cwd?: string; env?: Record<string, string> }) => {
      if (cmd.startsWith("test -d ") && cmd.includes("/src/decks/public/")) {
        return { success: true, exitCode: 0, stdout: "", stderr: "" };
      }
      if (cmd.startsWith("bash /tmp/preview-read-dist.sh")) {
        // Emit two files in the documented manifest format.
        // Format (per file):
        //   ==== PREVIEW_FILE: <path> SIZE: <bytes> ====
        //   <base64-encoded bytes>
        //   ==== PREVIEW_FILE_END ====
        const html = Buffer.from("<!doctype html><html></html>").toString(
          "base64",
        );
        const js = Buffer.from("console.log('preview');").toString("base64");
        const stdout =
          `==== PREVIEW_FILE: index.html SIZE: 27 ====\n${html}\n==== PREVIEW_FILE_END ====\n` +
          `==== PREVIEW_FILE: assets/index-Abc12345.js SIZE: 23 ====\n${js}\n==== PREVIEW_FILE_END ====\n`;
        return { success: true, exitCode: 0, stdout, stderr: "" };
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    },
  );
}

function setHappyPathMocks(): SandboxStub {
  getStoredGitHubTokenMock.mockResolvedValue({
    token: "ghu_xxx",
    username: "alice-gh",
    userId: 1,
    scopes: ["public_repo"],
    connectedAt: 0,
  });
  cloneRepoIntoSandboxMock.mockResolvedValue({
    ok: true,
    workdir: "/workspace/source",
    ref: "main",
  });
  cloneArtifactsRepoIntoSandboxMock.mockResolvedValue({
    ok: true,
    workdir: "/workspace/draft",
    ref: "main",
  });
  getDraftRepoMock.mockResolvedValue({
    name: TEST_DRAFT_REPO,
    id: "repo-id",
    description: null,
    defaultBranch: "main",
    remote: "ignored",
    createToken: vi.fn(),
  });
  mintWriteTokenMock.mockResolvedValue({
    plaintext: "art_v1_DEADBEEF?expires=99999",
    expiresAt: new Date(Date.now() + 60_000),
  });
  putPreviewBundleObjectMock.mockResolvedValue(undefined);
  const sandbox = makeSandboxStub();
  setHappyPathExec(sandbox);
  return sandbox;
}

beforeEach(() => {
  cloneRepoIntoSandboxMock.mockReset();
  cloneArtifactsRepoIntoSandboxMock.mockReset();
  getStoredGitHubTokenMock.mockReset();
  getDraftRepoMock.mockReset();
  mintWriteTokenMock.mockReset();
  putPreviewBundleObjectMock.mockReset();
  previewBundleObjectKeyMock.mockReset();
});

// ── Happy path ───────────────────────────────────────────────────────

describe("runBuildDraftPreview — happy path", () => {
  it("composes source-clone → artifacts-clone → overlay → install → build → upload and returns the preview URL", async () => {
    const sandbox = setHappyPathMocks();
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previewUrl).toBe(
        `/preview/${TEST_PREVIEW_ID}/${TEST_SHA}/index.html`,
      );
      // The user email NEVER appears in the URL.
      expect(result.previewUrl).not.toContain(TEST_USER_EMAIL);
      expect(result.previewUrl).not.toContain("alice");
      // Two files were uploaded.
      expect(result.uploadedFiles).toBe(2);
    }
    expect(cloneRepoIntoSandboxMock).toHaveBeenCalledTimes(1);
    expect(cloneArtifactsRepoIntoSandboxMock).toHaveBeenCalledTimes(1);
    expect(putPreviewBundleObjectMock).toHaveBeenCalledTimes(2);
  });

  it("passes the vite --base flag with /preview/<previewId>/<sha>/", async () => {
    const sandbox = setHappyPathMocks();
    await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );

    const buildCall = sandbox.exec.mock.calls.find(
      (c) => /vite\s+build/.test(String(c[0])),
    );
    expect(buildCall, "expected at least one `vite build` exec").toBeDefined();
    if (buildCall) {
      const [cmd] = buildCall;
      expect(cmd).toContain(
        `--base=/preview/${TEST_PREVIEW_ID}/${TEST_SHA}/`,
      );
    }
  });

  it("runs an npm install/ci step in the source workdir before vite build", async () => {
    const sandbox = setHappyPathMocks();
    await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );

    const calls = sandbox.exec.mock.calls.map(([cmd, opts]) => ({
      cmd: String(cmd),
      opts,
    }));
    const installIdx = calls.findIndex((c) => /^npm (ci|install)\b/.test(c.cmd));
    const buildIdx = calls.findIndex((c) => /vite\s+build/.test(c.cmd));
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThan(installIdx);
    // Both run in the source workdir.
    expect(calls[installIdx].opts?.cwd).toBe("/workspace/source");
    expect(calls[buildIdx].opts?.cwd).toBe("/workspace/source");
  });

  it("overlays the draft deck folder onto the source checkout (cp -r from draft to source)", async () => {
    const sandbox = setHappyPathMocks();
    await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );

    const calls = sandbox.exec.mock.calls.map((c) => String(c[0]));
    const overlay = calls.find(
      (c) => c.includes("cp -r") && c.includes(`/${TEST_SLUG}`),
    );
    expect(overlay, "expected an overlay cp command").toBeDefined();
    if (overlay) {
      expect(overlay).toContain("/workspace/draft/src/decks/public/");
      expect(overlay).toContain("/workspace/source/src/decks/public");
    }
  });

  it("uploads each dist/ file under the #269 key shape and never includes the user email in any key", async () => {
    const sandbox = setHappyPathMocks();
    await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );

    const keyInputs = previewBundleObjectKeyMock.mock.calls.map((c) => c[0]) as Array<{
      previewId: string;
      sha: string;
      path: string;
    }>;
    expect(keyInputs.length).toBe(2);
    for (const input of keyInputs) {
      expect(input.previewId).toBe(TEST_PREVIEW_ID);
      expect(input.sha).toBe(TEST_SHA);
      expect(input.path).not.toContain(TEST_USER_EMAIL);
      expect(input.path).not.toMatch(/alice/);
    }
    // Verify the uploaded paths are what the manifest emitted.
    const uploadedPaths = putPreviewBundleObjectMock.mock.calls.map(
      (c) => (c[1] as { path: string }).path,
    );
    expect(uploadedPaths).toContain("index.html");
    expect(uploadedPaths).toContain("assets/index-Abc12345.js");
  });

  it("checks out the requested commit sha in the draft repo after cloning", async () => {
    const sandbox = setHappyPathMocks();
    await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    const calls = sandbox.exec.mock.calls.map((c) => ({
      cmd: String(c[0]),
      opts: c[1],
    }));
    const checkout = calls.find(
      (c) => c.cmd.includes("git") && c.cmd.includes("checkout") && c.cmd.includes(TEST_SHA),
    );
    expect(checkout, "expected git checkout of commitSha in draft workdir").toBeDefined();
    if (checkout) {
      // Operates inside the draft workdir.
      expect(checkout.cmd).toContain("/workspace/draft");
    }
  });
});

// ── Failure phases ───────────────────────────────────────────────────

describe("runBuildDraftPreview — failure phases", () => {
  it("returns phase=source_clone when GitHub clone fails", async () => {
    const sandbox = setHappyPathMocks();
    cloneRepoIntoSandboxMock.mockResolvedValue({
      ok: false,
      error: "git clone failed (exit 128)",
    });
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const phase: BuildDraftPreviewFailurePhase = result.phase;
      expect(phase).toBe("source_clone");
    }
  });

  it("returns phase=artifacts_clone when Artifacts clone fails", async () => {
    const sandbox = setHappyPathMocks();
    cloneArtifactsRepoIntoSandboxMock.mockResolvedValue({
      ok: false,
      error: "git clone failed (some artifacts error)",
    });
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("artifacts_clone");
  });

  it("returns phase=overlay when the draft deck folder is missing", async () => {
    const sandbox = setHappyPathMocks();
    // Override so the deck-folder existence probe fails.
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("test -d ") && cmd.includes(`/${TEST_SLUG}`)) {
        return { success: false, exitCode: 1, stdout: "", stderr: "" };
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    });
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("overlay");
  });

  it("returns phase=install when npm install fails", async () => {
    const sandbox = setHappyPathMocks();
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (/^npm (ci|install)\b/.test(cmd)) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "ENOENT lockfile",
        };
      }
      if (cmd.startsWith("test -d ")) {
        return { success: true, exitCode: 0, stdout: "", stderr: "" };
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    });
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("install");
  });

  it("returns phase=build when vite build fails", async () => {
    const sandbox = setHappyPathMocks();
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (/vite\s+build/.test(cmd)) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "Build failed",
        };
      }
      if (cmd.startsWith("test -d ")) {
        return { success: true, exitCode: 0, stdout: "", stderr: "" };
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    });
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("build");
  });

  it("returns phase=upload when an R2 put fails", async () => {
    const sandbox = setHappyPathMocks();
    putPreviewBundleObjectMock.mockRejectedValueOnce(
      new Error("R2 PUT timeout"),
    );
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("upload");
  });

  it("returns phase=upload when the dist read step produces no files", async () => {
    const sandbox = setHappyPathMocks();
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("bash /tmp/preview-read-dist.sh")) {
        // Empty stdout — no files emitted by the manifest script.
        return { success: true, exitCode: 0, stdout: "", stderr: "" };
      }
      if (cmd.startsWith("test -d ")) {
        return { success: true, exitCode: 0, stdout: "", stderr: "" };
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    });
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("upload");
  });

  it("returns phase=source_clone when GitHub OAuth token is missing", async () => {
    const sandbox = setHappyPathMocks();
    getStoredGitHubTokenMock.mockResolvedValue(null);
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("source_clone");
  });
});

// ── Privacy ──────────────────────────────────────────────────────────

describe("runBuildDraftPreview — privacy", () => {
  it("does not include the Artifacts token in any returned error string", async () => {
    const sandbox = setHappyPathMocks();
    // Pretend the artifacts clone surfaces an error that *contained*
    // the token string. The builder must redact / not propagate it.
    cloneArtifactsRepoIntoSandboxMock.mockResolvedValue({
      ok: false,
      // Realistic-ish: a git error that included the URL with the
      // bare token. The builder strips this; our public error must
      // not echo the secret.
      error:
        "git clone failed (fatal: cannot connect to https://x:art_v1_DEADBEEF@artifacts.example/x.git)",
    });
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("artifacts_clone");
      expect(result.error).not.toContain("art_v1_DEADBEEF");
    }
  });

  it("does not include the user email or draft repo name in the returned previewUrl", async () => {
    const sandbox = setHappyPathMocks();
    const result = await runBuildDraftPreview(
      makeEnv(),
      happyPathInput(),
      () => sandbox as never,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previewUrl).not.toContain(TEST_USER_EMAIL);
      expect(result.previewUrl).not.toContain(TEST_DRAFT_REPO);
      expect(result.previewUrl).not.toContain("@");
    }
  });
});
