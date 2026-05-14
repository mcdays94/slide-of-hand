/**
 * Unit tests for the agent tool definitions (issue #131 phases 2, 3a, 3b).
 *
 * Two-tier coverage:
 *   - The legacy phase-2 surface (`readDeck`, `proposePatch`) is
 *     tested through `buildTools(env, slug)` + `tool.execute({}, opts)`
 *     direct invocation.
 *   - Phase-3 additions (`commitPatch`, `listSourceTree`, `readSource`)
 *     use the exported `run*` helper variants so we can pass an
 *     `emailOverride` instead of going through `getCurrentAgent()`.
 *     The `agents` package is also mocked at the top so the test
 *     suite doesn't try to resolve `cloudflare:workers` URL schemes.
 *
 * The end-to-end "model actually calls these tools and the chat UI
 * renders them" loop is covered by the manual production e2e test
 * (see the PR description).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub `agents` at import time — same reason as `worker/agent.test.ts`:
// the package transitively pulls in `cloudflare:workers` which only
// resolves inside the Workers runtime, not happy-dom. We re-export
// `getCurrentAgent` because `currentUserEmail` calls it. Type the
// mock with the same shape the SDK's real `getCurrentAgent` returns
// (`AgentContextStore`) so per-test `mockReturnValueOnce` calls can
// pass a `Request` for `request` or a `Connection`-shaped object for
// `connection` without TypeScript narrowing the default to literal
// `undefined`.
const { getCurrentAgentMock } = vi.hoisted(() => ({
  getCurrentAgentMock: vi.fn(
    (): {
      agent: unknown;
      connection: unknown;
      request: Request | undefined;
      email: unknown;
    } => ({
      agent: undefined,
      connection: undefined,
      request: undefined,
      email: undefined,
    }),
  ),
}));
vi.mock("agents", () => ({
  getCurrentAgent: getCurrentAgentMock,
}));

// `@cloudflare/sandbox` transitively pulls in `@cloudflare/containers`
// which uses `cloudflare:workers` schemes + extensionless ESM imports
// that don't resolve outside the Workers runtime. We never invoke the
// real `getSandbox` here — tests pass a `getSandboxFn` override into
// `runProposeSourceEdit` — so a stub export is enough.
const { getSandboxStub } = vi.hoisted(() => ({
  getSandboxStub: vi.fn(() => {
    throw new Error(
      "Real getSandbox should never be called from agent-tools tests — " +
        "tests must pass the `getSandboxFn` override.",
    );
  }),
}));
vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: getSandboxStub,
}));

// Mock the `github-client` so test runs don't hit the real GitHub API.
const githubClientMock = vi.hoisted(() => ({
  listContents: vi.fn(),
  readFileContents: vi.fn(),
  putFileContents: vi.fn(),
  TARGET_REPO: { owner: "mcdays94", repo: "slide-of-hand" },
  DEFAULT_BRANCH: "main",
  dataDeckPath: (slug: string) => `data-decks/${slug}.json`,
  // Mirror the production constant so consumers that import it
  // (e.g. `runCommitPatch` for the committer identity) get the same
  // shape under test. See `worker/github-client.ts` for the
  // "Cutindah" post-mortem.
  SLIDE_OF_HAND_COMMIT_IDENTITY: {
    name: "mcdays94",
    email: "amtccdias@gmail.com",
  },
}));
vi.mock("./github-client", () => githubClientMock);

// Mock `github-oauth.getStoredGitHubToken` so tests can control whether
// the OAuth lookup returns a token.
const githubOauthMock = vi.hoisted(() => ({
  getStoredGitHubToken: vi.fn(),
}));
vi.mock("./github-oauth", () => githubOauthMock);

import {
  buildTools,
  currentUserEmail,
  runCommitPatch,
  runListSourceTree,
  runReadSource,
  type AgentToolsEnv,
  type CommitPatchResult,
  type ListSourceTreeResult,
  type ProposePatchResult,
  type ReadDeckResult,
  type ReadSourceResult,
} from "./agent-tools";
import type { DataDeck } from "../src/lib/deck-record";

// The AI SDK's `tool().execute` is typed as `Promise | AsyncIterable | T`
// because tools CAN stream outputs. Our tools always return a plain
// promise, so we narrow the call-sites with these helpers. Keeps the
// test assertions clean (no `if (Symbol.asyncIterator in result)`).
async function callReadDeck(
  tool: ReturnType<typeof buildTools>["readDeck"],
): Promise<ReadDeckResult> {
  return (await tool.execute!({}, toolOpts)) as ReadDeckResult;
}
async function callProposePatch(
  tool: ReturnType<typeof buildTools>["proposePatch"],
  input: Parameters<NonNullable<typeof tool.execute>>[0],
): Promise<ProposePatchResult> {
  return (await tool.execute!(input, toolOpts)) as ProposePatchResult;
}

// ---------------------------------------------------------------- //
// Test helpers
// ---------------------------------------------------------------- //

/**
 * Build a minimal mock KVNamespace that records puts and serves the
 * provided record from `get`. We only stub the surface the tools
 * actually touch (`get`, `put`) — everything else throws so an
 * unexpected call is loud, not silent.
 */
function makeKV(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>(
    Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]),
  );
  const puts: Array<{ key: string; value: string }> = [];
  const kv = {
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (type === "json") return JSON.parse(raw);
      return raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      puts.push({ key, value });
      store.set(key, value);
    }),
    delete: vi.fn(async () => {
      throw new Error("KV.delete should not be called by tools");
    }),
    list: vi.fn(async () => {
      throw new Error("KV.list should not be called by tools");
    }),
  } as unknown as KVNamespace;
  return { kv, puts, store };
}

function makeEnv(initial: Record<string, unknown> = {}): {
  env: AgentToolsEnv;
  puts: Array<{ key: string; value: string }>;
} {
  const { kv, puts } = makeKV(initial);
  // `GITHUB_TOKENS` KV is a real KV in production, but the tools
  // never call it directly — they go through `getStoredGitHubToken`
  // (mocked at top). A bare stub is enough for the type system.
  const githubTokens = {} as unknown as KVNamespace;
  // `Sandbox` DO namespace (issue #131 phase 3c) — used by
  // `proposeSourceEdit`. The tests that exercise that runner pass a
  // mock `getSandboxFn` override so this binding never gets touched;
  // a bare stub satisfies the type.
  const sandbox = {} as unknown as AgentToolsEnv["Sandbox"];
  // Issue #168 Wave 1 — `createDeckDraft` + `iterateOnDeckDraft` need
  // ARTIFACTS + AI. Tests that exercise those tools pass mock impls;
  // the rest of the suite just needs the type-system stubs.
  const artifacts = {} as unknown as Artifacts;
  const ai = {} as unknown as Ai;
  return {
    env: {
      DECKS: kv,
      GITHUB_TOKENS: githubTokens,
      Sandbox: sandbox,
      ARTIFACTS: artifacts,
      AI: ai,
      // Stable test value — matches what the deck-creation tests use
      // for verifying the constructed Artifacts remote URL.
      CF_ACCOUNT_ID: "test-account-id-32chars-of-hex00",
    },
    puts,
  };
}

/** Minimum valid deck — keep around for shared base fixture. */
const validDeck: DataDeck = {
  meta: {
    slug: "test-deck",
    title: "Test Deck",
    date: "2026-05-10",
    visibility: "private",
  },
  slides: [
    {
      id: "intro",
      template: "title",
      slots: {},
    },
  ],
};

/**
 * Build a `ToolExecutionOptions` stand-in. Real callers pass an
 * abortSignal + messages + toolCallId; the tools we ship don't touch
 * any of those, so a stub `toolCallId` is enough.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toolOpts = { toolCallId: "test-call", messages: [] } as any;

// ---------------------------------------------------------------- //
// Spec
// ---------------------------------------------------------------- //

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTools", () => {
  it("exposes readDeck + proposePatch with descriptions", () => {
    const { env } = makeEnv();
    const tools = buildTools(env, "test-deck");
    expect(tools.readDeck.description).toMatch(/read.*current deck/i);
    expect(tools.proposePatch.description).toMatch(/dry-run|persist/i);
    expect(typeof tools.readDeck.execute).toBe("function");
    expect(typeof tools.proposePatch.execute).toBe("function");
  });
});

describe("readDeck", () => {
  it("returns the parsed deck when KV has it", async () => {
    const { env } = makeEnv({ "deck:test-deck": validDeck });
    const tools = buildTools(env, "test-deck");
    const result = await callReadDeck(tools.readDeck);
    expect(result).toEqual({ found: true, deck: validDeck });
  });

  it("returns found: false when KV is empty (build-time deck)", async () => {
    const { env } = makeEnv();
    const tools = buildTools(env, "hello");
    const result = await callReadDeck(tools.readDeck);
    expect(result).toMatchObject({ found: false });
    // Reason should mention build-time / JSX so the model can
    // explain the limitation to the user accurately.
    if (result.found === false && "reason" in result) {
      expect(result.reason).toMatch(/build-time|JSX|data/i);
    } else {
      throw new Error("expected reason field on found:false");
    }
  });

  it("keys the KV lookup by `deck:<slug>` (instance name)", async () => {
    const { env } = makeEnv({ "deck:my-deck": validDeck });
    const tools = buildTools(env, "my-deck");
    await callReadDeck(tools.readDeck);
    expect(env.DECKS.get).toHaveBeenCalledWith("deck:my-deck", "json");
  });

  it("surfaces a validation error when the stored deck is malformed", async () => {
    // Stored deck is missing the required `meta.title` — would never
    // happen via the write endpoint (which uses the same validator)
    // but belt-and-braces.
    const { env } = makeEnv({
      "deck:test-deck": {
        meta: {
          slug: "test-deck",
          date: "2026-05-10",
          visibility: "public",
        },
        slides: [],
      },
    });
    const tools = buildTools(env, "test-deck");
    const result = await callReadDeck(tools.readDeck);
    expect(result.found).toBe(false);
    if (result.found === false && "error" in result) {
      expect(result.error).toMatch(/title/);
    } else {
      throw new Error("expected error field on validation failure");
    }
  });

  it("wraps a thrown KV error into a found:false response", async () => {
    const { env } = makeEnv();
    // Replace .get with a rejecting stub
    (env.DECKS.get as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("KV unavailable"),
    );
    const tools = buildTools(env, "test-deck");
    const result = await callReadDeck(tools.readDeck);
    expect(result).toMatchObject({
      found: false,
      error: expect.stringMatching(/KV unavailable/),
    });
  });
});

describe("proposePatch", () => {
  it("returns the dry-run merged deck when patch is valid", async () => {
    const { env, puts } = makeEnv({ "deck:test-deck": validDeck });
    const tools = buildTools(env, "test-deck");
    const result = await callProposePatch(tools.proposePatch, {
      patch: { meta: { title: "Renamed Deck" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun.meta.title).toBe("Renamed Deck");
      // Other meta fields preserved by shallow merge.
      expect(result.dryRun.meta.slug).toBe("test-deck");
      expect(result.dryRun.meta.visibility).toBe("private");
      // Slides preserved when patch doesn't supply them.
      expect(result.dryRun.slides).toEqual(validDeck.slides);
    }
    // Critical: nothing got written.
    expect(puts).toEqual([]);
  });

  it("replaces slides wholesale when patch.slides is provided", async () => {
    const { env } = makeEnv({ "deck:test-deck": validDeck });
    const tools = buildTools(env, "test-deck");
    const newSlides = [
      { id: "welcome", template: "title", slots: {} },
      { id: "agenda", template: "list", slots: {} },
    ];
    const result = await callProposePatch(tools.proposePatch, {
      patch: { slides: newSlides },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun.slides).toEqual(newSlides);
      // Meta untouched.
      expect(result.dryRun.meta).toEqual(validDeck.meta);
    }
  });

  it("returns errors when the resulting deck would be invalid", async () => {
    const { env } = makeEnv({ "deck:test-deck": validDeck });
    const tools = buildTools(env, "test-deck");
    // visibility="invisible" isn't a valid Visibility — the
    // shared validator should reject the merge.
    const result = await callProposePatch(tools.proposePatch, {
      patch: { meta: { visibility: "invisible" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "errors" in result) {
      expect(result.errors.join(" ")).toMatch(/visibility/);
    } else {
      throw new Error("expected errors array on invalid patch");
    }
  });

  it("returns errors when patch.slides contains an invalid slide", async () => {
    const { env } = makeEnv({ "deck:test-deck": validDeck });
    const tools = buildTools(env, "test-deck");
    const result = await callProposePatch(tools.proposePatch, {
      patch: {
        // missing required `template`
        slides: [{ id: "bad", slots: {} }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "errors" in result) {
      expect(result.errors.join(" ")).toMatch(/template/);
    }
  });

  it("does NOT write to KV under ANY path (success or failure)", async () => {
    const { env, puts } = makeEnv({ "deck:test-deck": validDeck });
    const tools = buildTools(env, "test-deck");
    await callProposePatch(tools.proposePatch, {
      patch: { meta: { title: "Valid Update" } },
    });
    await callProposePatch(tools.proposePatch, {
      patch: { meta: { visibility: "invalid-value" } },
    });
    expect(env.DECKS.put).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
  });

  it("returns an error when no KV deck exists for the slug", async () => {
    // Empty KV — calling proposePatch on a build-time-only slug.
    const { env } = makeEnv();
    const tools = buildTools(env, "hello");
    const result = await callProposePatch(tools.proposePatch, {
      patch: { meta: { title: "Anything" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "error" in result) {
      expect(result.error).toMatch(/data deck|KV/i);
    }
  });

  it("rejects an empty patch with no actual changes IFF it would invalidate (otherwise echoes deck)", async () => {
    // An empty patch should merge to the current deck unchanged.
    // This is fine — the dry-run is identical to the current state
    // and the model/user can decide that's a no-op.
    const { env } = makeEnv({ "deck:test-deck": validDeck });
    const tools = buildTools(env, "test-deck");
    const result = await callProposePatch(tools.proposePatch, {
      patch: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toEqual(validDeck);
    }
  });
});

// ─── Phase 3a — commitPatch ──────────────────────────────────────────

describe("commitPatch", () => {
  beforeEach(() => {
    githubOauthMock.getStoredGitHubToken.mockReset();
    githubClientMock.putFileContents.mockReset();
  });

  it("writes the validated dry-run to KV", async () => {
    const { env, puts } = makeEnv({ "deck:test-deck": validDeck });
    // No GitHub token stored — backup should be skipped, KV write still succeeds.
    githubOauthMock.getStoredGitHubToken.mockResolvedValue(null);

    const result = (await runCommitPatch(
      env,
      "test-deck",
      { meta: { title: "Updated via Agent" } },
      undefined,
      "alice@cloudflare.com",
    )) as CommitPatchResult;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.persistedToKv).toBe(true);
    expect(result.deck.meta.title).toBe("Updated via Agent");
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe("deck:test-deck");
    expect(JSON.parse(puts[0].value).meta.title).toBe("Updated via Agent");
  });

  it("returns ok:false errors when the patch fails validation (KV untouched)", async () => {
    const { env, puts } = makeEnv({ "deck:test-deck": validDeck });
    githubOauthMock.getStoredGitHubToken.mockResolvedValue(null);

    const result = (await runCommitPatch(
      env,
      "test-deck",
      { meta: { visibility: "invisible" } },
      undefined,
      "alice@cloudflare.com",
    )) as CommitPatchResult;

    expect(result.ok).toBe(false);
    expect(puts).toEqual([]);
    expect(githubClientMock.putFileContents).not.toHaveBeenCalled();
  });

  it("commits to GitHub when the user has a stored token", async () => {
    const { env } = makeEnv({ "deck:test-deck": validDeck });
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "gho_xyz",
      username: "alice-gh",
      userId: 42,
      scopes: ["public_repo"],
      connectedAt: 0,
    });
    githubClientMock.putFileContents.mockResolvedValue({
      ok: true,
      result: {
        commitSha: "abc123",
        commitHtmlUrl: "https://github.com/mcdays94/slide-of-hand/commit/abc123",
        contentSha: "def456",
        path: "data-decks/test-deck.json",
      },
    });

    const result = (await runCommitPatch(
      env,
      "test-deck",
      { meta: { title: "Updated" } },
      "Custom commit message",
      "alice@cloudflare.com",
    )) as CommitPatchResult;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.githubCommit.ok).toBe(true);
    if (!result.githubCommit.ok) throw new Error("expected gh ok");
    expect(result.githubCommit.commitSha).toBe("abc123");
    expect(result.githubCommit.commitHtmlUrl).toContain("github.com");

    // Verify the right things were passed to the GH client.
    const call = githubClientMock.putFileContents.mock.calls[0];
    expect(call[0]).toBe("gho_xyz");
    const options = call[1];
    expect(options.path).toBe("data-decks/test-deck.json");
    expect(options.message).toBe("Custom commit message");
    expect(JSON.parse(options.content).meta.title).toBe("Updated");
    // Committer is PINNED to the project owner — see
    // `SLIDE_OF_HAND_COMMIT_IDENTITY` in `worker/github-client.ts`
    // for the "Cutindah" post-mortem.
    expect(options.committer?.name).toBe("mcdays94");
    expect(options.committer?.email).toBe("amtccdias@gmail.com");
  });

  it("falls back to a default commit message when none is provided", async () => {
    const { env } = makeEnv({ "deck:test-deck": validDeck });
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "gho_xyz",
      username: "alice-gh",
      userId: 42,
      scopes: ["public_repo"],
      connectedAt: 0,
    });
    githubClientMock.putFileContents.mockResolvedValue({
      ok: true,
      result: {
        commitSha: "sha",
        commitHtmlUrl: "url",
        contentSha: "csha",
        path: "data-decks/test-deck.json",
      },
    });

    await runCommitPatch(
      env,
      "test-deck",
      { meta: { title: "Renamed Deck" } },
      undefined,
      "alice@cloudflare.com",
    );

    const options = githubClientMock.putFileContents.mock.calls[0][1];
    expect(options.message).toContain("Renamed Deck");
    expect(options.message).toContain("agent");
  });

  it("returns githubCommit.ok=false with a friendly reason when GH not connected (KV write still succeeds)", async () => {
    const { env, puts } = makeEnv({ "deck:test-deck": validDeck });
    githubOauthMock.getStoredGitHubToken.mockResolvedValue(null);

    const result = (await runCommitPatch(
      env,
      "test-deck",
      { meta: { title: "Updated" } },
      undefined,
      "alice@cloudflare.com",
    )) as CommitPatchResult;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.persistedToKv).toBe(true);
    expect(result.githubCommit.ok).toBe(false);
    if (result.githubCommit.ok) throw new Error("expected gh not ok");
    expect(result.githubCommit.reason).toMatch(/Settings/);
    expect(puts).toHaveLength(1);
    expect(githubClientMock.putFileContents).not.toHaveBeenCalled();
  });

  it("returns githubCommit.ok=false with a friendly reason when no email (service-token caller)", async () => {
    const { env, puts } = makeEnv({ "deck:test-deck": validDeck });

    const result = (await runCommitPatch(
      env,
      "test-deck",
      { meta: { title: "Updated" } },
      undefined,
      null, // explicitly no email
    )) as CommitPatchResult;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.githubCommit.ok).toBe(false);
    expect(puts).toHaveLength(1);
    expect(githubOauthMock.getStoredGitHubToken).not.toHaveBeenCalled();
  });

  it("surfaces a GH API error without invalidating the KV write", async () => {
    const { env, puts } = makeEnv({ "deck:test-deck": validDeck });
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "gho_xyz",
      username: "alice-gh",
      userId: 42,
      scopes: ["public_repo"],
      connectedAt: 0,
    });
    githubClientMock.putFileContents.mockResolvedValue({
      ok: false,
      kind: "auth",
      message: "GitHub API returned 401 — token revoked",
      status: 401,
    });

    const result = (await runCommitPatch(
      env,
      "test-deck",
      { meta: { title: "Updated" } },
      undefined,
      "alice@cloudflare.com",
    )) as CommitPatchResult;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.githubCommit.ok).toBe(false);
    if (result.githubCommit.ok) throw new Error("expected gh not ok");
    expect(result.githubCommit.reason).toMatch(/401|revoked/);
    // KV write still happened — agent can recover by reconnecting GH.
    expect(puts).toHaveLength(1);
  });
});

// ─── Phase 3b — listSourceTree + readSource ──────────────────────────

describe("listSourceTree", () => {
  beforeEach(() => {
    githubOauthMock.getStoredGitHubToken.mockReset();
    githubClientMock.listContents.mockReset();
  });

  it("returns the items list when the user has a stored token", async () => {
    const { env } = makeEnv();
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "gho_xyz",
      username: "a",
      userId: 1,
      scopes: ["public_repo"],
      connectedAt: 0,
    });
    githubClientMock.listContents.mockResolvedValue({
      ok: true,
      items: [
        {
          name: "01-title.tsx",
          path: "src/decks/public/hello/01-title.tsx",
          type: "file",
          size: 123,
          sha: "aaa",
        },
        {
          name: "lib",
          path: "src/decks/public/hello/lib",
          type: "dir",
          size: 0,
          sha: "bbb",
        },
      ],
    });

    const result = (await runListSourceTree(
      env,
      "src/decks/public/hello",
      undefined,
      "alice@cloudflare.com",
    )) as ListSourceTreeResult;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.path).toBe("src/decks/public/hello");
    expect(result.ref).toBe("main");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      name: "01-title.tsx",
      path: "src/decks/public/hello/01-title.tsx",
      type: "file",
      size: 123,
    });
    expect(githubClientMock.listContents).toHaveBeenCalledWith(
      "gho_xyz",
      "src/decks/public/hello",
      "main",
    );
  });

  it("honours an explicit ref parameter", async () => {
    const { env } = makeEnv();
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "gho_xyz",
      username: "a",
      userId: 1,
      scopes: ["public_repo"],
      connectedAt: 0,
    });
    githubClientMock.listContents.mockResolvedValue({ ok: true, items: [] });

    await runListSourceTree(
      env,
      "src/decks/public/hello",
      "dev",
      "alice@cloudflare.com",
    );
    expect(githubClientMock.listContents).toHaveBeenCalledWith(
      "gho_xyz",
      "src/decks/public/hello",
      "dev",
    );
  });

  it("falls back to 'main' when ref is empty whitespace", async () => {
    const { env } = makeEnv();
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "t",
      username: "a",
      userId: 1,
      scopes: [],
      connectedAt: 0,
    });
    githubClientMock.listContents.mockResolvedValue({ ok: true, items: [] });
    await runListSourceTree(env, "src", "   ", "alice@cloudflare.com");
    expect(githubClientMock.listContents).toHaveBeenCalledWith("t", "src", "main");
  });

  it("returns ok:false when the user has no GitHub connection", async () => {
    const { env } = makeEnv();
    githubOauthMock.getStoredGitHubToken.mockResolvedValue(null);

    const result = (await runListSourceTree(
      env,
      "src",
      undefined,
      "alice@cloudflare.com",
    )) as ListSourceTreeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Settings|Connect/);
    }
    expect(githubClientMock.listContents).not.toHaveBeenCalled();
  });

  it("returns ok:false when no email (service-token context)", async () => {
    const { env } = makeEnv();
    const result = (await runListSourceTree(
      env,
      "src",
      undefined,
      null,
    )) as ListSourceTreeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/authenticated user|Service-token/i);
    }
    expect(githubOauthMock.getStoredGitHubToken).not.toHaveBeenCalled();
  });

  it("forwards a GH API error message to the tool result", async () => {
    const { env } = makeEnv();
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "t",
      username: "a",
      userId: 1,
      scopes: [],
      connectedAt: 0,
    });
    githubClientMock.listContents.mockResolvedValue({
      ok: false,
      kind: "not_found",
      message: "path not found: nonexistent",
    });
    const result = (await runListSourceTree(
      env,
      "nonexistent",
      undefined,
      "alice@cloudflare.com",
    )) as ListSourceTreeResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/nonexistent/);
    }
  });
});

describe("readSource", () => {
  beforeEach(() => {
    githubOauthMock.getStoredGitHubToken.mockReset();
    githubClientMock.readFileContents.mockReset();
  });

  it("returns the file contents when the user has a stored token", async () => {
    const { env } = makeEnv();
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "gho_xyz",
      username: "a",
      userId: 1,
      scopes: ["public_repo"],
      connectedAt: 0,
    });
    githubClientMock.readFileContents.mockResolvedValue({
      ok: true,
      result: {
        content: "export const titleSlide = { id: 'title', ... };",
        size: 50,
        sha: "abc",
        path: "src/decks/public/hello/01-title.tsx",
      },
    });

    const result = (await runReadSource(
      env,
      "src/decks/public/hello/01-title.tsx",
      undefined,
      "alice@cloudflare.com",
    )) as ReadSourceResult;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.path).toBe("src/decks/public/hello/01-title.tsx");
    expect(result.ref).toBe("main");
    expect(result.content).toContain("titleSlide");
    expect(result.sha).toBe("abc");
  });

  it("honours an explicit ref parameter", async () => {
    const { env } = makeEnv();
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "gho_xyz",
      username: "a",
      userId: 1,
      scopes: [],
      connectedAt: 0,
    });
    githubClientMock.readFileContents.mockResolvedValue({
      ok: true,
      result: { content: "x", size: 1, sha: "s", path: "p" },
    });
    await runReadSource(env, "p", "dev", "alice@cloudflare.com");
    expect(githubClientMock.readFileContents).toHaveBeenCalledWith(
      "gho_xyz",
      "p",
      "dev",
    );
  });

  it("returns ok:false when the user has no GitHub connection", async () => {
    const { env } = makeEnv();
    githubOauthMock.getStoredGitHubToken.mockResolvedValue(null);

    const result = (await runReadSource(
      env,
      "src/decks/public/hello/01-title.tsx",
      undefined,
      "alice@cloudflare.com",
    )) as ReadSourceResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Settings|Connect/);
    }
  });

  it("returns ok:false when no email (service-token context)", async () => {
    const { env } = makeEnv();
    const result = (await runReadSource(
      env,
      "src/file.ts",
      undefined,
      null,
    )) as ReadSourceResult;
    expect(result.ok).toBe(false);
  });

  it("forwards a GH read error to the tool result", async () => {
    const { env } = makeEnv();
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "t",
      username: "a",
      userId: 1,
      scopes: [],
      connectedAt: 0,
    });
    githubClientMock.readFileContents.mockResolvedValue({
      ok: false,
      kind: "not_found",
      message: "file not found: src/missing.ts",
    });
    const result = (await runReadSource(
      env,
      "src/missing.ts",
      undefined,
      "alice@cloudflare.com",
    )) as ReadSourceResult;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing/);
    }
  });
});

// ─── Tool exposure assertion — make sure all 8 tools are wired ────────

describe("buildTools — full tool surface", () => {
  it("exposes all eight tools (phase-2 + phase-3 + issue #168 Wave 1)", () => {
    const { env } = makeEnv();
    const tools = buildTools(env, "test-deck");
    expect(tools.readDeck).toBeDefined();
    expect(tools.proposePatch).toBeDefined();
    expect(tools.commitPatch).toBeDefined();
    expect(tools.listSourceTree).toBeDefined();
    expect(tools.readSource).toBeDefined();
    expect(tools.proposeSourceEdit).toBeDefined();
    // Issue #168 Wave 1 — AI-driven deck creation + iteration tools.
    expect(tools.createDeckDraft).toBeDefined();
    expect(tools.iterateOnDeckDraft).toBeDefined();
    // Issue #168 Wave 1 follow-up — publish flow wired post-runPublishDraft.
    expect(tools.publishDraft).toBeDefined();
    // Sanity: each has a description string for the model.
    expect(typeof tools.commitPatch.description).toBe("string");
    expect(typeof tools.listSourceTree.description).toBe("string");
    expect(typeof tools.readSource.description).toBe("string");
    expect(typeof tools.proposeSourceEdit.description).toBe("string");
    expect(typeof tools.createDeckDraft.description).toBe("string");
    expect(typeof tools.iterateOnDeckDraft.description).toBe("string");
    expect(typeof tools.publishDraft.description).toBe("string");
    // The publishDraft description should reference the publish flow's
    // hallmarks so the model can recognise when to call it.
    expect(tools.publishDraft.description).toMatch(/publish/i);
    expect(tools.publishDraft.description).toMatch(/draft/i);
  });
});

// ─── runProposeSourceEdit — issue #131 phase 3c slice 6 ─────────────
//
// The orchestrator. Composes the five helpers (cloneRepoIntoSandbox,
// applyFilesIntoSandbox, runSandboxTestGate, commitAndPushInSandbox,
// openPullRequest) plus the existing auth + token-lookup logic. Tests
// here don't re-exercise each helper's failure modes — those have
// their own unit tests; here we verify the orchestration: did the
// right step run after the right precondition, and did each failure
// surface with the right `phase` discriminant on the result.
//
// We mock the helpers themselves (not the SandboxLike surface) so the
// tests can drive each step's outcome directly without re-doing the
// Sandbox-mock dance for each scenario.

const { sandboxStub, getSandboxFn } = vi.hoisted(() => {
  // The helpers type against the narrow SandboxLike (4 methods);
  // `runProposeSourceEdit` types against the full Sandbox via
  // `GetSandboxFn`. The stub satisfies the narrow surface — and we
  // never invoke methods that aren't on it because the helpers are
  // all mocked. The double-cast through unknown is the price of
  // letting prod-code stay typed against the full SDK class.
  const sandboxStub = {} as unknown as Parameters<
    typeof import("./sandbox-source-edit").cloneRepoIntoSandbox
  >[0];
  return {
    sandboxStub,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getSandboxFn: vi.fn(() => sandboxStub) as any,
  };
});

const sandboxSourceEditMock = vi.hoisted(() => ({
  cloneRepoIntoSandbox: vi.fn(),
  applyFilesIntoSandbox: vi.fn(),
  runSandboxTestGate: vi.fn(),
  commitAndPushInSandbox: vi.fn(),
}));
vi.mock("./sandbox-source-edit", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./sandbox-source-edit")
  >();
  return {
    ...actual,
    cloneRepoIntoSandbox: sandboxSourceEditMock.cloneRepoIntoSandbox,
    applyFilesIntoSandbox: sandboxSourceEditMock.applyFilesIntoSandbox,
    runSandboxTestGate: sandboxSourceEditMock.runSandboxTestGate,
    commitAndPushInSandbox: sandboxSourceEditMock.commitAndPushInSandbox,
  };
});

// Extend githubClientMock from the existing fixture with openPullRequest.
// `vi.mock` was registered for `./github-client` at the top of this
// file — we re-mock to add the new entry without losing the existing
// ones.
vi.mock("./github-client", () => ({
  ...githubClientMock,
  openPullRequest: vi.fn(),
}));

import { runProposeSourceEdit } from "./agent-tools";
import * as ghClientForProposeMock from "./github-client";

const goodFiles = [
  {
    path: "src/decks/public/hello/01-title.tsx",
    content: "// new content",
  },
];
const goodInput = { files: goodFiles, summary: "tighten title slide copy" };
const ghToken = {
  token: "gho_abc",
  username: "alice",
  userId: 12345,
  scopes: ["public_repo"],
  connectedAt: 0,
};
const wrappedAgent = "alice@cloudflare.com";

beforeEach(() => {
  sandboxSourceEditMock.cloneRepoIntoSandbox.mockReset();
  sandboxSourceEditMock.applyFilesIntoSandbox.mockReset();
  sandboxSourceEditMock.runSandboxTestGate.mockReset();
  sandboxSourceEditMock.commitAndPushInSandbox.mockReset();
  vi.mocked(ghClientForProposeMock.openPullRequest).mockReset();
  githubOauthMock.getStoredGitHubToken.mockReset();
  getSandboxFn.mockClear();
});

/** Wire up the happy path for every step. Individual tests override pieces. */
function setupHappyPath() {
  githubOauthMock.getStoredGitHubToken.mockResolvedValue(ghToken);
  sandboxSourceEditMock.cloneRepoIntoSandbox.mockResolvedValue({
    ok: true,
    workdir: "/workspace/repo",
    ref: "main",
  });
  sandboxSourceEditMock.applyFilesIntoSandbox.mockResolvedValue({
    ok: true,
    paths: goodFiles.map((f) => f.path),
  });
  sandboxSourceEditMock.runSandboxTestGate.mockResolvedValue({
    ok: true,
    phases: [
      {
        phase: "install",
        ok: true,
        command: "npm ci",
        stdout: "",
        stderr: "",
        exitCode: 0,
      },
      {
        phase: "typecheck",
        ok: true,
        command: "npm run typecheck",
        stdout: "",
        stderr: "",
        exitCode: 0,
      },
      {
        phase: "test",
        ok: true,
        command: "npm test",
        stdout: "",
        stderr: "",
        exitCode: 0,
      },
      {
        phase: "build",
        ok: true,
        command: "npm run build",
        stdout: "",
        stderr: "",
        exitCode: 0,
      },
    ],
  });
  sandboxSourceEditMock.commitAndPushInSandbox.mockResolvedValue({
    ok: true,
    sha: "abcdef0123456789abcdef0123456789abcdef01",
    branch: "agent/test-deck-1715425200000",
  });
  vi.mocked(ghClientForProposeMock.openPullRequest).mockResolvedValue({
    ok: true,
    result: {
      number: 999,
      htmlUrl: "https://github.com/mcdays94/slide-of-hand/pull/999",
      nodeId: "PR_x",
      head: "agent/test-deck-1715425200000",
      base: "main",
    },
  });
}

describe("runProposeSourceEdit — happy path", () => {
  it("orchestrates the five helpers in order and returns the PR URL", async () => {
    setupHappyPath();
    const { env } = makeEnv();
    const result = await runProposeSourceEdit(
      env,
      "test-deck",
      goodInput,
      getSandboxFn,
      wrappedAgent,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prNumber).toBe(999);
    expect(result.prHtmlUrl).toMatch(/pull\/999/);
    expect(result.branch).toMatch(/^agent\/test-deck-\d+$/);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.testGatePhases).toHaveLength(4);

    // Sandbox lookup uses a deterministic per-deck ID so subsequent
    // edits to the same deck reuse the warm container.
    expect(getSandboxFn).toHaveBeenCalledWith(
      env.Sandbox,
      "source-edit:test-deck",
    );

    // Helpers fire in the right order with the right args.
    expect(
      sandboxSourceEditMock.cloneRepoIntoSandbox,
    ).toHaveBeenCalledWith(sandboxStub, {
      token: ghToken.token,
      repo: { owner: "mcdays94", repo: "slide-of-hand" },
    });
    expect(
      sandboxSourceEditMock.applyFilesIntoSandbox,
    ).toHaveBeenCalledWith(sandboxStub, goodFiles, "/workspace/repo");
    expect(sandboxSourceEditMock.runSandboxTestGate).toHaveBeenCalledWith(
      sandboxStub,
      "/workspace/repo",
    );
    expect(
      sandboxSourceEditMock.commitAndPushInSandbox,
    ).toHaveBeenCalledWith(
      sandboxStub,
      expect.objectContaining({
        commitMessage: goodInput.summary,
        // Author is PINNED to the project owner regardless of who's
        // driving the agent — see `SLIDE_OF_HAND_COMMIT_IDENTITY` in
        // `worker/github-client.ts` for the "Cutindah" post-mortem.
        authorName: "mcdays94",
        authorEmail: "amtccdias@gmail.com",
      }),
      "/workspace/repo",
    );
    expect(
      ghClientForProposeMock.openPullRequest,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        token: ghToken.token,
        title: goodInput.summary,
        draft: true,
      }),
    );
  });

  it("includes the test-gate summary in the PR body", async () => {
    setupHappyPath();
    const { env } = makeEnv();
    await runProposeSourceEdit(
      env,
      "test-deck",
      { ...goodInput, prDescription: "Bumps the title copy." },
      getSandboxFn,
      wrappedAgent,
    );
    const call = vi.mocked(ghClientForProposeMock.openPullRequest).mock
      .calls[0]?.[0];
    expect(call).toBeDefined();
    // PR body has the user-supplied prose AND a test-gate table.
    expect(call!.body).toMatch(/Bumps the title copy\./);
    expect(call!.body).toMatch(/## Test gate/);
    expect(call!.body).toMatch(/\| `install` \| `npm ci` \| 0 \| ✅ \|/);
    expect(call!.body).toMatch(/\| `build` \| `npm run build` \| 0 \| ✅ \|/);
  });
});

describe("runProposeSourceEdit — failure surfaces", () => {
  it("returns phase:'auth' when no email is resolvable (service-token context)", async () => {
    // No need to set up other helpers — auth gate fails first.
    const { env } = makeEnv();
    const result = await runProposeSourceEdit(
      env,
      "test-deck",
      goodInput,
      getSandboxFn,
      null,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe("auth");
    expect(
      sandboxSourceEditMock.cloneRepoIntoSandbox,
    ).not.toHaveBeenCalled();
  });

  it("returns phase:'github_token' when the user has no GitHub connection", async () => {
    githubOauthMock.getStoredGitHubToken.mockResolvedValue(null);
    const { env } = makeEnv();
    const result = await runProposeSourceEdit(
      env,
      "test-deck",
      goodInput,
      getSandboxFn,
      wrappedAgent,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe("github_token");
    expect(result.error).toMatch(/Settings/);
    expect(getSandboxFn).not.toHaveBeenCalled();
  });

  it("returns phase:'clone' when cloneRepoIntoSandbox fails", async () => {
    setupHappyPath();
    sandboxSourceEditMock.cloneRepoIntoSandbox.mockResolvedValue({
      ok: false,
      error: "git clone failed (exit 128)",
    });
    const { env } = makeEnv();
    const result = await runProposeSourceEdit(
      env,
      "test-deck",
      goodInput,
      getSandboxFn,
      wrappedAgent,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe("clone");
    expect(result.error).toMatch(/exit 128/);
    // No applyFiles attempted after clone failure.
    expect(
      sandboxSourceEditMock.applyFilesIntoSandbox,
    ).not.toHaveBeenCalled();
  });

  it("returns phase:'apply' with failedPath when applyFiles rejects a bad path", async () => {
    setupHappyPath();
    sandboxSourceEditMock.applyFilesIntoSandbox.mockResolvedValue({
      ok: false,
      error: "Path must be relative (no leading '/')",
      failedPath: "/etc/passwd",
    });
    const { env } = makeEnv();
    const result = await runProposeSourceEdit(
      env,
      "test-deck",
      goodInput,
      getSandboxFn,
      wrappedAgent,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe("apply");
    expect(result.failedPath).toBe("/etc/passwd");
    expect(sandboxSourceEditMock.runSandboxTestGate).not.toHaveBeenCalled();
  });

  it("returns phase:'test_gate' with the failed phase + phases-so-far when the gate fails", async () => {
    setupHappyPath();
    sandboxSourceEditMock.runSandboxTestGate.mockResolvedValue({
      ok: false,
      failedPhase: "typecheck",
      phases: [
        {
          phase: "install",
          ok: true,
          command: "npm ci",
          stdout: "",
          stderr: "",
          exitCode: 0,
        },
        {
          phase: "typecheck",
          ok: false,
          command: "npm run typecheck",
          stdout: "",
          stderr: "type error at src/foo.ts:42",
          exitCode: 2,
        },
      ],
    });
    const { env } = makeEnv();
    const result = await runProposeSourceEdit(
      env,
      "test-deck",
      goodInput,
      getSandboxFn,
      wrappedAgent,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe("test_gate");
    expect(result.failedTestGatePhase).toBe("typecheck");
    expect(result.testGatePhases).toHaveLength(2);
    expect(
      sandboxSourceEditMock.commitAndPushInSandbox,
    ).not.toHaveBeenCalled();
  });

  it("returns phase:'commit_push' with noEffectiveChanges when the diff was empty", async () => {
    setupHappyPath();
    sandboxSourceEditMock.commitAndPushInSandbox.mockResolvedValue({
      ok: false,
      noEffectiveChanges: true,
      error: "No effective changes to commit (working tree matches HEAD).",
    });
    const { env } = makeEnv();
    const result = await runProposeSourceEdit(
      env,
      "test-deck",
      goodInput,
      getSandboxFn,
      wrappedAgent,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe("commit_push");
    expect(result.noEffectiveChanges).toBe(true);
    expect(ghClientForProposeMock.openPullRequest).not.toHaveBeenCalled();
  });

  it("returns phase:'open_pr' when GitHub rejects the PR (e.g. 422 duplicate)", async () => {
    setupHappyPath();
    vi.mocked(ghClientForProposeMock.openPullRequest).mockResolvedValue({
      ok: false,
      kind: "other",
      message: "GitHub rejected the PR (422): already exists",
      status: 422,
    });
    const { env } = makeEnv();
    const result = await runProposeSourceEdit(
      env,
      "test-deck",
      goodInput,
      getSandboxFn,
      wrappedAgent,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe("open_pr");
    expect(result.error).toMatch(/already exists/);
  });
});

// ─── currentUserEmail — item B regression coverage ───────────────────
//
// The agents SDK's AsyncLocalStorage context has different fields
// populated depending on which hook is currently running. During
// HTTP `onRequest`, the upgrade `onConnect`, and the broad
// `withAgentContext` wrapping, `request` is set. During `onMessage`
// (which dispatches `onChatMessage` and the tool `execute`
// callbacks) `request` is undefined but `connection` is set. The
// fix is to stash the Access-issued email on connection state
// during `onConnect` and let `currentUserEmail` fall back to reading
// it from there when `request` is unavailable.

describe("currentUserEmail (issue #131 item B)", () => {
  it("returns the email from getCurrentAgent().request when the cf-access header is present", () => {
    getCurrentAgentMock.mockReturnValueOnce({
      agent: undefined,
      connection: undefined,
      request: new Request("https://example.com/agents/x", {
        headers: {
          "cf-access-authenticated-user-email": "miguel@cloudflare.com",
        },
      }),
      email: undefined,
    });
    expect(currentUserEmail()).toBe("miguel@cloudflare.com");
  });

  it("falls back to connection.state.email when request is undefined (chat-dispatch case)", () => {
    // This is the bug-fix regression test. Before item B, currentUserEmail
    // returned null here, which made every tool that needs a per-user
    // GitHub token (listSourceTree, readSource, commitPatch's GitHub
    // backup leg) fall back to the "service-token context" error
    // message — even for interactive Access users.
    getCurrentAgentMock.mockReturnValueOnce({
      agent: undefined,
      connection: {
        id: "c1",
        state: { email: "miguel@cloudflare.com" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      request: undefined,
      email: undefined,
    });
    expect(currentUserEmail()).toBe("miguel@cloudflare.com");
  });

  it("returns null when neither request nor connection state carry an email (service-token case)", () => {
    // Service-token authenticated requests pass `requireAccessAuth`
    // via the JWT signal but never carry an email — the "no user
    // identity" branch must still degrade gracefully so callers can
    // emit a friendly error message.
    getCurrentAgentMock.mockReturnValueOnce({
      agent: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: { id: "c1", state: null } as any,
      request: undefined,
      email: undefined,
    });
    expect(currentUserEmail()).toBeNull();
  });

  it("returns null when getCurrentAgent has no store at all", () => {
    // Defensive: if the AsyncLocalStorage store is missing entirely
    // (call from outside any agent context), the SDK returns
    // all-undefined. Don't throw — return null and let the caller
    // decide what to do.
    getCurrentAgentMock.mockReturnValueOnce({
      agent: undefined,
      connection: undefined,
      request: undefined,
      email: undefined,
    });
    expect(currentUserEmail()).toBeNull();
  });

  it("prefers the request-borne email over the connection-state email when both are present", () => {
    // The request is the more recently-issued auth signal for this
    // call, so when both are available, trust the request. Stops a
    // stale connection-state email from overriding a fresh per-call
    // identity (e.g. inside an HTTP onRequest hook firing on a
    // long-lived WebSocket).
    getCurrentAgentMock.mockReturnValueOnce({
      agent: undefined,
      connection: {
        id: "c1",
        state: { email: "stale@example.com" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      request: new Request("https://example.com/x", {
        headers: {
          "cf-access-authenticated-user-email": "fresh@example.com",
        },
      }),
      email: undefined,
    });
    expect(currentUserEmail()).toBe("fresh@example.com");
  });

  it("returns null when getCurrentAgent throws", () => {
    // Pure defensive: if the SDK internals throw (shouldn't happen
    // but the wrapper is `try`-`catch` anyway), return null instead
    // of letting the throw escape into tool execution.
    getCurrentAgentMock.mockImplementationOnce(() => {
      throw new Error("not in an agent context");
    });
    expect(currentUserEmail()).toBeNull();
  });
});

// ─── End-to-end regression through a tool runner ─────────────────────
//
// The unit tests above prove the fallback logic in `currentUserEmail`.
// This block proves the fallback actually plumbs through to a real
// tool runner — i.e. that the bug is fixed at the call-site that
// reported it (the chat panel's listSourceTree invocation).

describe("runListSourceTree — chat-dispatch path (issue #131 item B)", () => {
  it("succeeds when only connection.state.email is set (no emailOverride, no request)", async () => {
    // Mirrors the production chat-dispatch context: getCurrentAgent
    // returns a connection (with email previously stashed on
    // onConnect) but `request` is undefined because we're inside
    // onMessage, not onConnect.
    getCurrentAgentMock.mockReturnValueOnce({
      agent: undefined,
      connection: {
        id: "c1",
        state: { email: "miguel@cloudflare.com" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      request: undefined,
      email: undefined,
    });
    githubOauthMock.getStoredGitHubToken.mockResolvedValue({
      token: "gho_xyz",
      username: "miguel",
      userId: 42,
      scopes: ["public_repo"],
      connectedAt: 0,
    });
    githubClientMock.listContents.mockResolvedValue({
      ok: true,
      items: [
        { name: "01-title.tsx", path: "src/x", type: "file", size: 100 },
      ],
    });
    const { env } = makeEnv();
    // No emailOverride — forces the fallback through currentUserEmail
    // → connection.state.email.
    const result = (await runListSourceTree(
      env,
      "src/decks/public/hello",
    )) as ListSourceTreeResult;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("01-title.tsx");
    }
    // Sanity: the per-user GitHub token lookup used the email from
    // connection state.
    expect(githubOauthMock.getStoredGitHubToken).toHaveBeenCalledWith(
      env,
      "miguel@cloudflare.com",
    );
  });
});
