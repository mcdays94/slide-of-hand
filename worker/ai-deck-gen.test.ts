/**
 * Tests for `worker/ai-deck-gen.ts` (issue #168 Wave 1 / Worker A).
 *
 * Mocks `generateObject` from "ai" so tests don't issue real Workers
 * AI requests. The system prompt + user message construction are
 * verified by introspecting the call args.
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

import { generateDeckFiles } from "./ai-deck-gen";

const fakeAiBinding = {} as unknown as Ai;

beforeEach(() => {
  generateObjectMock.mockReset();
  createWorkersAIMock.mockReset();
  modelMock.mockReset();
  createWorkersAIMock.mockReturnValue(modelMock);
});

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
    expect(modelMock).toHaveBeenCalledWith("@cf/openai/gpt-oss-120b");
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
    );
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
