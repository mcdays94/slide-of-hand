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
// `getCurrentAgent` because `currentUserEmail` calls it (the `run*`
// helpers all accept an `emailOverride` so we don't actually need the
// real return value here — a stubbed-empty value is fine).
const { getCurrentAgentMock } = vi.hoisted(() => ({
  getCurrentAgentMock: vi.fn(() => ({
    agent: undefined,
    connection: undefined,
    request: undefined,
    email: undefined,
  })),
}));
vi.mock("agents", () => ({
  getCurrentAgent: getCurrentAgentMock,
}));

// Mock the `github-client` so test runs don't hit the real GitHub API.
const githubClientMock = vi.hoisted(() => ({
  listContents: vi.fn(),
  readFileContents: vi.fn(),
  putFileContents: vi.fn(),
  TARGET_REPO: { owner: "mcdays94", repo: "slide-of-hand" },
  DEFAULT_BRANCH: "main",
  dataDeckPath: (slug: string) => `data-decks/${slug}.json`,
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
  return {
    env: { DECKS: kv, GITHUB_TOKENS: githubTokens },
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
    // Uses noreply email when only username + userId available.
    expect(options.committer?.email).toContain("users.noreply.github.com");
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

// ─── Tool exposure assertion — make sure all 5 tools are wired ────────

describe("buildTools — phase 3 surface", () => {
  it("exposes commitPatch, listSourceTree, and readSource alongside the phase-2 tools", () => {
    const { env } = makeEnv();
    const tools = buildTools(env, "test-deck");
    expect(tools.readDeck).toBeDefined();
    expect(tools.proposePatch).toBeDefined();
    expect(tools.commitPatch).toBeDefined();
    expect(tools.listSourceTree).toBeDefined();
    expect(tools.readSource).toBeDefined();
    // Sanity: each has a description string for the model.
    expect(typeof tools.commitPatch.description).toBe("string");
    expect(typeof tools.listSourceTree.description).toBe("string");
    expect(typeof tools.readSource.description).toBe("string");
  });
});
