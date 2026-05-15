/**
 * Tests for `worker/ai-deck-gen.ts` (issue #168 Wave 1 / Worker A,
 * streaming upgrade per issue #178 sub-piece 1).
 *
 * Mocks `generateObject` from "ai" so tests don't issue real Workers
 * AI requests. The system prompt + user message construction are
 * verified by introspecting the call args.
 *
 * Note: this used to mock `streamObject`. Switched to `generateObject`
 * on 2026-05-14 after the e2e marathon proved `streamObject` brittle
 * against workers-ai-provider — see `ai-deck-gen.ts`'s `streamDeckFiles`
 * comment for the diagnostic data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { generateObjectMock } = vi.hoisted(() => ({
  generateObjectMock: vi.fn(),
}));
vi.mock("ai", async () => {
  const actual =
    await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: generateObjectMock,
  };
});

// Stub agents SDK to avoid the cloudflare:workers transitive import.
const { aiChatMock, routeAgentRequestMock } = vi.hoisted(() => ({
  aiChatMock: class {},
  routeAgentRequestMock: vi.fn(),
}));
vi.mock("@cloudflare/ai-chat", () => ({ AIChatAgent: aiChatMock }));
vi.mock("agents", () => ({
  routeAgentRequest: routeAgentRequestMock,
}));
vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));

// Stub workers-ai-provider so we can intercept the model build.
const { createWorkersAIMock, modelMock } = vi.hoisted(() => ({
  createWorkersAIMock: vi.fn(),
  modelMock: vi.fn(),
}));
vi.mock("workers-ai-provider", () => ({
  createWorkersAI: createWorkersAIMock,
}));

import { streamDeckFiles } from "./ai-deck-gen";
import type { DeckGenPartial } from "./ai-deck-gen";

const fakeAiBinding = {} as unknown as Ai;

beforeEach(() => {
  generateObjectMock.mockReset();
  createWorkersAIMock.mockReset();
  modelMock.mockReset();
  createWorkersAIMock.mockReturnValue(modelMock);
});

/**
 * Build a fake `generateObject` return value: resolves to `{ object }`
 * with the given final.
 *
 * The AI SDK's `generateObject` returns `Promise<{ object: TResult; ... }>`.
 * Tests only care about `.object`.
 *
 * Historical note: this used to be `fakeStreamObject` which produced a
 * `{ partialObjectStream, object }` pair — the streaming shape of the
 * old `streamObject` API. Tests took an array of progressive partials.
 * The new helper takes only the final object — `generateObject` waits
 * for the full response before resolving, so there's no notion of
 * progressive partials. Tests that previously verified multi-partial
 * progression now verify the single end-of-stream partial.
 */
function fakeGenerateObject<TResult>(
  finalObject: TResult,
): Promise<{ object: TResult }> {
  return Promise.resolve({ object: finalObject });
}

/**
 * Build a rejecting `generateObject` return value — used to test
 * model-error handling.
 */
function fakeGenerateObjectError(error: unknown): Promise<never> {
  return Promise.reject(error);
}

/**
 * Collect all yields from a `streamDeckFiles` partials iterable into an
 * array, AND await `result`. Returns both. Centralised helper so each
 * test doesn't repeat the dual-consumption pattern.
 */
async function collect(
  stream: ReturnType<typeof streamDeckFiles>,
): Promise<{ partials: DeckGenPartial[]; result: Awaited<typeof stream.result> }> {
  const partials: DeckGenPartial[] = [];
  for await (const p of stream.partials) {
    partials.push(p);
  }
  const result = await stream.result;
  return { partials, result };
}

describe("streamDeckFiles — happy path", () => {
  it("yields a single 'all done' partial and resolves a final result", async () => {
    // Tracer bullet: prove the partials/result split works
    // end-to-end. Post-2026-05-14 switch from streamObject to
    // generateObject, partials yields exactly once at the end with
    // every file marked 'done'.
    generateObjectMock.mockReturnValueOnce(
      fakeGenerateObject({
        files: [
          {
            path: "src/decks/public/hello/meta.ts",
            content: "export const meta = { slug: 'hello' };",
          },
          {
            path: "src/decks/public/hello/index.tsx",
            content: "const deck = { meta, slides: [] }; export default deck;",
          },
          {
            path: "src/decks/public/hello/01-title.tsx",
            content: "export const titleSlide = { id: 'title' };",
          },
        ],
        commitMessage: "Initial",
      }),
    );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "say hi",
    });

    const { partials, result } = await collect(stream);

    expect(partials).toHaveLength(1);
    expect(partials[0]?.files[0]?.path).toBe(
      "src/decks/public/hello/meta.ts",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toHaveLength(3);
      expect(result.commitMessage).toBe("Initial");
    }
  });

  it("marks every file 'done' in the single final partial (no 'writing' state with non-streaming)", async () => {
    // Pre-2026-05-14, streamObject yielded progressive partials where
    // the LAST file was 'writing' and earlier files were 'done'. With
    // generateObject we get the whole object at once — all files are
    // 'done' in a single yield, currentFile points at the last file.
    generateObjectMock.mockReturnValueOnce(
      fakeGenerateObject({
        files: [
          {
            path: "src/decks/public/hello/meta.ts",
            content: "export const meta = { slug: 'hello' };",
          },
          {
            path: "src/decks/public/hello/index.tsx",
            content: "import { meta } from './meta'; const deck = { meta, slides: [] }; export default deck;",
          },
          {
            path: "src/decks/public/hello/01-title.tsx",
            content: "export const titleSlide = { id: 'title' };",
          },
        ],
        commitMessage: "Initial hello deck",
      }),
    );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "say hi",
    });

    const { partials } = await collect(stream);

    // Exactly ONE partial — the final, all-done view.
    expect(partials).toHaveLength(1);
    expect(partials[0]?.files.map((f) => f.state)).toEqual([
      "done",
      "done",
      "done",
    ]);
    // currentFile points at the last file in the array (legacy
    // semantic kept for UI continuity).
    expect(partials[0]?.currentFile).toBe(
      "src/decks/public/hello/01-title.tsx",
    );
  });
});

describe("streamDeckFiles — failure modes", () => {
  it("resolves result to model_error when generateObject rejects", async () => {
    // `generateObject` surfaces non-stop errors (network, rate
    // limit, schema-validation on the final object) via a rejected
    // promise. We re-shape that into the typed failure rather than
    // propagating the rejection — callers (the orchestrator) yield
    // an `{phase: "error", ...}` snapshot off the result, which is
    // a sum-type pattern, not a try/catch one.
    generateObjectMock.mockReturnValueOnce(
      fakeGenerateObjectError(new Error("rate limit")),
    );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "say hi",
    });

    const { result } = await collect(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("model_error");
      expect(result.error).toMatch(/rate limit/);
    }
  });

  it("resolves result to path_violation when the model produces an out-of-scope path", async () => {
    generateObjectMock.mockReturnValueOnce(
      fakeGenerateObject({
        files: [
          {
            path: "package.json",
            content: '{"name":"hacked"}',
          },
        ],
        commitMessage: "Oops",
      }),
    );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "x",
    });

    const { result } = await collect(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("path_violation");
      expect(result.error).toMatch(/outside.*deck folder/);
    }
  });

  it("resolves result to path_violation on '..' segments", async () => {
    generateObjectMock.mockReturnValueOnce(
      fakeGenerateObject({
        files: [
          {
            path: "src/decks/public/hello/../../../package.json",
            content: "naughty",
          },
        ],
        commitMessage: "...",
      }),
    );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "x",
    });

    const { result } = await collect(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("path_violation");
      expect(result.error).toMatch(/\.\./);
    }
  });

  it("resolves result to no_files when the model returns an empty files array", async () => {
    generateObjectMock.mockReturnValueOnce(
      fakeGenerateObject({
        files: [],
        commitMessage: "Empty",
      }),
    );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "x",
    });

    const { result } = await collect(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("no_files");
      expect(result.error).toMatch(/no files/i);
    }
  });

  it("retries once when the model output is missing required deck files", async () => {
    generateObjectMock
      .mockReturnValueOnce(
        fakeGenerateObject({
          files: [
            {
              path: "src/decks/public/hello/meta.ts",
              content: "export const meta = { slug: 'hello' };",
            },
          ],
          commitMessage: "Broken",
        }),
      )
      .mockReturnValueOnce(
        fakeGenerateObject({
          files: [
            {
              path: "src/decks/public/hello/meta.ts",
              content: "export const meta = { slug: 'hello' };",
            },
            {
              path: "src/decks/public/hello/index.tsx",
              content: "const deck = { meta, slides: [] }; export default deck;",
            },
            {
              path: "src/decks/public/hello/01-title.tsx",
              content: "export const titleSlide = { id: 'title' };",
            },
          ],
          commitMessage: "Fixed",
        }),
      );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "say hi",
    });

    const { result } = await collect(stream);

    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    const retryPrompt = (generateObjectMock.mock.calls[1]?.[0] as { prompt: string }).prompt;
    expect(retryPrompt).toMatch(/previous output failed validation/i);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.commitMessage).toBe("Fixed");
  });

  it("returns schema_violation when semantic validation still fails after retry", async () => {
    generateObjectMock.mockReturnValue(
      fakeGenerateObject({
        files: [
          {
            path: "src/decks/public/hello/NOT_VALID",
            content: "<parameter name={bad}>",
          },
        ],
        commitMessage: "Broken",
      }),
    );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "say hi",
    });

    const { partials, result } = await collect(stream);

    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(partials).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("schema_violation");
      expect(result.error).toMatch(/failed validation after retry/i);
    }
  });

  it("rejects source DeckMeta visibility because DeckMeta does not support it", async () => {
    generateObjectMock.mockReturnValue(
      fakeGenerateObject({
        files: [
          {
            path: "src/decks/public/hello/meta.ts",
            content: "export const meta = { slug: 'hello', visibility: 'private' };",
          },
          {
            path: "src/decks/public/hello/index.tsx",
            content: "const deck = { meta, slides: [] }; export default deck;",
          },
          {
            path: "src/decks/public/hello/01-title.tsx",
            content: "export const titleSlide = { id: 'title' };",
          },
        ],
        commitMessage: "Bad visibility",
      }),
    );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "say hi",
    });

    const { result } = await collect(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("schema_violation");
      expect(result.error).toMatch(/visibility/);
    }
  });
  });

describe("streamDeckFiles — creation-as-draft prompt (#191)", () => {
  // The post-process in `runCreateDeckDraft` is the load-bearing
  // guarantee (see `worker/sandbox-deck-creation.test.ts`). These two
  // tests pin the *belt* side: the system / user prompt steers the
  // model toward `draft: true` on creation and DOES NOT mention it
  // on iteration (so the iterator doesn't accidentally regress
  // `draft: false` decks back to `true`).
  it("instructs the model to set draft: true on fresh creation (no existingFiles)", async () => {
    generateObjectMock.mockReturnValueOnce(
      fakeGenerateObject({
        files: [{ path: "src/decks/public/x/meta.ts", content: "..." }],
        commitMessage: "x",
      }),
    );
    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "x",
      userPrompt: "build a deck",
    });
    await collect(stream);
    const callArgs = generateObjectMock.mock.calls[0]?.[0] as {
      system: string;
      prompt: string;
    };
    // User-message side: the per-turn instruction. Asserting on the
    // user message rather than the system prompt because the system
    // prompt is shared across creation and iteration; the per-turn
    // user message is where the creation/iteration branch lives.
    expect(callArgs.prompt).toMatch(/draft:\s*true/i);
  });

  it("does NOT include the draft: true instruction on iteration (existingFiles present)", async () => {
    generateObjectMock.mockReturnValueOnce(
      fakeGenerateObject({
        files: [{ path: "src/decks/public/x/01-title.tsx", content: "..." }],
        commitMessage: "iter",
      }),
    );
    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "x",
      userPrompt: "tweak the title",
      existingFiles: [
        { path: "src/decks/public/x/meta.ts", content: "meta" },
        { path: "src/decks/public/x/01-title.tsx", content: "slide" },
      ],
    });
    await collect(stream);
    const callArgs = generateObjectMock.mock.calls[0]?.[0] as {
      prompt: string;
    };
    // Iteration must NOT carry the "set draft: true" steer — the
    // user may have intentionally flipped the existing meta.ts to
    // `draft: false` (published it) and an iteration prompt that
    // tweaks an unrelated slide should preserve that.
    expect(callArgs.prompt).not.toMatch(
      /Set\s+`?draft:\s*true`?\s+on\s+the\s+generated/i,
    );
  });
});

describe("streamDeckFiles — auth + wiring", () => {
  // Pins the AI Gateway auth header attachment so the issue-#177
  // production fix can't silently regress. The token flows from the
  // Worker secret `CF_AI_GATEWAY_TOKEN` → `gatewayToken` option →
  // model's `extraHeaders` → wire.
  it("attaches the cf-aig-authorization header when gatewayToken is supplied", async () => {
    generateObjectMock.mockReturnValueOnce(
      fakeGenerateObject({
        files: [{ path: "src/decks/public/x/meta.ts", content: "a" }],
        commitMessage: "x",
      }),
    );
    const stream = streamDeckFiles(
      fakeAiBinding,
      { slug: "x", userPrompt: "x" },
      { gatewayToken: "secret-token-abc" },
    );
    await collect(stream);
    expect(modelMock).toHaveBeenCalledWith("@cf/moonshotai/kimi-k2.6", {
      extraHeaders: { "cf-aig-authorization": "Bearer secret-token-abc" },
    });
  });
});
