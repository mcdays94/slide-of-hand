/**
 * Tests for the deck-creation tool-call extractor.
 *
 * The extractor walks `useAgentChat`-shaped messages to find the LAST
 * deck-creation tool-call (createDeckDraft or iterateOnDeckDraft) so
 * the canvas can pivot the layout + render the right snapshot.
 *
 * Edge cases covered:
 *   - Empty messages → null.
 *   - No deck-creation tool calls → null.
 *   - Single deck-creation call → that call.
 *   - Multiple deck-creation calls → the last one wins.
 *   - Tool call with no output yet (input-streaming) → call returned, output undefined.
 *   - Mix of regular + deck-creation tool parts in one message → deck-creation wins.
 *   - Error state surfaced via errorText.
 */

import { describe, it, expect } from "vitest";
import {
  extractLatestDeckCreationCall,
  findLastUserPromptText,
  isDeckCreationSnapshot,
  isDeckDraftToolResult,
  type DeckCreationMessage,
} from "./extractLatestCall";

function textMsg(): DeckCreationMessage {
  return { parts: [{ type: "text" }] };
}

describe("extractLatestDeckCreationCall", () => {
  it("returns null for an empty messages array", () => {
    expect(extractLatestDeckCreationCall([])).toBeNull();
  });

  it("returns null when no deck-creation tool parts exist", () => {
    const messages: DeckCreationMessage[] = [
      textMsg(),
      {
        parts: [
          { type: "tool-readDeck", state: "output-available" },
          { type: "text" },
        ],
      },
    ];
    expect(extractLatestDeckCreationCall(messages)).toBeNull();
  });

  it("returns a createDeckDraft call with its output snapshot", () => {
    const messages: DeckCreationMessage[] = [
      {
        parts: [
          {
            type: "tool-createDeckDraft",
            toolCallId: "call-abc",
            state: "output-available",
            output: {
              phase: "ai_gen",
              files: [
                {
                  path: "src/decks/public/hello/meta.ts",
                  content: "export const",
                  state: "writing",
                },
              ],
              currentFile: "src/decks/public/hello/meta.ts",
              draftId: "alice-com-hello",
            },
          },
        ],
      },
    ];

    const result = extractLatestDeckCreationCall(messages);
    expect(result).not.toBeNull();
    expect(result?.toolName).toBe("createDeckDraft");
    expect(result?.toolCallId).toBe("call-abc");
    expect(result?.state).toBe("output-available");
    expect(isDeckCreationSnapshot(result?.output)).toBe(true);
    if (isDeckCreationSnapshot(result?.output)) {
      expect(result.output.phase).toBe("ai_gen");
      expect(result.output.files).toHaveLength(1);
    }
  });

  it("returns iterateOnDeckDraft when that's the latest call", () => {
    const messages: DeckCreationMessage[] = [
      {
        parts: [
          {
            type: "tool-createDeckDraft",
            toolCallId: "call-1",
            state: "output-available",
            output: { phase: "done", files: [], commitSha: "abc" },
          },
        ],
      },
      {
        parts: [
          {
            type: "tool-iterateOnDeckDraft",
            toolCallId: "call-2",
            state: "output-available",
            output: { phase: "ai_gen", files: [] },
          },
        ],
      },
    ];

    const result = extractLatestDeckCreationCall(messages);
    expect(result?.toolName).toBe("iterateOnDeckDraft");
    expect(result?.toolCallId).toBe("call-2");
  });

  it("walks newest-first within a single message — last part wins", () => {
    const messages: DeckCreationMessage[] = [
      {
        parts: [
          {
            type: "tool-createDeckDraft",
            toolCallId: "first",
            state: "output-available",
            output: { phase: "fork", files: [] },
          },
          { type: "text" },
          {
            type: "tool-createDeckDraft",
            toolCallId: "second",
            state: "output-available",
            output: { phase: "ai_gen", files: [] },
          },
        ],
      },
    ];

    const result = extractLatestDeckCreationCall(messages);
    expect(result?.toolCallId).toBe("second");
  });

  it("returns the call with output: undefined when state is input-streaming", () => {
    const messages: DeckCreationMessage[] = [
      {
        parts: [
          {
            type: "tool-createDeckDraft",
            toolCallId: "call-1",
            state: "input-streaming",
          },
        ],
      },
    ];

    const result = extractLatestDeckCreationCall(messages);
    expect(result?.state).toBe("input-streaming");
    expect(result?.output).toBeUndefined();
  });

  it("surfaces errorText on output-error", () => {
    const messages: DeckCreationMessage[] = [
      {
        parts: [
          {
            type: "tool-createDeckDraft",
            toolCallId: "call-1",
            state: "output-error",
            errorText: "Sandbox crashed",
          },
        ],
      },
    ];

    const result = extractLatestDeckCreationCall(messages);
    expect(result?.state).toBe("output-error");
    expect(result?.errorText).toBe("Sandbox crashed");
  });

  // Issue #235 — the asset shelf on `/admin/decks/new` needs the
  // draft slug as soon as the model has decided on it, which is the
  // moment the AI SDK pushes the `input-available` state with
  // `input: { slug, prompt, visibility }`. That's BEFORE any output
  // arrives (model is still generating). Surfacing the input lets
  // the route show the upload UI ~30-60s earlier than waiting for
  // the first file path.
  describe("input slug surfacing (issue #235)", () => {
    it("returns inputSlug when part.input contains a string slug", () => {
      const messages: DeckCreationMessage[] = [
        {
          parts: [
            {
              type: "tool-createDeckDraft",
              toolCallId: "call-1",
              state: "input-available",
              input: { slug: "crdt-collab", prompt: "...", visibility: "private" },
            },
          ],
        },
      ];
      const result = extractLatestDeckCreationCall(messages);
      expect(result?.inputSlug).toBe("crdt-collab");
    });

    it("returns inputSlug even while state is input-streaming (partial input)", () => {
      // The AI SDK streams the input JSON token-by-token; the slug
      // may land before the prompt / visibility. We want it surfaced
      // as soon as it's a non-empty string.
      const messages: DeckCreationMessage[] = [
        {
          parts: [
            {
              type: "tool-createDeckDraft",
              toolCallId: "call-1",
              state: "input-streaming",
              input: { slug: "hello-world" },
            },
          ],
        },
      ];
      const result = extractLatestDeckCreationCall(messages);
      expect(result?.inputSlug).toBe("hello-world");
    });

    it("leaves inputSlug undefined when there is no input object yet", () => {
      const messages: DeckCreationMessage[] = [
        {
          parts: [
            {
              type: "tool-createDeckDraft",
              toolCallId: "call-1",
              state: "input-streaming",
            },
          ],
        },
      ];
      const result = extractLatestDeckCreationCall(messages);
      expect(result?.inputSlug).toBeUndefined();
    });

    it("leaves inputSlug undefined when input.slug is not a non-empty string", () => {
      // Defensive — partial streaming might leave `slug` as undefined,
      // null, or an empty string for a tick. We treat those the same
      // as absent so the shelf doesn't render a stale empty `/api/admin/images/` URL.
      const messages: DeckCreationMessage[] = [
        {
          parts: [
            {
              type: "tool-createDeckDraft",
              toolCallId: "call-1",
              state: "input-streaming",
              input: { slug: "" },
            },
          ],
        },
      ];
      const result = extractLatestDeckCreationCall(messages);
      expect(result?.inputSlug).toBeUndefined();
    });

    it("surfaces inputSlug for iterateOnDeckDraft as well as createDeckDraft", () => {
      const messages: DeckCreationMessage[] = [
        {
          parts: [
            {
              type: "tool-iterateOnDeckDraft",
              toolCallId: "call-2",
              state: "input-available",
              input: { slug: "crdt-collab", prompt: "fix the title" },
            },
          ],
        },
      ];
      const result = extractLatestDeckCreationCall(messages);
      expect(result?.toolName).toBe("iterateOnDeckDraft");
      expect(result?.inputSlug).toBe("crdt-collab");
    });
  });

  it("ignores non-deck-creation tool parts that appear AFTER a deck-creation call", () => {
    // The extractor walks newest-first, so a later readDeck call
    // would be encountered first. The extractor must skip it and
    // continue back to find the deck-creation call.
    const messages: DeckCreationMessage[] = [
      {
        parts: [
          {
            type: "tool-createDeckDraft",
            toolCallId: "call-1",
            state: "output-available",
            output: { phase: "done", files: [] },
          },
        ],
      },
      {
        parts: [
          {
            type: "tool-readDeck",
            toolCallId: "later-call",
            state: "output-available",
            output: { found: false },
          },
        ],
      },
    ];

    const result = extractLatestDeckCreationCall(messages);
    expect(result?.toolCallId).toBe("call-1");
    expect(result?.toolName).toBe("createDeckDraft");
  });
});

describe("type guards", () => {
  it("isDeckCreationSnapshot true for snapshot outputs", () => {
    expect(
      isDeckCreationSnapshot({
        phase: "ai_gen",
        files: [],
      }),
    ).toBe(true);
  });

  it("isDeckCreationSnapshot false for lean tool results", () => {
    expect(
      isDeckCreationSnapshot({
        ok: true,
        draftId: "x",
        commitSha: "abc",
        branch: "main",
        fileCount: 3,
        commitMessage: "x",
      }),
    ).toBe(false);
  });

  it("isDeckDraftToolResult is the inverse", () => {
    expect(isDeckDraftToolResult({ ok: false, phase: "fork", error: "x" })).toBe(
      true,
    );
    expect(
      isDeckDraftToolResult({ phase: "ai_gen", files: [] }),
    ).toBe(false);
    expect(isDeckDraftToolResult(undefined)).toBe(false);
    expect(isDeckCreationSnapshot(undefined)).toBe(false);
  });
});

describe("findLastUserPromptText", () => {
  it("returns null for an empty messages array", () => {
    expect(findLastUserPromptText([])).toBeNull();
  });

  it("returns null when there are only assistant messages", () => {
    const messages: DeckCreationMessage[] = [
      {
        role: "assistant",
        parts: [{ type: "text", text: "Hi, I can help" }],
      },
    ];
    expect(findLastUserPromptText(messages)).toBeNull();
  });

  it("returns the user's text on a simple [user, assistant] history", () => {
    const messages: DeckCreationMessage[] = [
      {
        role: "user",
        parts: [{ type: "text", text: "Build me a CRDT deck" }],
      },
      {
        role: "assistant",
        parts: [{ type: "text", text: "On it." }],
      },
    ];
    expect(findLastUserPromptText(messages)).toBe("Build me a CRDT deck");
  });

  it("returns the LATEST user message when there are multiple user turns", () => {
    // Mid-conversation: the second user message is the one a Retry
    // should re-send, not the first.
    const messages: DeckCreationMessage[] = [
      {
        role: "user",
        parts: [{ type: "text", text: "First prompt" }],
      },
      {
        role: "assistant",
        parts: [{ type: "text", text: "OK" }],
      },
      {
        role: "user",
        parts: [{ type: "text", text: "Actually, do this instead" }],
      },
      {
        role: "assistant",
        parts: [{ type: "tool-createDeckDraft", state: "output-available" }],
      },
    ];
    expect(findLastUserPromptText(messages)).toBe(
      "Actually, do this instead",
    );
  });

  it("returns null when the user message has no text parts (only tool refs)", () => {
    // Defensive — shouldn't happen in production but the helper
    // should be robust to messages with only tool-result parts.
    const messages: DeckCreationMessage[] = [
      {
        role: "user",
        parts: [{ type: "tool-result" }],
      },
    ];
    expect(findLastUserPromptText(messages)).toBeNull();
  });

  it("skips empty/whitespace-only text parts so we never sendMessage('')", () => {
    const messages: DeckCreationMessage[] = [
      {
        role: "user",
        parts: [{ type: "text", text: "   \n  " }],
      },
    ];
    expect(findLastUserPromptText(messages)).toBeNull();
  });

  it("picks the latest text part within a user message when there are multiple", () => {
    // Multi-part user message (e.g. text + attachment); we want the
    // text the user typed, and if they typed twice in one message
    // (rare but possible) the latest part wins.
    const messages: DeckCreationMessage[] = [
      {
        role: "user",
        parts: [
          { type: "text", text: "first part" },
          { type: "text", text: "second part" },
        ],
      },
    ];
    expect(findLastUserPromptText(messages)).toBe("second part");
  });
});
