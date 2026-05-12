/**
 * Tests for `worker/sandbox-deck-creation.ts` (issue #168 Wave 1 /
 * Worker A).
 *
 * Mocks every downstream collaborator (`artifacts-client`,
 * `sandbox-artifacts`, `sandbox-source-edit`, `ai-deck-gen`) so the
 * orchestrators can be exercised in isolation. The chain is long
 * enough that the value of the test is verifying the orchestrator
 * SEQUENCES + handles each step's failure mode — not exercising the
 * collaborators themselves (each has its own unit tests).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

const {
  forkDeckStarterIdempotentMock,
  getDraftRepoMock,
  mintWriteTokenMock,
  buildAuthenticatedRemoteUrlMock,
  draftRepoNameMock,
  stripExpiresSuffixMock,
} = vi.hoisted(() => ({
  forkDeckStarterIdempotentMock: vi.fn(),
  getDraftRepoMock: vi.fn(),
  mintWriteTokenMock: vi.fn(),
  buildAuthenticatedRemoteUrlMock: vi.fn(
    (remote: string, token: string) => `https://x:${token}@${remote}`,
  ),
  draftRepoNameMock: vi.fn(
    (email: string, slug: string) =>
      `${email.replace(/[^a-z0-9-]/g, "-")}-${slug}`,
  ),
  stripExpiresSuffixMock: vi.fn((t: string) => t.replace(/\?expires=.*$/, "")),
}));
vi.mock("./artifacts-client", () => ({
  forkDeckStarterIdempotent: forkDeckStarterIdempotentMock,
  getDraftRepo: getDraftRepoMock,
  mintWriteToken: mintWriteTokenMock,
  buildAuthenticatedRemoteUrl: buildAuthenticatedRemoteUrlMock,
  draftRepoName: draftRepoNameMock,
  stripExpiresSuffix: stripExpiresSuffixMock,
}));

const { cloneArtifactsRepoIntoSandboxMock, commitAndPushToArtifactsInSandboxMock } =
  vi.hoisted(() => ({
    cloneArtifactsRepoIntoSandboxMock: vi.fn(),
    commitAndPushToArtifactsInSandboxMock: vi.fn(),
  }));
vi.mock("./sandbox-artifacts", () => ({
  cloneArtifactsRepoIntoSandbox: cloneArtifactsRepoIntoSandboxMock,
  commitAndPushToArtifactsInSandbox: commitAndPushToArtifactsInSandboxMock,
}));

const { applyFilesIntoSandboxMock } = vi.hoisted(() => ({
  applyFilesIntoSandboxMock: vi.fn(),
}));
vi.mock("./sandbox-source-edit", () => ({
  applyFilesIntoSandbox: applyFilesIntoSandboxMock,
}));

const { generateDeckFilesMock } = vi.hoisted(() => ({
  generateDeckFilesMock: vi.fn(),
}));
vi.mock("./ai-deck-gen", () => ({
  generateDeckFiles: generateDeckFilesMock,
}));

const { getSandboxMock } = vi.hoisted(() => ({
  getSandboxMock: vi.fn(),
}));
vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: getSandboxMock,
}));

import {
  runCreateDeckDraft,
  runIterateOnDeckDraft,
  runPublishDraft,
  type SandboxDeckCreationEnv,
} from "./sandbox-deck-creation";

// ── Helpers ──────────────────────────────────────────────────────────

function makeEnv(): SandboxDeckCreationEnv {
  return {
    Sandbox: {} as unknown as SandboxDeckCreationEnv["Sandbox"],
    ARTIFACTS: {} as unknown as Artifacts,
    AI: {} as unknown as Ai,
  };
}

function setHappyPathMocks() {
  forkDeckStarterIdempotentMock.mockResolvedValue({
    kind: "created",
    result: {
      remote:
        "https://1bcef46c.artifacts.cloudflare.net/git/slide-of-hand-drafts/alice-my.git",
      token: "art_v1_xxxx?expires=999",
      defaultBranch: "main",
      name: "alice-example-com-my",
      id: "repo-id",
      description: null,
    },
  });
  cloneArtifactsRepoIntoSandboxMock.mockResolvedValue({
    ok: true,
    workdir: "/workspace/repo",
    ref: "main",
  });
  generateDeckFilesMock.mockResolvedValue({
    ok: true,
    files: [
      { path: "src/decks/public/my/meta.ts", content: "..." },
      { path: "src/decks/public/my/index.tsx", content: "..." },
      { path: "src/decks/public/my/01-title.tsx", content: "..." },
    ],
    commitMessage: "Initial deck",
  });
  applyFilesIntoSandboxMock.mockResolvedValue({
    ok: true,
    paths: [
      "src/decks/public/my/meta.ts",
      "src/decks/public/my/index.tsx",
      "src/decks/public/my/01-title.tsx",
    ],
  });
  commitAndPushToArtifactsInSandboxMock.mockResolvedValue({
    ok: true,
    sha: "abc1234567890abcdef1234567890abcdef12345",
    branch: "main",
    promptNotePushed: true,
  });
  getSandboxMock.mockReturnValue({} as unknown as ReturnType<typeof getSandboxMock>);
}

beforeEach(() => {
  forkDeckStarterIdempotentMock.mockReset();
  getDraftRepoMock.mockReset();
  mintWriteTokenMock.mockReset();
  cloneArtifactsRepoIntoSandboxMock.mockReset();
  commitAndPushToArtifactsInSandboxMock.mockReset();
  applyFilesIntoSandboxMock.mockReset();
  generateDeckFilesMock.mockReset();
  getSandboxMock.mockReset();
});

// ── runCreateDeckDraft ───────────────────────────────────────────────

describe("runCreateDeckDraft — validation", () => {
  it("rejects missing user email with validation phase", async () => {
    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "  ",
      slug: "x",
      prompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("validation");
  });

  it("rejects missing slug with validation phase", async () => {
    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "x@y",
      slug: "",
      prompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("validation");
  });

  it("rejects missing prompt with validation phase", async () => {
    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "x@y",
      slug: "x",
      prompt: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("validation");
  });
});

describe("runCreateDeckDraft — happy path", () => {
  beforeEach(() => setHappyPathMocks());

  it("composes fork → clone → AI gen → apply → commit + push and returns success", async () => {
    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
      prompt: "build a deck about CRDTs",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commitSha).toBe(
        "abc1234567890abcdef1234567890abcdef12345",
      );
      expect(result.branch).toBe("main");
      expect(result.fileCount).toBe(3);
      expect(result.commitMessage).toBe("Initial deck");
      expect(result.promptNotePushed).toBe(true);
    }

    // Verify the chain was called in order with the right args.
    expect(forkDeckStarterIdempotentMock).toHaveBeenCalledWith(
      expect.anything(),
      "alice@example.com",
      "my",
    );
    expect(cloneArtifactsRepoIntoSandboxMock).toHaveBeenCalledTimes(1);
    expect(generateDeckFilesMock).toHaveBeenCalledTimes(1);
    expect(applyFilesIntoSandboxMock).toHaveBeenCalledTimes(1);
    expect(commitAndPushToArtifactsInSandboxMock).toHaveBeenCalledTimes(1);
  });

  it("uses the existing fork token when fork is idempotent (kind=existed)", async () => {
    forkDeckStarterIdempotentMock.mockResolvedValueOnce({
      kind: "existed",
      repo: {
        remote:
          "https://1bcef46c.artifacts.cloudflare.net/git/slide-of-hand-drafts/alice-my.git",
        name: "alice-example-com-my",
        id: "id",
        description: null,
        defaultBranch: "main",
      },
      freshWriteToken: {
        plaintext: "art_v1_fresh?expires=999",
        expiresAt: "2027-01-15T00:00:00Z",
      },
    });

    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
      prompt: "iterate",
    });

    expect(result.ok).toBe(true);
    // Confirm the fresh token was used to build the URL.
    expect(buildAuthenticatedRemoteUrlMock).toHaveBeenCalledWith(
      expect.stringContaining("artifacts.cloudflare.net"),
      "art_v1_fresh?expires=999",
    );
  });

  it("forwards a model override into the AI gen call", async () => {
    await runCreateDeckDraft(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
      prompt: "x",
      modelId: "@cf/meta/llama-4-scout-17b-16e-instruct",
    });
    const [, , options] = generateDeckFilesMock.mock.calls[0];
    expect(options.modelId).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
  });

  it("attaches the prompt as a git note", async () => {
    await runCreateDeckDraft(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
      prompt: "build a deck",
    });
    const [, opts] = commitAndPushToArtifactsInSandboxMock.mock.calls[0];
    expect(opts.promptNote).toMatch(/prompt: build a deck/);
  });
});

describe("runCreateDeckDraft — failure modes", () => {
  beforeEach(() => setHappyPathMocks());

  it("returns phase:fork when fork throws", async () => {
    forkDeckStarterIdempotentMock.mockRejectedValueOnce(
      new Error("artifacts down"),
    );
    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "x@y",
      slug: "x",
      prompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("fork");
      expect(result.error).toMatch(/artifacts down/);
    }
  });

  it("returns phase:clone when clone fails", async () => {
    cloneArtifactsRepoIntoSandboxMock.mockResolvedValueOnce({
      ok: false,
      error: "auth failed",
    });
    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "x@y",
      slug: "x",
      prompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("clone");
      expect(result.error).toMatch(/auth failed/);
    }
  });

  it("returns phase:ai_generation with subphase when AI gen fails", async () => {
    generateDeckFilesMock.mockResolvedValueOnce({
      ok: false,
      phase: "path_violation",
      error: "tried to write package.json",
    });
    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "x@y",
      slug: "x",
      prompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("ai_generation");
      expect(result.aiGenPhase).toBe("path_violation");
    }
  });

  it("returns phase:apply_files when applyFiles fails", async () => {
    applyFilesIntoSandboxMock.mockResolvedValueOnce({
      ok: false,
      error: "disk full",
      failedPath: "src/decks/public/x/meta.ts",
    });
    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "x@y",
      slug: "x",
      prompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("apply_files");
      expect(result.error).toMatch(/disk full/);
    }
  });

  it("returns phase:commit_push when commit fails", async () => {
    commitAndPushToArtifactsInSandboxMock.mockResolvedValueOnce({
      ok: false,
      error: "push rejected",
    });
    const result = await runCreateDeckDraft(makeEnv(), {
      userEmail: "x@y",
      slug: "x",
      prompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("commit_push");
      expect(result.error).toMatch(/push rejected/);
    }
  });
});

// ── runIterateOnDeckDraft ────────────────────────────────────────────

function setIterateHappyPathMocks() {
  const repo = {
    remote:
      "https://1bcef46c.artifacts.cloudflare.net/git/slide-of-hand-drafts/alice-my.git",
    name: "alice-example-com-my",
    id: "id",
    description: null,
    defaultBranch: "main",
  };
  getDraftRepoMock.mockResolvedValue(repo);
  mintWriteTokenMock.mockResolvedValue({
    plaintext: "art_v1_fresh?expires=999",
    expiresAt: "2027-01-15T00:00:00Z",
  });
  cloneArtifactsRepoIntoSandboxMock.mockResolvedValue({
    ok: true,
    workdir: "/workspace/repo",
    ref: "main",
  });
  // Mock for the file-read helper (one exec call inside the iterate
  // orchestrator). We mock at the sandbox level.
  getSandboxMock.mockReturnValue({
    exec: vi.fn().mockResolvedValue({
      success: true,
      stdout:
        "==== FILE: src/decks/public/my/meta.ts ====\n" +
        "export const meta = { ... };\n" +
        "==== FILE: src/decks/public/my/01-title.tsx ====\n" +
        "export const titleSlide = { ... };\n",
      stderr: "",
      exitCode: 0,
    }),
  } as unknown as ReturnType<typeof getSandboxMock>);
  generateDeckFilesMock.mockResolvedValue({
    ok: true,
    files: [
      {
        path: "src/decks/public/my/01-title.tsx",
        content: "modified",
      },
    ],
    commitMessage: "Iterate title slide",
  });
  applyFilesIntoSandboxMock.mockResolvedValue({
    ok: true,
    paths: ["src/decks/public/my/01-title.tsx"],
  });
  commitAndPushToArtifactsInSandboxMock.mockResolvedValue({
    ok: true,
    sha: "def1234567890abcdef1234567890abcdef12345",
    branch: "main",
    promptNotePushed: true,
  });
}

describe("runIterateOnDeckDraft — happy path", () => {
  beforeEach(() => setIterateHappyPathMocks());

  it("reads existing files + passes them as context to AI gen", async () => {
    await runIterateOnDeckDraft(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
      prompt: "change the title",
    });

    const [, input] = generateDeckFilesMock.mock.calls[0];
    expect(input.existingFiles).toBeDefined();
    expect(input.existingFiles.length).toBeGreaterThan(0);
    expect(input.existingFiles[0].path).toMatch(/src\/decks\/public\/my\//);
  });

  it("forwards pinned elements to AI gen", async () => {
    await runIterateOnDeckDraft(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
      prompt: "make this orange",
      pinnedElements: [
        {
          file: "src/decks/public/my/01-title.tsx",
          lineStart: 5,
          lineEnd: 9,
          htmlExcerpt: "<h1>Title</h1>",
        },
      ],
    });

    const [, input] = generateDeckFilesMock.mock.calls[0];
    expect(input.pinnedElements).toHaveLength(1);
    expect(input.pinnedElements[0].file).toBe(
      "src/decks/public/my/01-title.tsx",
    );
  });

  it("returns success result with the new SHA", async () => {
    const result = await runIterateOnDeckDraft(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
      prompt: "iter",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commitSha).toBe(
        "def1234567890abcdef1234567890abcdef12345",
      );
    }
  });
});

describe("runIterateOnDeckDraft — failure modes", () => {
  it("returns phase:fork when the draft doesn't exist", async () => {
    getDraftRepoMock.mockRejectedValueOnce(new Error("not found"));
    const result = await runIterateOnDeckDraft(makeEnv(), {
      userEmail: "x@y",
      slug: "x",
      prompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("fork");
      expect(result.error).toMatch(/Draft not found/);
    }
  });
});

// ── runPublishDraft (still stubbed) ──────────────────────────────────

describe("runPublishDraft", () => {
  it("returns phase:not_implemented", async () => {
    const result = await runPublishDraft(makeEnv(), {
      userEmail: "x@y",
      slug: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("not_implemented");
  });
});
