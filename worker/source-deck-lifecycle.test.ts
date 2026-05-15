/**
 * Tests for `worker/source-deck-lifecycle.ts` (issue #247 / PRD #242).
 *
 * Two surfaces under test:
 *
 *   1. `runArchiveSourceDeck` — the Cloudflare-Sandbox-backed executor
 *      that clones slide-of-hand, moves `src/decks/public/<slug>/` to
 *      `src/decks/archive/<slug>/`, runs the test gate, pushes a
 *      branch, opens a draft PR, and persists a pending source-action
 *      record to KV.
 *
 *   2. `handleSourceDeckLifecycle` — the HTTP router that owns
 *      `POST /api/admin/source-decks/<slug>/archive`.
 *
 * Every Sandbox/GitHub collaborator is mocked. No real network. The
 * orchestrator's value here is the SEQUENCE — clone → verify → move →
 * gate → commit → PR → KV write — and each failure-mode short-circuit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

const {
  cloneRepoIntoSandboxMock,
  runSandboxTestGateMock,
  commitAndPushInSandboxMock,
} = vi.hoisted(() => ({
  cloneRepoIntoSandboxMock: vi.fn(),
  runSandboxTestGateMock: vi.fn(),
  commitAndPushInSandboxMock: vi.fn(),
}));
vi.mock("./sandbox-source-edit", () => ({
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

const { getSandboxMock } = vi.hoisted(() => ({
  getSandboxMock: vi.fn(),
}));
vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: getSandboxMock,
}));

import {
  handleSourceDeckLifecycle,
  runArchiveSourceDeck,
  type SourceDeckLifecycleEnv,
} from "./source-deck-lifecycle";

// ── Helpers ──────────────────────────────────────────────────────────

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (type === "json") {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function makeEnv(): SourceDeckLifecycleEnv {
  return {
    Sandbox: {} as unknown as SourceDeckLifecycleEnv["Sandbox"],
    DECKS: makeKv(),
    GITHUB_TOKENS: {} as KVNamespace,
  };
}

type ExecResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** Build a Sandbox stub with a programmable `exec`. */
function makeSandboxStub(): {
  exec: ReturnType<
    typeof vi.fn<(cmd: string, opts?: unknown) => Promise<ExecResult>>
  >;
} {
  return {
    exec: vi.fn(async (_cmd: string, _opts?: unknown): Promise<ExecResult> => ({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
    })),
  };
}

/**
 * Default `exec` behaviour for archive: the executor probes for
 * existence of the source folder + non-existence of the archive
 * folder before performing the move. Hook those up so the happy-path
 * by default returns "public exists, archive does NOT exist".
 *
 * `runArchiveSourceDeck` is expected to issue execs that:
 *   1. test -d src/decks/public/<slug>            → exit 0 (exists)
 *   2. test -d src/decks/archive/<slug>           → exit 1 (does not)
 *   3. mkdir -p src/decks/archive && git mv ...   → exit 0
 *
 * We model that as a sequence of mock resolves so the FIRST `test -d`
 * succeeds, the SECOND fails, then mkdir/mv succeeds. The test files
 * inspect `sandbox.exec.mock.calls` to verify the right commands ran.
 */
function setHappyPathExec(sandbox: ReturnType<typeof makeSandboxStub>) {
  sandbox.exec.mockImplementation(async (cmd: string) => {
    if (cmd.startsWith("test -d src/decks/public/")) {
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    }
    if (cmd.startsWith("test -d src/decks/archive/")) {
      return { success: false, exitCode: 1, stdout: "", stderr: "" };
    }
    return { success: true, exitCode: 0, stdout: "", stderr: "" };
  });
}

function setHappyPathMocks(): {
  sandbox: ReturnType<typeof makeSandboxStub>;
} {
  getStoredGitHubTokenMock.mockResolvedValue({
    token: "ghu_xxx",
    username: "alice-gh",
    userId: 1,
    scopes: ["public_repo"],
    connectedAt: 0,
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
    branch: "archive/hello-1700000000000",
  });
  openPullRequestMock.mockResolvedValue({
    ok: true,
    result: {
      number: 247,
      htmlUrl: "https://github.com/mcdays94/slide-of-hand/pull/247",
      nodeId: "PR_kw",
      head: "archive/hello-1700000000000",
      base: "main",
    },
  });
  const sandbox = makeSandboxStub();
  setHappyPathExec(sandbox);
  getSandboxMock.mockReturnValue(
    sandbox as unknown as ReturnType<typeof getSandboxMock>,
  );
  return { sandbox };
}

beforeEach(() => {
  cloneRepoIntoSandboxMock.mockReset();
  runSandboxTestGateMock.mockReset();
  commitAndPushInSandboxMock.mockReset();
  openPullRequestMock.mockReset();
  getStoredGitHubTokenMock.mockReset();
  getSandboxMock.mockReset();
});

// ── runArchiveSourceDeck — happy path ────────────────────────────────

describe("runArchiveSourceDeck — happy path", () => {
  it("walks the full sequence and returns PR URL + branch", async () => {
    setHappyPathMocks();
    const env = makeEnv();
    const result = await runArchiveSourceDeck(env, {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prNumber).toBe(247);
      expect(result.prUrl).toBe(
        "https://github.com/mcdays94/slide-of-hand/pull/247",
      );
      expect(result.branch).toBe("archive/hello-1700000000000");
    }
    expect(getStoredGitHubTokenMock).toHaveBeenCalledTimes(1);
    expect(cloneRepoIntoSandboxMock).toHaveBeenCalledTimes(1);
    expect(runSandboxTestGateMock).toHaveBeenCalledTimes(1);
    expect(commitAndPushInSandboxMock).toHaveBeenCalledTimes(1);
    expect(openPullRequestMock).toHaveBeenCalledTimes(1);
  });

  it("issues `git mv` for src/decks/public/<slug> → src/decks/archive/<slug> inside the cloned workdir", async () => {
    const { sandbox } = setHappyPathMocks();
    await runArchiveSourceDeck(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    const execCalls = sandbox.exec.mock.calls.map((c) => String(c[0]));
    // Move command runs the rename — check it references both paths.
    const moveCall = execCalls.find((c) => c.includes("git mv"));
    expect(moveCall).toBeDefined();
    if (moveCall) {
      expect(moveCall).toContain("src/decks/public/hello");
      expect(moveCall).toContain("src/decks/archive/hello");
    }
    // mkdir -p the archive parent first so the rename lands cleanly
    // when the archive folder hasn't been created yet.
    expect(execCalls.some((c) => c.includes("mkdir -p src/decks/archive"))).toBe(
      true,
    );
  });

  it("opens the PR as a draft against TARGET_REPO with archive title + body referencing #247/#242", async () => {
    setHappyPathMocks();
    await runArchiveSourceDeck(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    expect(openPullRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: true,
        base: "main",
        title: expect.stringContaining("archive"),
      }),
    );
    const call = openPullRequestMock.mock.calls[0][0] as {
      title: string;
      body: string;
    };
    expect(call.title).toMatch(/hello/);
    expect(call.body).toMatch(/#247|#242/);
  });

  it("uses a deterministic branch name shape `archive/<slug>-<timestamp>`", async () => {
    setHappyPathMocks();
    const now = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    try {
      await runArchiveSourceDeck(makeEnv(), {
        userEmail: "alice@example.com",
        slug: "hello",
      });
    } finally {
      now.mockRestore();
    }
    const [, opts] = commitAndPushInSandboxMock.mock.calls[0];
    expect(opts.branchName).toBe("archive/hello-1700000000000");
    expect(opts.commitMessage).toMatch(/archive/i);
    expect(opts.commitMessage).toMatch(/hello/);
  });

  it("persists a pending source-action record in KV with action=archive, expectedState=archived, prUrl, slug, createdAt", async () => {
    setHappyPathMocks();
    const env = makeEnv();
    await runArchiveSourceDeck(env, {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    const putCalls = (env.DECKS.put as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    const recordCall = putCalls.find(
      (c: unknown[]) => String(c[0]) === "pending-source-action:hello",
    );
    expect(recordCall).toBeDefined();
    const payload = JSON.parse(String(recordCall![1])) as {
      slug: string;
      action: string;
      expectedState: string;
      prUrl: string;
      createdAt: string;
    };
    expect(payload).toMatchObject({
      slug: "hello",
      action: "archive",
      expectedState: "archived",
      prUrl: "https://github.com/mcdays94/slide-of-hand/pull/247",
    });
    expect(typeof payload.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(payload.createdAt))).toBe(false);
    // Also writes to the index so `usePendingSourceActions` picks it up.
    const indexCall = putCalls.find(
      (c: unknown[]) => String(c[0]) === "pending-source-actions-list",
    );
    expect(indexCall).toBeDefined();
    expect(JSON.parse(String(indexCall![1]))).toContain("hello");
  });
});

// ── runArchiveSourceDeck — error phases ──────────────────────────────

describe("runArchiveSourceDeck — error phases", () => {
  it("returns phase:auth when there's no authenticated user", async () => {
    setHappyPathMocks();
    const result = await runArchiveSourceDeck(makeEnv(), {
      userEmail: "   ",
      slug: "hello",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("auth");
  });

  it("returns phase:invalid_slug when the slug is malformed", async () => {
    setHappyPathMocks();
    const result = await runArchiveSourceDeck(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "../etc/passwd",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.phase).toBe("invalid_slug");
  });

  it("returns phase:github_token when the user hasn't connected GitHub", async () => {
    setHappyPathMocks();
    getStoredGitHubTokenMock.mockResolvedValue(null);
    const result = await runArchiveSourceDeck(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("github_token");
      expect(result.error).toMatch(/connect GitHub/i);
    }
  });

  it("returns phase:clone_github when the clone fails", async () => {
    setHappyPathMocks();
    cloneRepoIntoSandboxMock.mockResolvedValue({
      ok: false,
      error: "permission denied",
    });
    const result = await runArchiveSourceDeck(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("clone_github");
      expect(result.error).toMatch(/permission denied/);
    }
  });

  it("returns phase:source_missing when src/decks/public/<slug>/ does not exist on main", async () => {
    setHappyPathMocks();
    // Override default exec so the source-folder probe fails.
    const sandbox = makeSandboxStub();
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("test -d src/decks/public/")) {
        return { success: false, exitCode: 1, stdout: "", stderr: "" };
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    });
    getSandboxMock.mockReturnValue(
      sandbox as unknown as ReturnType<typeof getSandboxMock>,
    );
    const env = makeEnv();
    const result = await runArchiveSourceDeck(env, {
      userEmail: "alice@example.com",
      slug: "nonexistent",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("source_missing");
      expect(result.error).toMatch(/src\/decks\/public\/nonexistent/);
    }
    // No PR opened, no KV write — the action short-circuited.
    expect(openPullRequestMock).not.toHaveBeenCalled();
    const putCalls = (env.DECKS.put as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(putCalls.find((c: unknown[]) =>
      String(c[0]).startsWith("pending-source-action:"),
    )).toBeUndefined();
  });

  it("returns phase:archive_exists when src/decks/archive/<slug>/ already exists", async () => {
    setHappyPathMocks();
    const sandbox = makeSandboxStub();
    sandbox.exec.mockImplementation(async (cmd: string) => {
      // Source folder exists AND archive folder ALSO exists.
      if (cmd.startsWith("test -d ")) {
        return { success: true, exitCode: 0, stdout: "", stderr: "" };
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    });
    getSandboxMock.mockReturnValue(
      sandbox as unknown as ReturnType<typeof getSandboxMock>,
    );
    const env = makeEnv();
    const result = await runArchiveSourceDeck(env, {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("archive_exists");
      expect(result.error).toMatch(/src\/decks\/archive\/hello/);
    }
    expect(openPullRequestMock).not.toHaveBeenCalled();
    const putCalls = (env.DECKS.put as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(putCalls.find((c: unknown[]) =>
      String(c[0]).startsWith("pending-source-action:"),
    )).toBeUndefined();
  });

  it("returns phase:move when the git mv exits non-zero", async () => {
    setHappyPathMocks();
    const sandbox = makeSandboxStub();
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("test -d src/decks/public/")) {
        return { success: true, exitCode: 0, stdout: "", stderr: "" };
      }
      if (cmd.startsWith("test -d src/decks/archive/")) {
        return { success: false, exitCode: 1, stdout: "", stderr: "" };
      }
      if (cmd.includes("git mv")) {
        return {
          success: false,
          exitCode: 128,
          stdout: "",
          stderr: "fatal: bad source",
        };
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    });
    getSandboxMock.mockReturnValue(
      sandbox as unknown as ReturnType<typeof getSandboxMock>,
    );
    const result = await runArchiveSourceDeck(makeEnv(), {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("move");
      expect(result.error).toMatch(/bad source/);
    }
  });

  it("returns phase:test_gate when the gate fails and does NOT open a PR or write a pending record", async () => {
    setHappyPathMocks();
    runSandboxTestGateMock.mockResolvedValue({
      ok: false,
      failedPhase: "typecheck",
      phases: [
        { phase: "install", ok: true, command: "npm ci", stdout: "", stderr: "", exitCode: 0 },
        { phase: "typecheck", ok: false, command: "npm run typecheck", stdout: "", stderr: "TS2304", exitCode: 1 },
      ],
    });
    const env = makeEnv();
    const result = await runArchiveSourceDeck(env, {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("test_gate");
      expect(result.failedTestGatePhase).toBe("typecheck");
    }
    expect(openPullRequestMock).not.toHaveBeenCalled();
    const putCalls = (env.DECKS.put as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(putCalls.find((c: unknown[]) =>
      String(c[0]).startsWith("pending-source-action:"),
    )).toBeUndefined();
  });

  it("returns phase:github_push when the commit/push fails", async () => {
    setHappyPathMocks();
    commitAndPushInSandboxMock.mockResolvedValue({
      ok: false,
      error: "remote rejected",
    });
    const env = makeEnv();
    const result = await runArchiveSourceDeck(env, {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("github_push");
      expect(result.error).toMatch(/remote rejected/);
    }
    expect(openPullRequestMock).not.toHaveBeenCalled();
    const putCalls = (env.DECKS.put as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(putCalls.find((c: unknown[]) =>
      String(c[0]).startsWith("pending-source-action:"),
    )).toBeUndefined();
  });

  it("returns phase:open_pr when the GitHub PR API rejects the request, and does NOT persist a pending record", async () => {
    setHappyPathMocks();
    openPullRequestMock.mockResolvedValue({
      ok: false,
      kind: "rate_limited",
      message: "API rate limit exceeded",
    });
    const env = makeEnv();
    const result = await runArchiveSourceDeck(env, {
      userEmail: "alice@example.com",
      slug: "hello",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("open_pr");
      expect(result.error).toMatch(/rate limit/);
    }
    const putCalls = (env.DECKS.put as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(putCalls.find((c: unknown[]) =>
      String(c[0]).startsWith("pending-source-action:"),
    )).toBeUndefined();
  });
});

// ── handleSourceDeckLifecycle — HTTP router ─────────────────────────

describe("handleSourceDeckLifecycle — POST /api/admin/source-decks/<slug>/archive", () => {
  function buildRequest(
    slug: string,
    init: { withAuth?: boolean; method?: string } = {},
  ): Request {
    const headers: Record<string, string> = {};
    if (init.withAuth !== false) {
      headers["cf-access-authenticated-user-email"] = "alice@example.com";
    }
    return new Request(
      `https://example.com/api/admin/source-decks/${slug}/archive`,
      {
        method: init.method ?? "POST",
        headers,
      },
    );
  }

  it("returns 403 when Access auth is missing", async () => {
    setHappyPathMocks();
    const res = await handleSourceDeckLifecycle(
      buildRequest("hello", { withAuth: false }),
      makeEnv(),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns 200 + { ok, prUrl, branch, prNumber, action } on success", async () => {
    setHappyPathMocks();
    const res = await handleSourceDeckLifecycle(
      buildRequest("hello"),
      makeEnv(),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      ok: boolean;
      prUrl: string;
      branch: string;
      prNumber: number;
      action: string;
    };
    expect(body.ok).toBe(true);
    expect(body.prUrl).toBe(
      "https://github.com/mcdays94/slide-of-hand/pull/247",
    );
    expect(body.branch).toBe("archive/hello-1700000000000");
    expect(body.prNumber).toBe(247);
    expect(body.action).toBe("archive");
  });

  it("returns 409 with `connect GitHub` copy when the user has no stored GitHub token", async () => {
    setHappyPathMocks();
    getStoredGitHubTokenMock.mockResolvedValue(null);
    const res = await handleSourceDeckLifecycle(
      buildRequest("hello"),
      makeEnv(),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(409);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toMatch(/connect GitHub/i);
  });

  it("returns 400 with `source missing` when the deck folder doesn't exist on main", async () => {
    setHappyPathMocks();
    const sandbox = makeSandboxStub();
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("test -d src/decks/public/")) {
        return { success: false, exitCode: 1, stdout: "", stderr: "" };
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    });
    getSandboxMock.mockReturnValue(
      sandbox as unknown as ReturnType<typeof getSandboxMock>,
    );
    const res = await handleSourceDeckLifecycle(
      buildRequest("ghost"),
      makeEnv(),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { error: string; phase: string };
    expect(body.phase).toBe("source_missing");
  });

  it("returns 400 with the gate's failed phase when test_gate fails", async () => {
    setHappyPathMocks();
    runSandboxTestGateMock.mockResolvedValue({
      ok: false,
      failedPhase: "test",
      phases: [],
    });
    const res = await handleSourceDeckLifecycle(
      buildRequest("hello"),
      makeEnv(),
    );
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { error: string; phase: string };
    expect(body.phase).toBe("test_gate");
  });

  it("returns 405 on non-POST methods", async () => {
    const res = await handleSourceDeckLifecycle(
      buildRequest("hello", { method: "GET" }),
      makeEnv(),
    );
    expect(res!.status).toBe(405);
  });

  it("returns 400 on a malformed slug", async () => {
    const res = await handleSourceDeckLifecycle(
      buildRequest("BAD_SLUG"),
      makeEnv(),
    );
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toMatch(/slug/i);
  });

  it("falls through (returns null) on non-matching paths", async () => {
    const req = new Request("https://example.com/api/admin/something-else", {
      method: "POST",
      headers: { "cf-access-authenticated-user-email": "alice@example.com" },
    });
    const res = await handleSourceDeckLifecycle(req, makeEnv());
    expect(res).toBeNull();
  });
});
