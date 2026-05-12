/**
 * Tests for `worker/ai-deck-gen.ts` (issue #168 Wave 1 / Worker A).
 *
 * Mocks `generateObject` from "ai" so tests don't issue real Workers
 * AI requests. The system prompt + user message construction are
 * verified by introspecting the call args.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { generateObjectMock, streamObjectMock } = vi.hoisted(() => ({
  generateObjectMock: vi.fn(),
  streamObjectMock: vi.fn(),
}));
vi.mock("ai", async () => {
  const actual =
    await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: generateObjectMock,
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

import { generateDeckFiles, streamDeckFiles } from "./ai-deck-gen";
import type { DeckGenPartial } from "./ai-deck-gen";

const fakeAiBinding = {} as unknown as Ai;

beforeEach(() => {
  generateObjectMock.mockReset();
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

describe("generateDeckFiles — happy path", () => {
  it("returns the parsed files + commit message on success", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [
          {
            path: "src/decks/public/crdt-collab/meta.ts",
            content: "export const meta = { slug: 'crdt-collab', ... };",
          },
          {
            path: "src/decks/public/crdt-collab/index.tsx",
            content: "export default { meta, slides: [] };",
          },
          {
            path: "src/decks/public/crdt-collab/01-title.tsx",
            content: "export const titleSlide = { id: 'title', ... };",
          },
        ],
        commitMessage: "Initial deck about CRDT collaboration",
      },
    });

    const result = await generateDeckFiles(fakeAiBinding, {
      slug: "crdt-collab",
      userPrompt: "Create a deck about CRDT-based collaborative editing.",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toHaveLength(3);
      expect(result.commitMessage).toMatch(/CRDT/i);
    }
  });

  it("passes the slug into the system prompt", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [
          {
            path: "src/decks/public/foo/meta.ts",
            content: "export const meta = { slug: 'foo', ... };",
          },
        ],
        commitMessage: "Initial commit",
      },
    });

    await generateDeckFiles(fakeAiBinding, {
      slug: "foo",
      userPrompt: "Build a foo deck.",
    });

    const call = generateObjectMock.mock.calls[0][0];
    expect(call.system).toContain("foo");
    expect(call.system).toContain("src/decks/public/foo/");
  });

  it("forwards existingFiles into the user message for iteration", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [
          {
            path: "src/decks/public/foo/01-title.tsx",
            content: "modified content",
          },
        ],
        commitMessage: "Modify title",
      },
    });

    await generateDeckFiles(fakeAiBinding, {
      slug: "foo",
      userPrompt: "Make the title orange.",
      existingFiles: [
        {
          path: "src/decks/public/foo/01-title.tsx",
          content: "export const titleSlide = { id: 'title', ... };",
        },
      ],
    });

    const call = generateObjectMock.mock.calls[0][0];
    expect(call.prompt).toContain("Current deck files");
    expect(call.prompt).toContain("01-title.tsx");
  });

  // Issue #171 visibility toggle: the user's selected Public /
  // Private choice on /admin/decks/new threads into the model's
  // user message so the generated `meta.ts` carries the correct
  // `visibility` field. Default is "private" (matches the UI
  // toggle's default + safer floor).
  it("defaults visibility to private when unset", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [{ path: "src/decks/public/foo/meta.ts", content: "x" }],
        commitMessage: "x",
      },
    });

    await generateDeckFiles(fakeAiBinding, {
      slug: "foo",
      userPrompt: "Build a foo deck.",
    });

    const call = generateObjectMock.mock.calls[0][0];
    // Phrasing pinned: the model sees both an unambiguous statement
    // of the value AND the literal `visibility: "..."` directive it
    // should drop into meta.ts.
    expect(call.prompt).toMatch(/visibility[^*]*private/i);
    expect(call.prompt).toContain('visibility: "private"');
  });

  it("propagates an explicit visibility into the user message", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [{ path: "src/decks/public/foo/meta.ts", content: "x" }],
        commitMessage: "x",
      },
    });

    await generateDeckFiles(fakeAiBinding, {
      slug: "foo",
      userPrompt: "Build a foo deck.",
      visibility: "public",
    });

    const call = generateObjectMock.mock.calls[0][0];
    expect(call.prompt).toContain('visibility: "public"');
    // Make sure the default-private branch did NOT also fire — the
    // model would otherwise see two conflicting directives.
    expect(call.prompt).not.toContain('visibility: "private"');
  });

  it("forwards pinned elements into the user message", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [
          { path: "src/decks/public/foo/01-title.tsx", content: "x" },
        ],
        commitMessage: "x",
      },
    });

    await generateDeckFiles(fakeAiBinding, {
      slug: "foo",
      userPrompt: "Make this larger.",
      pinnedElements: [
        {
          file: "src/decks/public/foo/01-title.tsx",
          lineStart: 12,
          lineEnd: 18,
          htmlExcerpt: "<h1>Title</h1>",
        },
      ],
    });

    const call = generateObjectMock.mock.calls[0][0];
    expect(call.prompt).toContain("Pinned elements");
    expect(call.prompt).toContain("12-18");
    expect(call.prompt).toContain("<h1>Title</h1>");
  });

  it("uses GPT-OSS 120B by default", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [{ path: "src/decks/public/x/meta.ts", content: "a" }],
        commitMessage: "x",
      },
    });
    await generateDeckFiles(fakeAiBinding, {
      slug: "x",
      userPrompt: "x",
    });
    // The provider is invoked with `(modelId, settings)`. With no
    // gateway token the settings object is empty — the AI Gateway
    // auth header is only attached when CF_AI_GATEWAY_TOKEN is
    // supplied via `options.gatewayToken`.
    expect(modelMock).toHaveBeenCalledWith("@cf/openai/gpt-oss-120b", {});
  });

  it("honours an explicit model override", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [{ path: "src/decks/public/x/meta.ts", content: "a" }],
        commitMessage: "x",
      },
    });
    await generateDeckFiles(
      fakeAiBinding,
      { slug: "x", userPrompt: "x" },
      { modelId: "@cf/meta/llama-4-scout-17b-16e-instruct" },
    );
    expect(modelMock).toHaveBeenCalledWith(
      "@cf/meta/llama-4-scout-17b-16e-instruct",
      {},
    );
  });

  // AI Gateway authentication (issue: 2001 'Please configure AI
  // Gateway' error when the gateway has Authenticated Gateway turned
  // on). When the caller supplies a `gatewayToken`, the model call's
  // settings carry the `cf-aig-authorization: Bearer <token>` header
  // via the workers-ai-provider's `extraHeaders` option.
  it("attaches the cf-aig-authorization header when gatewayToken is supplied", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [{ path: "src/decks/public/x/meta.ts", content: "a" }],
        commitMessage: "x",
      },
    });
    await generateDeckFiles(
      fakeAiBinding,
      { slug: "x", userPrompt: "x" },
      { gatewayToken: "secret-token-abc" },
    );
    expect(modelMock).toHaveBeenCalledWith("@cf/openai/gpt-oss-120b", {
      extraHeaders: { "cf-aig-authorization": "Bearer secret-token-abc" },
    });
  });

  it("does not attach the cf-aig-authorization header when gatewayToken is empty", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [{ path: "src/decks/public/x/meta.ts", content: "a" }],
        commitMessage: "x",
      },
    });
    await generateDeckFiles(
      fakeAiBinding,
      { slug: "x", userPrompt: "x" },
      { gatewayToken: "  " },
    );
    // Empty-string-after-trim token = treat as unset (defence
    // against a misconfigured secret that's all whitespace).
    expect(modelMock).toHaveBeenCalledWith("@cf/openai/gpt-oss-120b", {});
  });
});

describe("generateDeckFiles — failure modes", () => {
  it("returns model_error when generateObject throws", async () => {
    generateObjectMock.mockRejectedValueOnce(new Error("rate limit"));
    const result = await generateDeckFiles(fakeAiBinding, {
      slug: "x",
      userPrompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("model_error");
      expect(result.error).toMatch(/rate limit/);
    }
  });

  it("returns path_violation when the model produces an out-of-scope path", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [
          {
            path: "package.json",
            content: '{"name":"hacked"}',
          },
        ],
        commitMessage: "Oops",
      },
    });
    const result = await generateDeckFiles(fakeAiBinding, {
      slug: "x",
      userPrompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("path_violation");
      expect(result.error).toMatch(/outside.*deck folder/);
    }
  });

  it("returns path_violation on '..' segments", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        files: [
          {
            path: "src/decks/public/x/../../../package.json",
            content: "naughty",
          },
        ],
        commitMessage: "...",
      },
    });
    const result = await generateDeckFiles(fakeAiBinding, {
      slug: "x",
      userPrompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe("path_violation");
      expect(result.error).toMatch(/\.\./);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// streamDeckFiles — issue #178 sub-piece (1) + most of (3): streaming
// upgrade. Same model call + same validation as `generateDeckFiles`,
// but exposes `{ partials, result }` so callers (the orchestrator in
// `sandbox-deck-creation.ts`) can surface in-flight progress to the UI.
// ─────────────────────────────────────────────────────────────────────

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
    // Mirrors `generateDeckFiles`'s model_error branch. The AI SDK's
    // `streamObject` surfaces non-stop errors (network, rate limit,
    // schema-validation on the final object) via a rejected `object`
    // promise. We re-shape that into the typed failure rather than
    // propagating the rejection — callers (the orchestrator) yield
    // an `{phase: "error", ...}` snapshot off the result, which is a
    // sum-type pattern, not a try/catch one.
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
  // Defence-in-depth: streamDeckFiles shares model-building with
  // generateDeckFiles. This test pins that the AI Gateway auth
  // header is also attached on the streaming path so the issue-#177
  // production fix can't silently regress when the streaming variant
  // becomes the only caller.
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
