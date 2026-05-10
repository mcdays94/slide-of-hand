/**
 * Unit tests for the agent tool definitions (issue #131 phase 2).
 *
 * The tools (`readDeck`, `proposePatch`) close over the KV namespace
 * and deck slug at construction time via `buildTools(env, slug)`. We
 * test them in isolation here — calling `tool.execute({}, opts)`
 * directly with a mocked KV namespace — because the path through
 * `streamText` requires a real Workers AI binding and would burn
 * account-billed AI calls per test run.
 *
 * The end-to-end "model actually calls these tools and the chat UI
 * renders them" loop is covered by the manual `wrangler dev` e2e
 * test (see the PR description).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTools,
  type AgentToolsEnv,
  type ProposePatchResult,
  type ReadDeckResult,
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
  return { env: { DECKS: kv }, puts };
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
