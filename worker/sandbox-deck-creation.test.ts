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

const { streamDeckFilesMock } = vi.hoisted(() => ({
  streamDeckFilesMock: vi.fn(),
}));
vi.mock("./ai-deck-gen", () => ({
  streamDeckFiles: streamDeckFilesMock,
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
  type DeckCreationSnapshot,
  type SandboxDeckCreationEnv,
} from "./sandbox-deck-creation";
import type { AiDeckGenResult, DeckGenPartial } from "./ai-deck-gen";

// ── Helpers ──────────────────────────────────────────────────────────

function makeEnv(): SandboxDeckCreationEnv {
  return {
    Sandbox: {} as unknown as SandboxDeckCreationEnv["Sandbox"],
    ARTIFACTS: {} as unknown as Artifacts,
    AI: {} as unknown as Ai,
  };
}

/**
 * Builds a fake `streamDeckFiles` return value: yields the given
 * partial deltas from `partials`, then resolves `result`. Default
 * partials = empty (no streaming visible) for tests that don't care
 * about the streaming surface.
 *
 * Mirrors the shape `streamDeckFiles` produces in `worker/ai-deck-gen.ts`.
 */
function fakeStreamDeckFiles(
  partials: DeckGenPartial[],
  result: AiDeckGenResult,
): { partials: AsyncIterable<DeckGenPartial>; result: Promise<AiDeckGenResult> } {
  return {
    partials: (async function* () {
      for (const p of partials) yield p;
    })(),
    result: Promise.resolve(result),
  };
}

/**
 * Drains an async generator: collects every yielded snapshot AND
 * returns the generator's final return value. Centralised here so
 * each test doesn't repeat the while/await/done dance.
 */
async function runGen<TYield, TReturn>(
  gen: AsyncGenerator<TYield, TReturn>,
): Promise<{ snapshots: TYield[]; result: TReturn }> {
  const snapshots: TYield[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = await gen.next();
    if (next.done) return { snapshots, result: next.value };
    snapshots.push(next.value);
  }
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
  streamDeckFilesMock.mockReturnValue(
    fakeStreamDeckFiles([], {
      ok: true,
      files: [
        { path: "src/decks/public/my/meta.ts", content: "..." },
        { path: "src/decks/public/my/index.tsx", content: "..." },
        { path: "src/decks/public/my/01-title.tsx", content: "..." },
      ],
      commitMessage: "Initial deck",
    }),
  );
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
  streamDeckFilesMock.mockReset();
  getSandboxMock.mockReset();
});

// ── runCreateDeckDraft ───────────────────────────────────────────────

describe("runCreateDeckDraft — validation", () => {
  it("rejects missing user email with validation phase", async () => {
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "  ",
        slug: "x",
        prompt: "x",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("validation");
  });

  it("rejects missing slug with validation phase", async () => {
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "x@y",
        slug: "",
        prompt: "x",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("validation");
  });

  it("rejects missing prompt with validation phase", async () => {
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "x@y",
        slug: "x",
        prompt: "",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("validation");
  });
});

describe("runCreateDeckDraft — happy path", () => {
  beforeEach(() => setHappyPathMocks());

  it("composes fork → clone → AI gen → apply → commit + push and returns success", async () => {
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "build a deck about CRDTs",
      }),
    );

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
    expect(streamDeckFilesMock).toHaveBeenCalledTimes(1);
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

    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "iterate",
      }),
    );

    expect(result.ok).toBe(true);
    // Confirm the fresh token was used to build the URL.
    expect(buildAuthenticatedRemoteUrlMock).toHaveBeenCalledWith(
      expect.stringContaining("artifacts.cloudflare.net"),
      "art_v1_fresh?expires=999",
    );
  });

  it("forwards a model override into the AI gen call", async () => {
    await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
        modelId: "@cf/meta/llama-4-scout-17b-16e-instruct",
      }),
    );
    const [, , options] = streamDeckFilesMock.mock.calls[0];
    expect(options.modelId).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
  });

  it("attaches the prompt as a git note", async () => {
    await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "build a deck",
      }),
    );
    const [, opts] = commitAndPushToArtifactsInSandboxMock.mock.calls[0];
    expect(opts.promptNote).toMatch(/prompt: build a deck/);
  });
});

describe("runCreateDeckDraft — yields", () => {
  beforeEach(() => setHappyPathMocks());

  it("yields phase snapshots in order: fork → clone → ai_gen → apply → commit → push → done", async () => {
    const { snapshots, result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );

    expect(result.ok).toBe(true);

    // Extract phase order, dropping duplicate consecutive phases (each
    // phase boundary yields once, but ai_gen can fan out into multiple
    // partial yields — we only assert "the phase shows up", not "exactly
    // once").
    const phases = snapshots.map((s) => s.phase);
    const order: DeckCreationSnapshot["phase"][] = [];
    for (const p of phases) {
      if (order[order.length - 1] !== p) order.push(p);
    }
    expect(order).toEqual([
      "fork",
      "clone",
      "ai_gen",
      "apply",
      "commit",
      "push",
      "done",
    ]);
  });

  it("forwards streamDeckFiles partials as ai_gen snapshots with file tree state", async () => {
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles(
        [
          {
            files: [
              {
                path: "src/decks/public/my/meta.ts",
                content: "export const",
                state: "writing",
              },
            ],
            currentFile: "src/decks/public/my/meta.ts",
          },
          {
            files: [
              {
                path: "src/decks/public/my/meta.ts",
                content: "export const meta = { slug: 'my' };",
                state: "done",
              },
              {
                path: "src/decks/public/my/index.tsx",
                content: "import",
                state: "writing",
              },
            ],
            currentFile: "src/decks/public/my/index.tsx",
          },
        ],
        {
          ok: true,
          files: [
            { path: "src/decks/public/my/meta.ts", content: "export const meta = { slug: 'my' };" },
            { path: "src/decks/public/my/index.tsx", content: "import ..." },
          ],
          commitMessage: "Initial",
        },
      ),
    );

    const { snapshots } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );

    const aiGenSnapshots = snapshots.filter((s) => s.phase === "ai_gen");
    // 1 boundary yield (empty files) + 2 partial yields.
    expect(aiGenSnapshots.length).toBeGreaterThanOrEqual(3);

    const lastAiGen = aiGenSnapshots[aiGenSnapshots.length - 1];
    expect(lastAiGen?.files).toHaveLength(2);
    expect(lastAiGen?.files[1]?.state).toBe("writing");
    expect(lastAiGen?.currentFile).toBe(
      "src/decks/public/my/index.tsx",
    );
  });

  it("yields a done snapshot carrying commitSha + draftId + commitMessage", async () => {
    const { snapshots } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );
    const done = snapshots[snapshots.length - 1];
    expect(done?.phase).toBe("done");
    expect(done?.commitSha).toBe(
      "abc1234567890abcdef1234567890abcdef12345",
    );
    expect(done?.draftId).toMatch(/-my$/);
    expect(done?.commitMessage).toBe("Initial deck");
    // All files in the final snapshot are marked done.
    expect(done?.files.every((f) => f.state === "done")).toBe(true);
  });

  it("yields an error snapshot on fork failure (before returning the DeckDraftError)", async () => {
    forkDeckStarterIdempotentMock.mockRejectedValueOnce(
      new Error("artifacts down"),
    );

    const { snapshots, result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("fork");

    // The last snapshot is the error one — UI uses it to surface the
    // banner with the failed-phase highlight.
    const last = snapshots[snapshots.length - 1];
    expect(last?.phase).toBe("error");
    expect(last?.error).toMatch(/artifacts down/);
  });
});

describe("runCreateDeckDraft — failure modes", () => {
  beforeEach(() => setHappyPathMocks());

  it("returns phase:fork when fork throws", async () => {
    forkDeckStarterIdempotentMock.mockRejectedValueOnce(
      new Error("artifacts down"),
    );
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "x@y",
        slug: "x",
        prompt: "x",
      }),
    );
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
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "x@y",
        slug: "x",
        prompt: "x",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("clone");
      expect(result.error).toMatch(/auth failed/);
    }
  });

  it("returns phase:ai_generation with subphase when AI gen fails", async () => {
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles([], {
        ok: false,
        phase: "path_violation",
        error: "tried to write package.json",
      }),
    );
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "x@y",
        slug: "x",
        prompt: "x",
      }),
    );
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
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "x@y",
        slug: "x",
        prompt: "x",
      }),
    );
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
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "x@y",
        slug: "x",
        prompt: "x",
      }),
    );
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
  streamDeckFilesMock.mockReturnValue(
    fakeStreamDeckFiles([], {
      ok: true,
      files: [
        {
          path: "src/decks/public/my/01-title.tsx",
          content: "modified",
        },
      ],
      commitMessage: "Iterate title slide",
    }),
  );
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
    await runGen(
      runIterateOnDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "change the title",
      }),
    );

    const [, input] = streamDeckFilesMock.mock.calls[0];
    expect(input.existingFiles).toBeDefined();
    expect(input.existingFiles.length).toBeGreaterThan(0);
    expect(input.existingFiles[0].path).toMatch(/src\/decks\/public\/my\//);
  });

  it("forwards pinned elements to AI gen", async () => {
    await runGen(
      runIterateOnDeckDraft(makeEnv(), {
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
      }),
    );

    const [, input] = streamDeckFilesMock.mock.calls[0];
    expect(input.pinnedElements).toHaveLength(1);
    expect(input.pinnedElements[0].file).toBe(
      "src/decks/public/my/01-title.tsx",
    );
  });

  it("returns success result with the new SHA", async () => {
    const { result } = await runGen(
      runIterateOnDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "iter",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commitSha).toBe(
        "def1234567890abcdef1234567890abcdef12345",
      );
    }
  });

  it("yields phase snapshots in order: fork → clone → ai_gen → apply → commit → push → done", async () => {
    const { snapshots, result } = await runGen(
      runIterateOnDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "iter",
      }),
    );

    expect(result.ok).toBe(true);

    const phases = snapshots.map((s) => s.phase);
    const order: DeckCreationSnapshot["phase"][] = [];
    for (const p of phases) {
      if (order[order.length - 1] !== p) order.push(p);
    }
    expect(order).toEqual([
      "fork",
      "clone",
      "ai_gen",
      "apply",
      "commit",
      "push",
      "done",
    ]);
  });
});

describe("runIterateOnDeckDraft — failure modes", () => {
  it("returns phase:fork when the draft doesn't exist", async () => {
    getDraftRepoMock.mockRejectedValueOnce(new Error("not found"));
    const { result } = await runGen(
      runIterateOnDeckDraft(makeEnv(), {
        userEmail: "x@y",
        slug: "x",
        prompt: "x",
      }),
    );
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
