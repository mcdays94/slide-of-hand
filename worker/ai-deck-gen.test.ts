/**
 * Tests for `worker/ai-deck-gen.ts` (issue #168 Wave 1 / Worker A,
 * streaming upgrade per issue #178 sub-piece 1).
 *
 * Mocks `streamObject` from "ai" so tests don't issue real Workers
 * AI requests. The system prompt + user message construction are
 * verified by introspecting the call args.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { streamObjectMock } = vi.hoisted(() => ({
  streamObjectMock: vi.fn(),
}));
vi.mock("ai", async () => {
  const actual =
    await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamObject: streamObjectMock,
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
  streamObjectMock.mockReset();
  createWorkersAIMock.mockReset();
  modelMock.mockReset();
  createWorkersAIMock.mockReturnValue(modelMock);
});

/**
 * Build a fake `streamObject` return value: yields the given partial
 * deltas from `partialObjectStream`, then resolves `object` to the
 * given final.
 *
 * The AI SDK's `partialObjectStream` is an `AsyncIterableStream<PARTIAL>`
 * where `PARTIAL` is a deep-partial of the schema. Tests pass the raw
 * partial shape (just `{ files?: Array<{ path?, content? }>; commitMessage? }`);
 * the transformation into the public `DeckGenPartial` (with state
 * badges + currentFile) lives in `streamDeckFiles` itself.
 */
function fakeStreamObject<TPartial, TResult>(
  partials: TPartial[],
  finalObject: TResult,
): { partialObjectStream: AsyncIterable<TPartial>; object: Promise<TResult> } {
  return {
    partialObjectStream: (async function* () {
      for (const p of partials) {
        yield p;
      }
    })(),
    object: Promise.resolve(finalObject),
  };
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
  it("yields partials from streamObject and resolves a final result", async () => {
    // Tracer bullet: prove the dual-output shape works end-to-end.
    // One partial, one resolved final. Real semantics (last-file is
    // "writing", currentFile populated) covered in subsequent tests.
    streamObjectMock.mockReturnValueOnce(
      fakeStreamObject(
        [
          {
            files: [
              {
                path: "src/decks/public/hello/meta.ts",
                content: "export const meta",
              },
            ],
          },
        ],
        {
          files: [
            {
              path: "src/decks/public/hello/meta.ts",
              content: "export const meta = { slug: 'hello' };",
            },
          ],
          commitMessage: "Initial",
        },
      ),
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
      expect(result.files).toHaveLength(1);
      expect(result.commitMessage).toBe("Initial");
    }
  });

  it("marks the last file 'writing', earlier files 'done', and reflects currentFile", async () => {
    // Three successive partial frames mimic what `streamObject` emits
    // as the model writes file-by-file:
    //   1. Just `meta.ts` mid-write.
    //   2. `meta.ts` complete + `index.tsx` mid-write.
    //   3. `meta.ts` + `index.tsx` complete + `01-title.tsx` mid-write.
    streamObjectMock.mockReturnValueOnce(
      fakeStreamObject(
        [
          {
            files: [
              {
                path: "src/decks/public/hello/meta.ts",
                content: "export const meta = { slug:",
              },
            ],
          },
          {
            files: [
              {
                path: "src/decks/public/hello/meta.ts",
                content: "export const meta = { slug: 'hello' };",
              },
              {
                path: "src/decks/public/hello/index.tsx",
                content: "import",
              },
            ],
          },
          {
            files: [
              {
                path: "src/decks/public/hello/meta.ts",
                content: "export const meta = { slug: 'hello' };",
              },
              {
                path: "src/decks/public/hello/index.tsx",
                content: "import { meta } from './meta';",
              },
              {
                path: "src/decks/public/hello/01-title.tsx",
                content: "export const titleSlide",
              },
            ],
          },
        ],
        {
          files: [
            {
              path: "src/decks/public/hello/meta.ts",
              content: "export const meta = { slug: 'hello' };",
            },
            {
              path: "src/decks/public/hello/index.tsx",
              content: "import { meta } from './meta';",
            },
            {
              path: "src/decks/public/hello/01-title.tsx",
              content: "export const titleSlide = { id: 'title' };",
            },
          ],
          commitMessage: "Initial hello deck",
        },
      ),
    );

    const stream = streamDeckFiles(fakeAiBinding, {
      slug: "hello",
      userPrompt: "say hi",
    });

    const { partials } = await collect(stream);

    expect(partials).toHaveLength(3);

    // Frame 1: only meta.ts, mid-write.
    expect(partials[0]?.files).toEqual([
      {
        path: "src/decks/public/hello/meta.ts",
        content: "export const meta = { slug:",
        state: "writing",
      },
    ]);
    expect(partials[0]?.currentFile).toBe("src/decks/public/hello/meta.ts");

    // Frame 2: meta.ts done, index.tsx mid-write.
    expect(partials[1]?.files[0]?.state).toBe("done");
    expect(partials[1]?.files[1]?.state).toBe("writing");
    expect(partials[1]?.currentFile).toBe(
      "src/decks/public/hello/index.tsx",
    );

    // Frame 3: only the LAST file (01-title.tsx) is "writing"; the
    // first two are flipped to "done".
    expect(partials[2]?.files.map((f) => f.state)).toEqual([
      "done",
      "done",
      "writing",
    ]);
    expect(partials[2]?.currentFile).toBe(
      "src/decks/public/hello/01-title.tsx",
    );
  });
});

describe("streamDeckFiles — failure modes", () => {
  it("resolves result to model_error when streamObject's `object` rejects", async () => {
    // The AI SDK's `streamObject` surfaces non-stop errors (network,
    // rate limit, schema-validation on the final object) via a
    // rejected `object` promise. We re-shape that into the typed
    // failure rather than propagating the rejection — callers (the
    // orchestrator) yield an `{phase: "error", ...}` snapshot off the
    // result, which is a sum-type pattern, not a try/catch one.
    streamObjectMock.mockReturnValueOnce({
      partialObjectStream: (async function* () {
        // No partials before the failure — the model errored before
        // emitting anything.
      })(),
      object: Promise.reject(new Error("rate limit")),
    });

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
    streamObjectMock.mockReturnValueOnce(
      fakeStreamObject(
        [],
        {
          files: [
            {
              path: "package.json",
              content: '{"name":"hacked"}',
            },
          ],
          commitMessage: "Oops",
        },
      ),
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
    streamObjectMock.mockReturnValueOnce(
      fakeStreamObject(
        [],
        {
          files: [
            {
              path: "src/decks/public/hello/../../../package.json",
              content: "naughty",
            },
          ],
          commitMessage: "...",
        },
      ),
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
    streamObjectMock.mockReturnValueOnce(
      fakeStreamObject(
        [],
        {
          files: [],
          commitMessage: "Empty",
        },
      ),
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
});

describe("streamDeckFiles — auth + wiring", () => {
  // Pins the AI Gateway auth header attachment so the issue-#177
  // production fix can't silently regress. The token flows from the
  // Worker secret `CF_AI_GATEWAY_TOKEN` → `gatewayToken` option →
  // model's `extraHeaders` → wire.
  it("attaches the cf-aig-authorization header when gatewayToken is supplied", async () => {
    streamObjectMock.mockReturnValueOnce(
      fakeStreamObject(
        [],
        {
          files: [{ path: "src/decks/public/x/meta.ts", content: "a" }],
          commitMessage: "x",
        },
      ),
    );
    const stream = streamDeckFiles(
      fakeAiBinding,
      { slug: "x", userPrompt: "x" },
      { gatewayToken: "secret-token-abc" },
    );
    await collect(stream);
    expect(modelMock).toHaveBeenCalledWith("@cf/openai/gpt-oss-120b", {
      extraHeaders: { "cf-aig-authorization": "Bearer secret-token-abc" },
    });
  });
});
