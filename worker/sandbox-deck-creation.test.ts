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
  ensureDraftRepoMock,
  getDraftRepoMock,
  mintWriteTokenMock,
  buildAuthenticatedRemoteUrlMock,
  buildArtifactsRemoteUrlMock,
  draftRepoNameMock,
  stripExpiresSuffixMock,
} = vi.hoisted(() => ({
  ensureDraftRepoMock: vi.fn(),
  getDraftRepoMock: vi.fn(),
  mintWriteTokenMock: vi.fn(),
  buildAuthenticatedRemoteUrlMock: vi.fn(
    (remote: string, token: string) => `https://x:${token}@${remote}`,
  ),
  // Mirror the real helper's URL shape so the constructed URL the
  // orchestrator passes to clone+commit reflects what production
  // would build. The real helper hardcodes
  // `artifacts.cloudflare.net/git/slide-of-hand-drafts/...` but the
  // test only cares that the URL is non-empty and stable.
  buildArtifactsRemoteUrlMock: vi.fn(
    (opts: { accountId: string; repoName: string }) =>
      `https://${opts.accountId}.artifacts.cloudflare.net/git/slide-of-hand-drafts/${opts.repoName}.git`,
  ),
  draftRepoNameMock: vi.fn(
    (email: string, slug: string) =>
      `${email.replace(/[^a-z0-9-]/g, "-")}-${slug}`,
  ),
  stripExpiresSuffixMock: vi.fn((t: string) => t.replace(/\?expires=.*$/, "")),
}));
vi.mock("./artifacts-client", () => ({
  ensureDraftRepo: ensureDraftRepoMock,
  getDraftRepo: getDraftRepoMock,
  mintWriteToken: mintWriteTokenMock,
  buildAuthenticatedRemoteUrl: buildAuthenticatedRemoteUrlMock,
  buildArtifactsRemoteUrl: buildArtifactsRemoteUrlMock,
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

const {
  applyFilesIntoSandboxMock,
  cloneRepoIntoSandboxMock,
  runSandboxTestGateMock,
  commitAndPushInSandboxMock,
} = vi.hoisted(() => ({
  applyFilesIntoSandboxMock: vi.fn(),
  cloneRepoIntoSandboxMock: vi.fn(),
  runSandboxTestGateMock: vi.fn(),
  commitAndPushInSandboxMock: vi.fn(),
}));
vi.mock("./sandbox-source-edit", () => ({
  applyFilesIntoSandbox: applyFilesIntoSandboxMock,
  cloneRepoIntoSandbox: cloneRepoIntoSandboxMock,
  runSandboxTestGate: runSandboxTestGateMock,
  commitAndPushInSandbox: commitAndPushInSandboxMock,
}));

const { openPullRequestMock } = vi.hoisted(() => ({
  openPullRequestMock: vi.fn(),
}));
vi.mock("./github-client", async () => {
  const actual =
    await vi.importActual<typeof import("./github-client")>("./github-client");
  return {
    ...actual,
    openPullRequest: openPullRequestMock,
  };
});

const { getStoredGitHubTokenMock } = vi.hoisted(() => ({
  getStoredGitHubTokenMock: vi.fn(),
}));
vi.mock("./github-oauth", () => ({
  getStoredGitHubToken: getStoredGitHubTokenMock,
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

// Preview-wiring mocks (#271). The orchestrator calls
// `upsertDraftPreviewMapping` from `./draft-previews-store` after a
// successful commit; the preview builder itself is injected via a
// test seam (`runBuildDraftPreviewFn`) so we don't need to mock
// `./sandbox-preview-build` at the module level.
const { upsertDraftPreviewMappingMock } = vi.hoisted(() => ({
  upsertDraftPreviewMappingMock: vi.fn(),
}));
vi.mock("./draft-previews-store", () => ({
  upsertDraftPreviewMapping: upsertDraftPreviewMappingMock,
}));

import {
  ensureDraftFalseInMetaContent,
  ensureDraftTrueInMetaContent,
  runCreateDeckDraft,
  runIterateOnDeckDraft,
  runPublishDraft,
  setDraftFlagInMetaContent,
  type DeckCreationSnapshot,
  type PublishDraftEnv,
  type RunBuildDraftPreviewFn,
  type SandboxDeckCreationEnv,
} from "./sandbox-deck-creation";
import type { AiDeckGenResult, DeckGenPartial } from "./ai-deck-gen";

// ── Helpers ──────────────────────────────────────────────────────────

// Stable test value for the Cloudflare account ID. Used to verify
// the constructed Artifacts remote URL (see `buildArtifactsRemoteUrl`)
// is plumbed through correctly.
const TEST_ACCOUNT_ID = "test-account-id-32chars-of-hex00";

function makeEnv(): SandboxDeckCreationEnv {
  return {
    Sandbox: {} as unknown as SandboxDeckCreationEnv["Sandbox"],
    ARTIFACTS: {} as unknown as Artifacts,
    AI: {} as unknown as Ai,
    CF_ACCOUNT_ID: TEST_ACCOUNT_ID,
  };
}

/**
 * Env carrying the optional preview bindings (#271). When ALL of
 * `PREVIEW_BUNDLES`, `DECKS`, and `GITHUB_TOKENS` are present the
 * orchestrator runs the preview-wiring branch; absent any one of
 * them, the orchestrator skips preview entirely. Test code that
 * exercises preview wiring uses this helper; legacy tests stick
 * with `makeEnv()`.
 */
function makeEnvWithPreview(): SandboxDeckCreationEnv {
  return {
    ...makeEnv(),
    PREVIEW_BUNDLES: {} as unknown as R2Bucket,
    DECKS: {} as unknown as KVNamespace,
    GITHUB_TOKENS: {} as unknown as KVNamespace,
  };
}

function makePublishEnv(): PublishDraftEnv {
  return {
    Sandbox: {} as unknown as PublishDraftEnv["Sandbox"],
    ARTIFACTS: {
      // Each test that exercises a get() path overrides this. Default
      // resolves to a minimal repo handle.
      get: vi.fn(),
    } as unknown as Artifacts,
    GITHUB_TOKENS: {} as KVNamespace,
    CF_ACCOUNT_ID: TEST_ACCOUNT_ID,
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
  ensureDraftRepoMock.mockResolvedValue({
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
  ensureDraftRepoMock.mockReset();
  getDraftRepoMock.mockReset();
  mintWriteTokenMock.mockReset();
  cloneArtifactsRepoIntoSandboxMock.mockReset();
  commitAndPushToArtifactsInSandboxMock.mockReset();
  applyFilesIntoSandboxMock.mockReset();
  cloneRepoIntoSandboxMock.mockReset();
  runSandboxTestGateMock.mockReset();
  commitAndPushInSandboxMock.mockReset();
  streamDeckFilesMock.mockReset();
  getSandboxMock.mockReset();
  openPullRequestMock.mockReset();
  getStoredGitHubTokenMock.mockReset();
  upsertDraftPreviewMappingMock.mockReset();
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
    expect(ensureDraftRepoMock).toHaveBeenCalledWith(
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
    ensureDraftRepoMock.mockResolvedValueOnce({
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
    ensureDraftRepoMock.mockRejectedValueOnce(
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
    // The canvas's phase strip needs to know WHICH chip to mark red
    // even when the canvas mounts after the error (refresh + chat
    // history hydration). Snapshot carries this on `failedPhase`.
    expect(last?.failedPhase).toBe("fork");
  });

  it("populates failedPhase on every error branch", async () => {
    // One scenario per failure point to pin the mapping. The exact
    // error messages aren't asserted (covered by the existing
    // failure-modes block); the focus is the failedPhase value.

    // ai_gen
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles([], {
        ok: false,
        phase: "model_error",
        error: "rate limit",
      }),
    );
    const aiGenRun = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );
    expect(
      aiGenRun.snapshots[aiGenRun.snapshots.length - 1]?.failedPhase,
    ).toBe("ai_gen");

    // clone
    cloneArtifactsRepoIntoSandboxMock.mockResolvedValueOnce({
      ok: false,
      error: "auth failed",
    });
    const cloneRun = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );
    expect(
      cloneRun.snapshots[cloneRun.snapshots.length - 1]?.failedPhase,
    ).toBe("clone");

    // apply
    applyFilesIntoSandboxMock.mockResolvedValueOnce({
      ok: false,
      error: "disk full",
    });
    const applyRun = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );
    expect(
      applyRun.snapshots[applyRun.snapshots.length - 1]?.failedPhase,
    ).toBe("apply");

    // commit
    commitAndPushToArtifactsInSandboxMock.mockResolvedValueOnce({
      ok: false,
      error: "push rejected",
    });
    const commitRun = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );
    expect(
      commitRun.snapshots[commitRun.snapshots.length - 1]?.failedPhase,
    ).toBe("commit");
  });
});

describe("runCreateDeckDraft — failure modes", () => {
  beforeEach(() => setHappyPathMocks());

  it("returns phase:fork when fork throws", async () => {
    ensureDraftRepoMock.mockRejectedValueOnce(
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

describe("runCreateDeckDraft — creation-as-draft (#191)", () => {
  // Slice of #191 (Worker B). The orchestrator MUST guarantee that
  // every newly-created deck lands on disk with `draft: true` in its
  // `meta.ts`, regardless of what the model emits. This is the
  // braces to the prompt-side belt (asserted in
  // `worker/ai-deck-gen.test.ts`).
  beforeEach(() => setHappyPathMocks());

  // The orchestrator post-processes the generated files BEFORE
  // calling `applyFilesIntoSandbox`. We inspect the second arg of
  // that call to verify the meta.ts content that lands on disk.
  function metaContentApplied(): string | undefined {
    const call = applyFilesIntoSandboxMock.mock.calls[0];
    if (!call) return undefined;
    const files = call[1] as Array<{ path: string; content: string }>;
    return files.find((f) => f.path.endsWith("/meta.ts"))?.content;
  }

  it("injects draft: true when the model omits the field entirely", async () => {
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles([], {
        ok: true,
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: [
              `import type { DeckMeta } from "@/framework/viewer/types";`,
              "",
              `export const meta: DeckMeta = {`,
              `  slug: "my",`,
              `  title: "Title",`,
              `  date: "2026-06-01",`,
              `};`,
            ].join("\n"),
          },
          {
            path: "src/decks/public/my/index.tsx",
            content: "deck file",
          },
          {
            path: "src/decks/public/my/01-title.tsx",
            content: "slide",
          },
        ],
        commitMessage: "Initial deck",
      }),
    );
    const { result } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );
    expect(result.ok).toBe(true);
    const meta = metaContentApplied();
    expect(meta).toBeDefined();
    expect(meta).toMatch(/\bdraft:\s*true\b/);
  });

  it("overrides draft: false to draft: true (fresh creation is a draft by definition)", async () => {
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles([], {
        ok: true,
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: [
              `export const meta: DeckMeta = {`,
              `  slug: "my",`,
              `  title: "T",`,
              `  date: "2026-06-01",`,
              `  draft: false,`,
              `};`,
            ].join("\n"),
          },
          { path: "src/decks/public/my/index.tsx", content: "deck" },
          { path: "src/decks/public/my/01-title.tsx", content: "slide" },
        ],
        commitMessage: "Init",
      }),
    );
    await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );
    const meta = metaContentApplied();
    expect(meta).toMatch(/\bdraft:\s*true\b/);
    expect(meta).not.toMatch(/\bdraft:\s*false\b/);
  });

  it("does not double-inject when the model already wrote draft: true", async () => {
    const original = [
      `export const meta: DeckMeta = {`,
      `  slug: "my",`,
      `  title: "T",`,
      `  date: "2026-06-01",`,
      `  draft: true,`,
      `};`,
    ].join("\n");
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles([], {
        ok: true,
        files: [
          { path: "src/decks/public/my/meta.ts", content: original },
          { path: "src/decks/public/my/index.tsx", content: "deck" },
          { path: "src/decks/public/my/01-title.tsx", content: "slide" },
        ],
        commitMessage: "Init",
      }),
    );
    await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );
    const meta = metaContentApplied();
    // Exactly one `draft: true` assignment, not two.
    const occurrences = (meta ?? "").match(/\bdraft:\s*true\b/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("propagates the draft-injected meta into the apply phase snapshot", async () => {
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles([], {
        ok: true,
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: `export const meta: DeckMeta = { slug: "my", title: "T", date: "2026-06-01" };`,
          },
          { path: "src/decks/public/my/index.tsx", content: "deck" },
          { path: "src/decks/public/my/01-title.tsx", content: "slide" },
        ],
        commitMessage: "Init",
      }),
    );
    const { snapshots } = await runGen(
      runCreateDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "x",
      }),
    );
    // The apply snapshot is the first one consumers see the file
    // tree from — assert the canvas-facing snapshot also reflects
    // the injection so the in-flight UI matches what's committed.
    const applySnap = snapshots.find((s) => s.phase === "apply");
    const metaFile = applySnap?.files.find((f) =>
      f.path.endsWith("/meta.ts"),
    );
    expect(metaFile?.content).toMatch(/\bdraft:\s*true\b/);
  });
});

describe("ensureDraftTrueInMetaContent (unit)", () => {
  // Exhaustive table of input shapes the helper is expected to
  // handle. Pinned via the exported symbol so the regex can evolve
  // without breaking the orchestrator tests above.
  it("normalises an existing draft: false to draft: true", () => {
    const input = `export const meta: DeckMeta = {\n  draft: false,\n};`;
    expect(ensureDraftTrueInMetaContent(input)).toMatch(/draft:\s*true/);
    expect(ensureDraftTrueInMetaContent(input)).not.toMatch(/draft:\s*false/);
  });

  it("leaves an existing draft: true untouched (no double-injection)", () => {
    const input = `export const meta: DeckMeta = {\n  draft: true,\n};`;
    const out = ensureDraftTrueInMetaContent(input);
    const occurrences = out.match(/draft:\s*true/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("normalises draft: undefined to draft: true", () => {
    const input = `export const meta: DeckMeta = {\n  draft: undefined,\n};`;
    expect(ensureDraftTrueInMetaContent(input)).toMatch(/draft:\s*true/);
  });

  it("normalises draft: null to draft: true", () => {
    const input = `export const meta: DeckMeta = {\n  draft: null,\n};`;
    expect(ensureDraftTrueInMetaContent(input)).toMatch(/draft:\s*true/);
  });

  it("injects draft: true when no draft field exists (typed meta)", () => {
    const input = `export const meta: DeckMeta = {\n  slug: "x",\n};`;
    expect(ensureDraftTrueInMetaContent(input)).toMatch(/draft:\s*true/);
  });

  it("injects draft: true when no draft field exists (untyped meta)", () => {
    const input = `export const meta = {\n  slug: "x",\n};`;
    expect(ensureDraftTrueInMetaContent(input)).toMatch(/draft:\s*true/);
  });

  it("returns content unchanged when no meta object is present (parse miss)", () => {
    const input = `export const NOT_meta = {\n  slug: "x",\n};`;
    expect(ensureDraftTrueInMetaContent(input)).toBe(input);
  });
});

describe("ensureDraftFalseInMetaContent / setDraftFlagInMetaContent(value=false) (unit)", () => {
  // Symmetric to ensureDraftTrueInMetaContent — used by
  // `runPublishDraft` (#191 slice 5) to flip a draft's
  // `draft: true` flag to `false` as part of the publish commit.
  //
  // Asymmetric behaviour vs the value=true mode: when the field is
  // ABSENT, the helper MUST NOT inject `draft: false`. Publishing
  // a deck that never carried a draft flag should leave its
  // meta.ts visually unchanged so the PR diff doesn't gain a
  // spurious line.

  it("rewrites draft: true to draft: false", () => {
    const input = `export const meta: DeckMeta = {\n  draft: true,\n};`;
    const out = ensureDraftFalseInMetaContent(input);
    expect(out).toMatch(/draft:\s*false/);
    expect(out).not.toMatch(/draft:\s*true/);
  });

  it("preserves an existing draft: false (no double-rewrite)", () => {
    const input = `export const meta: DeckMeta = {\n  draft: false,\n};`;
    const out = ensureDraftFalseInMetaContent(input);
    // Same content in, same content out — `draft: false` → `draft: false`
    // is a textual no-op via the normalisation branch.
    expect(out).toBe(input);
  });

  it("does NOT inject draft: false when the field is absent (typed meta)", () => {
    // Publish-of-non-draft case: the deck's meta has no `draft`
    // field, so the publish commit should leave the file untouched
    // rather than clutter the diff.
    const input = `export const meta: DeckMeta = {\n  slug: "x",\n  title: "T",\n};`;
    expect(ensureDraftFalseInMetaContent(input)).toBe(input);
  });

  it("does NOT inject draft: false when the field is absent (untyped meta)", () => {
    const input = `export const meta = {\n  slug: "x",\n};`;
    expect(ensureDraftFalseInMetaContent(input)).toBe(input);
  });

  it("preserves unrelated fields and layout when rewriting", () => {
    const input = [
      `import type { DeckMeta } from "@/framework/viewer/types";`,
      "",
      `export const meta: DeckMeta = {`,
      `  slug: "my",`,
      `  title: "Hello",`,
      `  date: "2026-06-01",`,
      `  draft: true,`,
      `  author: "Alice",`,
      `};`,
    ].join("\n");
    const out = ensureDraftFalseInMetaContent(input);
    // The only difference should be the draft value.
    expect(out).toBe(input.replace("draft: true", "draft: false"));
  });

  it("returns content unchanged when no meta object is present (parse miss)", () => {
    const input = `export const NOT_meta = {\n  draft: nope\n};`;
    expect(ensureDraftFalseInMetaContent(input)).toBe(input);
  });

  it("setDraftFlagInMetaContent is parameterised by value (sanity check)", () => {
    // Documents that the underlying helper is symmetric — both
    // exported wrappers ultimately call into the same function.
    const draftTrueInput = `export const meta = {\n  draft: true,\n};`;
    expect(setDraftFlagInMetaContent(draftTrueInput, false)).toMatch(
      /draft:\s*false/,
    );
    const draftFalseInput = `export const meta = {\n  draft: false,\n};`;
    expect(setDraftFlagInMetaContent(draftFalseInput, true)).toMatch(
      /draft:\s*true/,
    );
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

describe("runIterateOnDeckDraft — preserves meta.draft (#191)", () => {
  // Iteration MUST NOT inject `draft: true` — the user may have
  // intentionally published the deck (flipped to `draft: false` or
  // dropped the field). An iteration prompt that tweaks a slide
  // should not silently re-draft a published deck.
  beforeEach(() => setIterateHappyPathMocks());

  it("does not transform meta.ts when the model emits draft: false", async () => {
    const published = [
      `export const meta: DeckMeta = {`,
      `  slug: "my",`,
      `  title: "T",`,
      `  date: "2026-06-01",`,
      `  draft: false,`,
      `};`,
    ].join("\n");
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles([], {
        ok: true,
        files: [{ path: "src/decks/public/my/meta.ts", content: published }],
        commitMessage: "Iterate",
      }),
    );
    await runGen(
      runIterateOnDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "tweak",
      }),
    );
    // The exact content the orchestrator wrote to the working tree
    // is whatever streamDeckFiles produced — no draft mutation.
    const applyCall = applyFilesIntoSandboxMock.mock.calls[0];
    const files = applyCall?.[1] as Array<{ path: string; content: string }>;
    const meta = files.find((f) => f.path.endsWith("/meta.ts"));
    expect(meta?.content).toBe(published);
  });

  it("does not inject draft: true when the model emits a meta without a draft field", async () => {
    const noDraft = [
      `export const meta: DeckMeta = {`,
      `  slug: "my",`,
      `  title: "Updated",`,
      `  date: "2026-06-01",`,
      `};`,
    ].join("\n");
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles([], {
        ok: true,
        files: [{ path: "src/decks/public/my/meta.ts", content: noDraft }],
        commitMessage: "Iterate",
      }),
    );
    await runGen(
      runIterateOnDeckDraft(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "my",
        prompt: "tweak",
      }),
    );
    const applyCall = applyFilesIntoSandboxMock.mock.calls[0];
    const files = applyCall?.[1] as Array<{ path: string; content: string }>;
    const meta = files.find((f) => f.path.endsWith("/meta.ts"));
    expect(meta?.content).toBe(noDraft);
    expect(meta?.content).not.toMatch(/draft:\s*true/);
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

// ── runPublishDraft ─────────────────────────────────────────────────
//
// The orchestrator stitches a long sequence of collaborators together:
//
//   auth → github_token → artifacts_resolve → clone_draft → clone_github
//        → copy_files → test_gate → github_push → open_pr
//
// Each step has its own discriminant on the `ok: false` branch so the
// caller (and eventually the UI) can render the right next action.
// Tests below exercise the happy path + each failure mode, mocking
// every collaborator so the orchestrator's sequencing + error
// translation can be verified in isolation.

/**
 * Build a sandbox stub with an `exec` mock that succeeds by default
 * (used for the cp step in runPublishDraft). Each test that wants
 * the cp to fail overrides this.
 *
 * Also exposes `readFile` / `writeFile` mocks used by the publish
 * flow to flip `meta.draft: true` to `false` (#191 slice 5). The
 * default `readFile` returns a representative draft `meta.ts`
 * carrying `draft: true`; `writeFile` resolves to a success result.
 * Tests that care about the flip read from these mocks; tests that
 * don't are unaffected — the readFile is wrapped in a try/catch in
 * `runPublishDraft` and any failure is silently ignored.
 */
function makeSandboxStub(): {
  exec: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
} {
  return {
    exec: vi.fn(async () => ({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
    })),
    readFile: vi.fn(async (path: string) => ({
      success: true,
      path,
      content: [
        `import type { DeckMeta } from "@/framework/viewer/types";`,
        "",
        `export const meta: DeckMeta = {`,
        `  slug: "my",`,
        `  title: "T",`,
        `  date: "2026-06-01",`,
        `  draft: true,`,
        `};`,
      ].join("\n"),
      timestamp: new Date().toISOString(),
    })),
    writeFile: vi.fn(async () => ({ success: true })),
  };
}

/**
 * Set up the mocks so every step of `runPublishDraft` succeeds with
 * representative values. Tests that exercise a specific failure
 * mode call this first and then override the relevant mock.
 */
function setPublishHappyPathMocks(): { sandbox: ReturnType<typeof makeSandboxStub> } {
  getStoredGitHubTokenMock.mockResolvedValue({
    token: "ghu_xxx",
    refreshToken: null,
    expiresAt: null,
  });
  // ARTIFACTS.get(name) → an ArtifactsRepo handle. The handle's
  // .createToken returns a fresh token; .remote is the bare URL.
  // We don't use getDraftRepo's helper signature here because the
  // tests want to control the repo's shape directly.
  const repoCreateToken = vi.fn(async () => ({
    plaintext: "art_v1_read?expires=999",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }));
  getDraftRepoMock.mockResolvedValue({
    name: "alice-example-com-my",
    remote:
      "1bcef46c.artifacts.cloudflare.net/git/slide-of-hand-drafts/alice-example-com-my.git",
    token: "art_v1_initial",
    defaultBranch: "main",
    createToken: repoCreateToken,
  });
  mintWriteTokenMock.mockResolvedValue({
    plaintext: "art_v1_read?expires=999",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  cloneArtifactsRepoIntoSandboxMock.mockResolvedValue({
    ok: true,
    workdir: "/workspace/draft",
    ref: "main",
  });
  cloneRepoIntoSandboxMock.mockResolvedValue({
    ok: true,
    workdir: "/workspace/slide-of-hand",
    ref: "main",
  });
  runSandboxTestGateMock.mockResolvedValue({
    ok: true,
    phases: [
      { phase: "install", ok: true, command: "npm ci", stdout: "", stderr: "", exitCode: 0 },
      { phase: "typecheck", ok: true, command: "npm run typecheck", stdout: "", stderr: "", exitCode: 0 },
      { phase: "test", ok: true, command: "npm test", stdout: "", stderr: "", exitCode: 0 },
      { phase: "build", ok: true, command: "npm run build", stdout: "", stderr: "", exitCode: 0 },
    ],
  });
  commitAndPushInSandboxMock.mockResolvedValue({
    ok: true,
    sha: "f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
    branch: "deck/my-1700000000000",
  });
  openPullRequestMock.mockResolvedValue({
    ok: true,
    result: {
      number: 42,
      htmlUrl: "https://github.com/mcdays94/slide-of-hand/pull/42",
      nodeId: "PR_kw",
      head: "deck/my-1700000000000",
      base: "main",
    },
  });
  const sandbox = makeSandboxStub();
  getSandboxMock.mockReturnValue(sandbox as unknown as ReturnType<typeof getSandboxMock>);
  return { sandbox };
}

describe("runPublishDraft — happy path", () => {
  it("walks the full sequence and returns the new PR number + URL", async () => {
    setPublishHappyPathMocks();
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prNumber).toBe(42);
      expect(result.prHtmlUrl).toBe(
        "https://github.com/mcdays94/slide-of-hand/pull/42",
      );
      // The branch echoes back from commitAndPushInSandbox so the UI
      // can show "we pushed to <branch>" if the PR step fails later.
      expect(result.branch).toBe("deck/my-1700000000000");
    }
    // Sequence sanity: every collaborator was called exactly once,
    // in order. Verifying call ORDER catches accidental rearranges
    // that'd skip the test gate or push without commit.
    expect(getStoredGitHubTokenMock).toHaveBeenCalledTimes(1);
    expect(getDraftRepoMock).toHaveBeenCalledTimes(1);
    expect(cloneArtifactsRepoIntoSandboxMock).toHaveBeenCalledTimes(1);
    expect(cloneRepoIntoSandboxMock).toHaveBeenCalledTimes(1);
    expect(runSandboxTestGateMock).toHaveBeenCalledTimes(1);
    expect(commitAndPushInSandboxMock).toHaveBeenCalledTimes(1);
    expect(openPullRequestMock).toHaveBeenCalledTimes(1);
  });

  it("opens the PR as a draft against TARGET_REPO", async () => {
    setPublishHappyPathMocks();
    await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(openPullRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ draft: true, base: "main" }),
    );
  });

  it("titles the PR + commit with feat(deck/<slug>) so the message is GitHub-conventional", async () => {
    setPublishHappyPathMocks();
    await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "crdt-collab",
    });
    expect(commitAndPushInSandboxMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        commitMessage: expect.stringContaining("feat(deck/crdt-collab):"),
      }),
      expect.any(String),
    );
    expect(openPullRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("feat(deck/crdt-collab):"),
      }),
    );
  });

  it("copies the deck folder from the Artifacts clone into the GitHub clone", async () => {
    const { sandbox } = setPublishHappyPathMocks();
    await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    // The cp step is what bridges the two clones. It MUST reference
    // both workdirs by their absolute paths to avoid CWD assumptions.
    const execCalls = sandbox.exec.mock.calls;
    const cpCall = execCalls.find((c) => String(c[0]).includes("cp -r"));
    expect(cpCall).toBeDefined();
    if (cpCall) {
      const cmd = String(cpCall[0]);
      expect(cmd).toContain("/workspace/draft/src/decks/public/my");
      expect(cmd).toContain("/workspace/slide-of-hand/src/decks/public");
    }
  });
});

describe("runPublishDraft — error phases", () => {
  it("returns phase:auth when there's no authenticated user", async () => {
    setPublishHappyPathMocks();
    const result = await runPublishDraft(
      makePublishEnv(),
      { userEmail: "  ", slug: "my" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("auth");
  });

  it("returns phase:github_token when the user hasn't connected GitHub", async () => {
    setPublishHappyPathMocks();
    getStoredGitHubTokenMock.mockResolvedValue(null);
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("github_token");
  });

  it("returns phase:artifacts_resolve when the draft doesn't exist on Artifacts", async () => {
    setPublishHappyPathMocks();
    getDraftRepoMock.mockRejectedValue(new Error("ArtifactsError: not_found"));
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("artifacts_resolve");
      expect(result.error).toContain("not_found");
    }
  });

  it("returns phase:clone_draft when the Artifacts clone fails", async () => {
    setPublishHappyPathMocks();
    cloneArtifactsRepoIntoSandboxMock.mockResolvedValue({
      ok: false,
      error: "auth required",
    });
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("clone_draft");
      expect(result.error).toContain("auth required");
    }
  });

  it("returns phase:clone_github when the GitHub clone fails", async () => {
    setPublishHappyPathMocks();
    cloneRepoIntoSandboxMock.mockResolvedValue({
      ok: false,
      error: "permission denied",
    });
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("clone_github");
      expect(result.error).toContain("permission denied");
    }
  });

  it("returns phase:copy_files when the cp step exits non-zero", async () => {
    const { sandbox } = setPublishHappyPathMocks();
    sandbox.exec.mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "cp: source not found",
    });
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("copy_files");
      expect(result.error).toContain("source not found");
    }
  });

  it("returns phase:test_gate with the failed gate phase when typecheck fails", async () => {
    setPublishHappyPathMocks();
    runSandboxTestGateMock.mockResolvedValue({
      ok: false,
      failedPhase: "typecheck",
      phases: [
        { phase: "install", ok: true, command: "npm ci", stdout: "", stderr: "", exitCode: 0 },
        { phase: "typecheck", ok: false, command: "npm run typecheck", stdout: "", stderr: "TS2304", exitCode: 1 },
      ],
    });
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("test_gate");
      // Surface which gate phase failed so the UI / model can react.
      expect(result.failedTestGatePhase).toBe("typecheck");
    }
  });

  it("returns phase:github_push when commit fails (e.g. no effective changes)", async () => {
    setPublishHappyPathMocks();
    commitAndPushInSandboxMock.mockResolvedValue({
      ok: false,
      noEffectiveChanges: true,
      error: "No changes to commit",
    });
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("github_push");
      // Pass through the noEffectiveChanges marker so the UI can show
      // a tailored "the draft is identical to main" message rather
      // than a generic git failure.
      expect(result.noEffectiveChanges).toBe(true);
    }
  });

  it("returns phase:open_pr when the GitHub PR API rejects the request", async () => {
    setPublishHappyPathMocks();
    openPullRequestMock.mockResolvedValue({
      ok: false,
      kind: "rate_limit",
      message: "API rate limit exceeded",
      status: 403,
    });
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("open_pr");
      expect(result.error).toContain("rate limit");
    }
  });
});

describe("runPublishDraft — flips meta.draft (#191 slice 5)", () => {
  // Symmetric to the creation-as-draft slice: publishing MUST rewrite
  // `meta.draft: true` to `meta.draft: false` in the commit that
  // lands on GitHub, regardless of what the draft on Artifacts
  // carried. The flip happens AFTER the cp from /workspace/draft to
  // /workspace/slide-of-hand and BEFORE the test gate, so the gate
  // sees the post-flip content.

  it("rewrites draft: true to draft: false in the meta.ts inside the GitHub checkout", async () => {
    const { sandbox } = setPublishHappyPathMocks();
    // Default readFile mock already returns a draft: true meta —
    // see makeSandboxStub. The orchestrator should write the
    // flipped content back via writeFile.
    await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(sandbox.readFile).toHaveBeenCalledWith(
      "/workspace/slide-of-hand/src/decks/public/my/meta.ts",
    );
    expect(sandbox.writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = sandbox.writeFile.mock.calls[0];
    expect(writtenPath).toBe(
      "/workspace/slide-of-hand/src/decks/public/my/meta.ts",
    );
    expect(writtenContent).toMatch(/\bdraft:\s*false\b/);
    expect(writtenContent).not.toMatch(/\bdraft:\s*true\b/);
  });

  it("does NOT write back when meta.draft is absent (publish-of-non-draft is a no-op)", async () => {
    const { sandbox } = setPublishHappyPathMocks();
    // Override the default readFile to return a meta with NO
    // `draft` field — this models the "user republishing an
    // already-published deck" or "deck that never went through the
    // creation-as-draft slice" case.
    sandbox.readFile.mockResolvedValueOnce({
      success: true,
      path: "/workspace/slide-of-hand/src/decks/public/my/meta.ts",
      content: [
        `export const meta: DeckMeta = {`,
        `  slug: "my",`,
        `  title: "T",`,
        `  date: "2026-06-01",`,
        `};`,
      ].join("\n"),
      timestamp: new Date().toISOString(),
    });
    await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(sandbox.writeFile).not.toHaveBeenCalled();
  });

  it("does NOT write back when meta.draft is already false (idempotent re-publish)", async () => {
    const { sandbox } = setPublishHappyPathMocks();
    sandbox.readFile.mockResolvedValueOnce({
      success: true,
      path: "/workspace/slide-of-hand/src/decks/public/my/meta.ts",
      content: [
        `export const meta: DeckMeta = {`,
        `  slug: "my",`,
        `  draft: false,`,
        `};`,
      ].join("\n"),
      timestamp: new Date().toISOString(),
    });
    await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(sandbox.writeFile).not.toHaveBeenCalled();
  });

  it("continues the publish flow when reading meta.ts fails (best-effort)", async () => {
    const { sandbox } = setPublishHappyPathMocks();
    // A read failure shouldn't tank the entire publish — the test
    // gate runs next and will catch a genuinely-broken meta.ts.
    sandbox.readFile.mockRejectedValueOnce(new Error("EIO"));
    const result = await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(result.ok).toBe(true);
    expect(sandbox.writeFile).not.toHaveBeenCalled();
    // The downstream steps still ran:
    expect(runSandboxTestGateMock).toHaveBeenCalledTimes(1);
    expect(commitAndPushInSandboxMock).toHaveBeenCalledTimes(1);
  });

  it("runs the flip BEFORE the test gate so the gate sees the post-flip content", async () => {
    const { sandbox } = setPublishHappyPathMocks();
    // Record the order in which readFile (the flip read) and
    // runSandboxTestGate fire. The flip MUST come first so a
    // gate-time assertion on `draft: false` would actually see it.
    const callOrder: string[] = [];
    sandbox.readFile.mockImplementationOnce(async (path: string) => {
      callOrder.push("readFile");
      return {
        success: true,
        path,
        content: `export const meta = { draft: true };`,
        timestamp: new Date().toISOString(),
      };
    });
    runSandboxTestGateMock.mockImplementationOnce(async () => {
      callOrder.push("testGate");
      return {
        ok: true,
        phases: [],
      };
    });
    await runPublishDraft(makePublishEnv(), {
      userEmail: "alice@example.com",
      slug: "my",
    });
    expect(callOrder).toEqual(["readFile", "testGate"]);
  });
});

// ── Preview wiring (#271) ────────────────────────────────────────────
//
// `runCreateDeckDraft` / `runIterateOnDeckDraft` extend the post-commit
// path with an opt-in preview build. The env must carry
// `PREVIEW_BUNDLES` + `DECKS` + `GITHUB_TOKENS` for the wiring to
// engage; absent any of them the orchestrator skips preview entirely
// (legacy + skill-composer behaviour).
//
// Three orchestrator-level guarantees we lock down here:
//
//   1. The preview builder is called AFTER the Artifacts commit
//      lands — never on a failed create/iterate.
//   2. Preview success surfaces `previewStatus: "ready"` +
//      `previewUrl` on both the final snapshot AND the lean tool
//      result.
//   3. Preview failure is non-destructive — the lean result remains
//      `ok: true`, but carries `previewStatus: "error"` +
//      `previewError` so the UI can warn.

const TEST_PREVIEW_ID = "pv_0123456789abcdef";

function setPreviewHappyPathMocks(): void {
  upsertDraftPreviewMappingMock.mockResolvedValue({
    previewId: TEST_PREVIEW_ID,
    ownerEmail: "alice@example.com",
    draftRepoName: "alice-example-com-my",
    slug: "my",
    latestCommitSha: "abc1234567890abcdef1234567890abcdef12345",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  });
}

describe("runCreateDeckDraft — preview wiring (#271)", () => {
  beforeEach(() => {
    setHappyPathMocks();
    setPreviewHappyPathMocks();
  });

  it("calls the preview builder with userEmail, slug, draftRepoName, commitSha, previewId after a successful commit", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl:
        "/preview/pv_0123456789abcdef/abc1234567890abcdef1234567890abcdef12345/index.html",
      uploadedFiles: 14,
    }));
    const { result } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    expect(builder).toHaveBeenCalledTimes(1);
    const [, builderInput] = builder.mock.calls[0];
    expect(builderInput).toMatchObject({
      userEmail: "alice@example.com",
      slug: "my",
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
      previewId: TEST_PREVIEW_ID,
    });
    // draftRepoName is whatever upsertDraftPreviewMapping established
    // for this (owner, slug) pair — the orchestrator threads the
    // commit's draftId through. Mirrors what the mapping store
    // records as `draftRepoName`.
    expect(builderInput.draftRepoName).toMatch(/-my$/);
  });

  it("includes previewUrl + previewStatus: 'ready' on the final lean tool result when preview succeeds", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl:
        "/preview/pv_0123456789abcdef/abc1234567890abcdef1234567890abcdef12345/index.html",
      uploadedFiles: 14,
    }));
    const { result } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previewStatus).toBe("ready");
      expect(result.previewUrl).toBe(
        "/preview/pv_0123456789abcdef/abc1234567890abcdef1234567890abcdef12345/index.html",
      );
      expect(result.previewUploadedFiles).toBe(14);
    }
  });

  it("stamps the final 'done' snapshot with previewStatus + previewUrl when preview succeeds", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl: "/preview/pv_x/abc1234/index.html",
      uploadedFiles: 3,
    }));
    const { snapshots } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    // The orchestrator yields TWO "done" snapshots when preview
    // wiring runs: one with `previewStatus: "building"` BEFORE the
    // builder fires, and one (the final) with the terminal preview
    // state stamped on. The final snapshot is what consumers
    // surface to the UI.
    const doneSnaps = snapshots.filter((s) => s.phase === "done");
    expect(doneSnaps.length).toBeGreaterThanOrEqual(2);
    const finalDone = doneSnaps[doneSnaps.length - 1];
    expect(finalDone?.previewStatus).toBe("ready");
    expect(finalDone?.previewUrl).toBe("/preview/pv_x/abc1234/index.html");
  });

  it("yields an intermediate 'done' snapshot with previewStatus: 'building' before the builder runs", async () => {
    let yieldedBuilding = false;
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => {
      // The orchestrator must have yielded the "building" snapshot
      // BEFORE we get here. Confirm via a side-channel flag.
      yieldedBuilding = true;
      return {
        ok: true,
        previewUrl: "/preview/pv_x/abc/index.html",
        uploadedFiles: 1,
      };
    });
    const { snapshots } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(yieldedBuilding).toBe(true);
    const buildingSnap = snapshots.find(
      (s) => s.phase === "done" && s.previewStatus === "building",
    );
    expect(buildingSnap).toBeDefined();
  });

  it("leaves the lean tool result ok: true even when the preview build fails (non-destructive)", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: false,
      phase: "build",
      error: "vite build failed (exit 1).",
    }));
    const { result } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    // Deck draft succeeded despite preview failure.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commitSha).toBe(
        "abc1234567890abcdef1234567890abcdef12345",
      );
      expect(result.previewStatus).toBe("error");
      expect(result.previewError).toMatch(/vite build failed/);
      expect(result.previewUrl).toBeUndefined();
    }
  });

  it("stamps the final 'done' snapshot with previewStatus: 'error' on preview failure", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: false,
      phase: "build",
      error: "vite build failed (exit 1).",
    }));
    const { snapshots } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    const finalSnap = snapshots[snapshots.length - 1];
    expect(finalSnap?.phase).toBe("done");
    expect(finalSnap?.previewStatus).toBe("error");
    expect(finalSnap?.previewError).toMatch(/vite build failed/);
  });

  it("treats a thrown preview-builder error as a non-destructive preview failure", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => {
      throw new Error("Sandbox network unreachable");
    });
    const { result } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previewStatus).toBe("error");
      expect(result.previewError).toMatch(/network unreachable/);
    }
  });

  it("treats a hung preview builder as a non-destructive timeout", async () => {
    const builder = Object.assign(
      vi.fn<RunBuildDraftPreviewFn>(
        () => new Promise<never>(() => {}),
      ),
      { timeoutMs: 1 },
    );
    const { result } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previewStatus).toBe("error");
      expect(result.previewError).toMatch(/timed out/i);
      expect(result.previewUrl).toBeUndefined();
    }
  });

  it("does NOT call the preview builder when the commit/push step fails", async () => {
    // Force commit to fail — preview must NOT fire because there's
    // no committed SHA to build against.
    commitAndPushToArtifactsInSandboxMock.mockResolvedValueOnce({
      ok: false,
      error: "push rejected",
    });
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl: "/preview/pv_x/abc/index.html",
      uploadedFiles: 1,
    }));
    const { result } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(false);
    expect(builder).not.toHaveBeenCalled();
  });

  it("does NOT call the preview builder when AI gen fails", async () => {
    streamDeckFilesMock.mockReturnValueOnce(
      fakeStreamDeckFiles([], {
        ok: false,
        phase: "model_error",
        error: "rate limit",
      }),
    );
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl: "/preview/pv_x/abc/index.html",
      uploadedFiles: 1,
    }));
    const { result } = await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(false);
    expect(builder).not.toHaveBeenCalled();
  });

  it("skips preview wiring silently when PREVIEW_BUNDLES is absent from the env", async () => {
    // Legacy env shape — no preview bindings. The orchestrator must
    // skip preview entirely and the final result must NOT carry any
    // preview fields. This guarantees backwards compatibility for
    // every existing caller that pre-dates #271.
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl: "/should/not/be/called",
      uploadedFiles: 0,
    }));
    const { result } = await runGen(
      runCreateDeckDraft(
        makeEnv(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previewStatus).toBeUndefined();
      expect(result.previewUrl).toBeUndefined();
      expect(result.previewError).toBeUndefined();
    }
    expect(builder).not.toHaveBeenCalled();
    expect(upsertDraftPreviewMappingMock).not.toHaveBeenCalled();
  });

  it("upserts the draft preview mapping with the committed SHA so iteration refreshes the same previewId", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl: "/preview/pv_x/abc/index.html",
      uploadedFiles: 1,
    }));
    await runGen(
      runCreateDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "x",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(upsertDraftPreviewMappingMock).toHaveBeenCalledTimes(1);
    const [, upsertInput] = upsertDraftPreviewMappingMock.mock.calls[0];
    expect(upsertInput).toMatchObject({
      ownerEmail: "alice@example.com",
      slug: "my",
      latestCommitSha: "abc1234567890abcdef1234567890abcdef12345",
    });
    expect(upsertInput.draftRepoName).toMatch(/-my$/);
  });
});

describe("runIterateOnDeckDraft — preview wiring (#271)", () => {
  beforeEach(() => {
    setIterateHappyPathMocks();
    setPreviewHappyPathMocks();
  });

  it("calls the preview builder with the new iteration SHA after a successful iterate commit", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl:
        "/preview/pv_0123456789abcdef/def1234567890abcdef1234567890abcdef12345/index.html",
      uploadedFiles: 14,
    }));
    const { result } = await runGen(
      runIterateOnDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "tweak",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    expect(builder).toHaveBeenCalledTimes(1);
    const [, builderInput] = builder.mock.calls[0];
    expect(builderInput).toMatchObject({
      userEmail: "alice@example.com",
      slug: "my",
      commitSha: "def1234567890abcdef1234567890abcdef12345",
      previewId: TEST_PREVIEW_ID,
    });
  });

  it("includes previewUrl on the lean tool result when iterate-preview succeeds", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl:
        "/preview/pv_0123456789abcdef/def1234567890abcdef1234567890abcdef12345/index.html",
      uploadedFiles: 14,
    }));
    const { result } = await runGen(
      runIterateOnDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "tweak",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previewStatus).toBe("ready");
      expect(result.previewUrl).toBe(
        "/preview/pv_0123456789abcdef/def1234567890abcdef1234567890abcdef12345/index.html",
      );
    }
  });

  it("leaves iterate ok: true even when the preview build fails (non-destructive)", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: false,
      phase: "install",
      error: "npm install failed (exit 1).",
    }));
    const { result } = await runGen(
      runIterateOnDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "tweak",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commitSha).toBe(
        "def1234567890abcdef1234567890abcdef12345",
      );
      expect(result.previewStatus).toBe("error");
      expect(result.previewError).toMatch(/npm install failed/);
      expect(result.previewUrl).toBeUndefined();
    }
  });

  it("does NOT call the preview builder when the iterate commit fails", async () => {
    commitAndPushToArtifactsInSandboxMock.mockResolvedValueOnce({
      ok: false,
      error: "push rejected",
    });
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl: "/preview/pv_x/def/index.html",
      uploadedFiles: 1,
    }));
    const { result } = await runGen(
      runIterateOnDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "tweak",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(false);
    expect(builder).not.toHaveBeenCalled();
  });

  it("skips preview wiring silently when the env lacks the preview bindings", async () => {
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: true,
      previewUrl: "/should/not/be/called",
      uploadedFiles: 0,
    }));
    const { result } = await runGen(
      runIterateOnDeckDraft(
        makeEnv(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "tweak",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previewStatus).toBeUndefined();
      expect(result.previewUrl).toBeUndefined();
    }
    expect(builder).not.toHaveBeenCalled();
  });

  it("redacts Artifacts token shapes from preview errors before surfacing them", async () => {
    // Defence-in-depth: if a preview builder error string ever
    // contained a leaked token, the orchestrator MUST scrub it
    // before stamping the snapshot/tool result. The builder itself
    // already does this; the orchestrator's redaction is the second
    // layer.
    const builder = vi.fn<RunBuildDraftPreviewFn>(async () => ({
      ok: false,
      phase: "artifacts_clone",
      error: "auth failed for art_v1_deadbeef1234?expires=999",
    }));
    const { result } = await runGen(
      runIterateOnDeckDraft(
        makeEnvWithPreview(),
        {
          userEmail: "alice@example.com",
          slug: "my",
          prompt: "tweak",
        },
        getSandboxMock as unknown as typeof getSandboxMock,
        builder,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previewError).toBeDefined();
      expect(result.previewError).not.toMatch(/art_v1_/);
      expect(result.previewError).toMatch(/\[REDACTED\]/);
    }
  });
});
