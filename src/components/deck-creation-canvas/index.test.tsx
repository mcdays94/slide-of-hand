/**
 * Integration tests for `<DeckCreationCanvas>`.
 *
 * Renders the canvas with synthetic messages mimicking the shapes
 * `useAgentChat` produces on a deck-creation tool call. Verifies
 * the canvas correctly extracts the latest output, dispatches to
 * the right subcomponent (phase strip / file tree / file content /
 * error overlay), and reflects state changes across rerenders.
 *
 * Issue #178 sub-pieces (1) + (3).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DeckCreationCanvas } from "./index";
import type { DeckCreationMessage } from "./extractLatestCall";

afterEach(() => cleanup());

/**
 * Build a synthetic createDeckDraft tool-call message with a single
 * snapshot as its current output. The AI SDK shapes the message
 * structure; tests only need the loose superset.
 */
function msgWithSnapshot(output: unknown): DeckCreationMessage {
  return {
    parts: [
      {
        type: "tool-createDeckDraft",
        toolCallId: "call-1",
        state: "output-available",
        output,
      },
    ],
  };
}

describe("<DeckCreationCanvas> — empty / warming-up states", () => {
  it("renders a 'starting' indicator when no messages contain a deck-creation call", () => {
    render(<DeckCreationCanvas messages={[]} />);
    const canvas = screen.getByTestId("deck-creation-canvas");
    expect(canvas.getAttribute("data-state")).toBe("warming-up");
    expect(screen.getByText(/starting/i)).toBeDefined();
  });

  it("renders 'warming up' when the tool call is still input-streaming (no output)", () => {
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
    render(<DeckCreationCanvas messages={messages} />);
    expect(
      screen.getByTestId("deck-creation-canvas").getAttribute("data-state"),
    ).toBe("warming-up");
  });
});

describe("<DeckCreationCanvas> — phase progression", () => {
  it("renders the phase strip with the current phase as 'current' and earlier phases as 'done'", () => {
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [],
        draftId: "alice-com-my",
      }),
    ];

    render(<DeckCreationCanvas messages={messages} />);

    // Phase strip exists with six chips.
    expect(screen.getByTestId("deck-creation-phase-strip")).toBeDefined();

    // fork + clone are "done", ai_gen is "current", others are "pending".
    expect(
      screen
        .getByTestId("deck-creation-phase-chip-fork")
        .getAttribute("data-state"),
    ).toBe("done");
    expect(
      screen
        .getByTestId("deck-creation-phase-chip-clone")
        .getAttribute("data-state"),
    ).toBe("done");
    expect(
      screen
        .getByTestId("deck-creation-phase-chip-ai_gen")
        .getAttribute("data-state"),
    ).toBe("current");
    expect(
      screen
        .getByTestId("deck-creation-phase-chip-apply")
        .getAttribute("data-state"),
    ).toBe("pending");
  });

  it("marks every chip 'done' when phase === 'done'", () => {
    const messages = [
      msgWithSnapshot({
        phase: "done",
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: "...",
            state: "done",
          },
        ],
        commitSha: "abcd123",
        commitMessage: "Initial",
      }),
    ];
    render(<DeckCreationCanvas messages={messages} />);
    for (const p of ["fork", "clone", "ai_gen", "apply", "commit", "push"]) {
      expect(
        screen.getByTestId(`deck-creation-phase-chip-${p}`).getAttribute("data-state"),
      ).toBe("done");
    }
  });
});

describe("<DeckCreationCanvas> — file tree + content", () => {
  it("lists every file the model has emitted with state badges", () => {
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: "export const meta = {};",
            state: "done",
          },
          {
            path: "src/decks/public/my/index.tsx",
            content: "import { meta",
            state: "writing",
          },
        ],
        currentFile: "src/decks/public/my/index.tsx",
        draftId: "alice-com-my",
      }),
    ];

    render(<DeckCreationCanvas messages={messages} slug="my" />);

    // Both files appear in the tree.
    expect(
      screen.getByTestId(
        "deck-creation-file-tree-item-src/decks/public/my/meta.ts",
      ),
    ).toBeDefined();
    expect(
      screen.getByTestId(
        "deck-creation-file-tree-item-src/decks/public/my/index.tsx",
      ),
    ).toBeDefined();

    // State badges reflect snapshot.
    expect(
      screen
        .getByTestId(
          "deck-creation-file-state-src/decks/public/my/meta.ts",
        )
        .textContent?.toLowerCase(),
    ).toContain("done");
    expect(
      screen
        .getByTestId(
          "deck-creation-file-state-src/decks/public/my/index.tsx",
        )
        .textContent?.toLowerCase(),
    ).toContain("writing");

    // Display paths strip the deck folder prefix. (Each shows once
    // in the file tree AND once in the file-content header — at
    // minimum one occurrence proves the prefix-strip works.)
    expect(screen.getAllByText("meta.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/index\.tsx/).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("renders the currently-writing file's content with a streaming caret", () => {
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: "export const meta = { slug:",
            state: "writing",
          },
        ],
        currentFile: "src/decks/public/my/meta.ts",
      }),
    ];

    render(<DeckCreationCanvas messages={messages} slug="my" />);

    const content = screen.getByTestId("deck-creation-file-content");
    expect(content.getAttribute("data-path")).toBe(
      "src/decks/public/my/meta.ts",
    );
    expect(content.getAttribute("data-state")).toBe("writing");
    expect(
      screen
        .getByTestId("deck-creation-file-content-body")
        .textContent,
    ).toContain("export const meta = { slug:");
    expect(screen.getByTestId("deck-creation-writing-caret")).toBeDefined();
  });

  it("falls back to the last completed file when nothing is writing (post-AI-gen phases)", () => {
    const messages = [
      msgWithSnapshot({
        phase: "commit",
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: "export const meta = { slug: 'my' };",
            state: "done",
          },
          {
            path: "src/decks/public/my/index.tsx",
            content: "import { meta } from './meta';",
            state: "done",
          },
        ],
        commitMessage: "Initial",
      }),
    ];
    render(<DeckCreationCanvas messages={messages} slug="my" />);

    // The last file (index.tsx) is what's shown.
    expect(
      screen.getByTestId("deck-creation-file-content").getAttribute("data-path"),
    ).toBe("src/decks/public/my/index.tsx");
  });
});

describe("<DeckCreationCanvas> — error state", () => {
  it("shows the error overlay with the failed phase's heading", () => {
    const messages = [
      msgWithSnapshot({
        phase: "error",
        files: [],
        error: "ArtifactsError: An internal error occurred.",
        failedPhase: "fork",
      }),
    ];
    render(<DeckCreationCanvas messages={messages} />);

    expect(screen.getByTestId("deck-creation-error-overlay")).toBeDefined();
    expect(screen.getByText(/fork failed/i)).toBeDefined();
    expect(
      screen.getByTestId("deck-creation-error-message").textContent,
    ).toMatch(/ArtifactsError/);
    // Fork chip is marked failed.
    expect(
      screen
        .getByTestId("deck-creation-phase-chip-fork")
        .getAttribute("data-state"),
    ).toBe("failed");
  });

  it("renders a Retry button that invokes the onRetry callback", () => {
    const onRetry = vi.fn();
    const messages = [
      msgWithSnapshot({
        phase: "error",
        files: [],
        error: "Sandbox crashed",
        failedPhase: "apply",
      }),
    ];

    render(<DeckCreationCanvas messages={messages} onRetry={onRetry} />);
    fireEvent.click(screen.getByTestId("deck-creation-error-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides the Retry button when onRetry is undefined", () => {
    const messages = [
      msgWithSnapshot({
        phase: "error",
        files: [],
        error: "boom",
        failedPhase: "ai_gen",
      }),
    ];
    render(<DeckCreationCanvas messages={messages} />);
    expect(screen.queryByTestId("deck-creation-error-retry")).toBeNull();
  });
});

describe("<DeckCreationCanvas> — final lean result", () => {
  it("renders the success state when the tool finishes with a lean DeckDraftResult", () => {
    const messages: DeckCreationMessage[] = [
      {
        parts: [
          {
            type: "tool-createDeckDraft",
            toolCallId: "call-1",
            state: "output-available",
            output: {
              ok: true,
              draftId: "alice-com-my",
              commitSha: "abcdef1234567890",
              branch: "main",
              fileCount: 4,
              commitMessage: "Initial",
            },
          },
        ],
      },
    ];

    render(<DeckCreationCanvas messages={messages} />);
    expect(
      screen.getByTestId("deck-creation-canvas").getAttribute("data-state"),
    ).toBe("done");
    expect(screen.getByText(/Deck created/i)).toBeDefined();
    expect(screen.getByText(/abcdef1/i)).toBeDefined();
  });
});
