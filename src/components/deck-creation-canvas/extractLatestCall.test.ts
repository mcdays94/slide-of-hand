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
