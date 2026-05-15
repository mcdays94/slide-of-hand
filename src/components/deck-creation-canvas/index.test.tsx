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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

// Mock the shared Shiki helper. The real module dynamic-imports
// `shiki/core` + grammar bundles on first call; we don't want to
// pay that cost in a unit test, and we need deterministic HTML for
// assertions. The mock preserves the source code verbatim inside a
// minimal Shiki-shaped wrapper so `textContent` still matches the
// original input. Mirrors the pattern in `CodeSlotEditor.test.tsx`
// + `render.test.tsx`, but at the shared-module boundary rather
// than the granular shiki imports — simpler for this surface.
const { highlightSpy, isSupportedLangMock } = vi.hoisted(() => {
  const SUPPORTED = new Set([
    "ts",
    "js",
    "tsx",
    "jsx",
    "json",
    "html",
    "css",
    "sh",
    "sql",
    "python",
    "ruby",
    "go",
    "rust",
    "yaml",
    "md",
  ]);
  return {
    highlightSpy: vi.fn(async (code: string, lang: string) => {
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<pre class="shiki" data-lang="${lang}" style="background-color:#fff"><code>${escaped}</code></pre>`;
    }),
    isSupportedLangMock: vi.fn((lang: string) => SUPPORTED.has(lang)),
  };
});
vi.mock("@/lib/shiki", () => ({
  highlight: highlightSpy,
  isSupportedLang: isSupportedLangMock,
}));

import { DeckCreationCanvas } from "./index";
import type { DeckCreationMessage } from "./extractLatestCall";

afterEach(() => {
  cleanup();
  highlightSpy.mockClear();
});

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

// Issue #178 polish — syntax highlighting on the file content panel.
// First paint renders plain text (so layout doesn't shift on
// resolution); a useEffect then calls the shared Shiki helper and
// swaps in the highlighted HTML. Mirrors the lazy-load posture used
// by <ShikiCodeBlock> in src/framework/templates/render.tsx.
describe("<DeckCreationCanvas> — syntax highlighting", () => {
  it("calls highlight() with the file content and a tsx lang for a .tsx path", async () => {
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [
          {
            path: "src/decks/public/my/index.tsx",
            content: "export default {};",
            state: "writing",
          },
        ],
        currentFile: "src/decks/public/my/index.tsx",
      }),
    ];
    render(<DeckCreationCanvas messages={messages} slug="my" />);
    await waitFor(() => {
      expect(highlightSpy).toHaveBeenCalledWith("export default {};", "tsx");
    });
  });

  it("derives lang=ts for .ts paths (e.g. meta.ts)", async () => {
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: "export const meta = {};",
            state: "writing",
          },
        ],
        currentFile: "src/decks/public/my/meta.ts",
      }),
    ];
    render(<DeckCreationCanvas messages={messages} slug="my" />);
    await waitFor(() => {
      expect(highlightSpy).toHaveBeenCalledWith("export const meta = {};", "ts");
    });
  });

  it("does NOT call highlight when the file extension is unsupported (renders plain)", async () => {
    // .gitkeep or other extensions outside Shiki's allowlist — we
    // skip the call entirely rather than rely on Shiki's fallback.
    // Saves a tokenizer round-trip per unknown extension.
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [
          {
            path: "src/decks/public/my/.gitkeep",
            content: "",
            state: "done",
          },
        ],
        currentFile: "src/decks/public/my/.gitkeep",
      }),
    ];
    render(<DeckCreationCanvas messages={messages} slug="my" />);
    // Give the useEffect a microtask to fire. If we were going to
    // call highlight, it would happen by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(highlightSpy).not.toHaveBeenCalled();
  });

  it("swaps the plain pre/code for highlighted HTML once Shiki resolves", async () => {
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [
          {
            path: "src/decks/public/my/index.tsx",
            content: "export default {};",
            state: "writing",
          },
        ],
        currentFile: "src/decks/public/my/index.tsx",
      }),
    ];
    const { container } = render(
      <DeckCreationCanvas messages={messages} slug="my" />,
    );
    // After Shiki resolves, the body should contain a Shiki pre with
    // the `shiki` class (our mock emits one). Wait for that.
    await waitFor(() => {
      expect(container.querySelector("pre.shiki")).not.toBeNull();
    });
    // The writing caret is still rendered (outside the highlighted
    // block) — the streaming indicator must survive the swap.
    expect(screen.getByTestId("deck-creation-writing-caret")).toBeDefined();
    // textContent on the body still includes the source code so any
    // accessibility / scraping consumers still get a readable
    // transcript.
    expect(
      screen
        .getByTestId("deck-creation-file-content-body")
        .textContent ?? "",
    ).toContain("export default {};");
  });

  it("re-highlights when the file content changes between renders", async () => {
    const buildMessages = (content: string) => [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [
          {
            path: "src/decks/public/my/index.tsx",
            content,
            state: "writing",
          },
        ],
        currentFile: "src/decks/public/my/index.tsx",
      }),
    ];

    const view = render(
      <DeckCreationCanvas messages={buildMessages("export default")} slug="my" />,
    );
    await waitFor(() => {
      expect(highlightSpy).toHaveBeenCalledWith("export default", "tsx");
    });
    highlightSpy.mockClear();

    // Simulate a streaming update: more content arrives on the next
    // frame. The useEffect deps include `file.content`, so the
    // helper should re-fire.
    view.rerender(
      <DeckCreationCanvas
        messages={buildMessages("export default {};")}
        slug="my"
      />,
    );
    await waitFor(() => {
      expect(highlightSpy).toHaveBeenCalledWith("export default {};", "tsx");
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// `ai_gen` empty-state progress overlay.
//
// During `ai_gen` the model runs `generateObject` single-shot — no files land
// for ~1-3 minutes, then all files appear at once. The canvas used to look
// dead for the whole window. The overlay below replaces the empty file-tree
// grid with a clear "Composing your deck" indicator + elapsed timer so the
// user knows the AI is working. See ComposingOverlay.tsx.
// ────────────────────────────────────────────────────────────────────────────
describe("<DeckCreationCanvas> — ai_gen composing overlay", () => {
  it("renders the composing overlay when phase === 'ai_gen' AND files is empty", () => {
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [],
      }),
    ];
    render(<DeckCreationCanvas messages={messages} />);

    const overlay = screen.getByTestId("deck-creation-composing-overlay");
    expect(overlay).toBeDefined();
    expect(screen.getByText(/Composing your deck/i)).toBeDefined();
    expect(screen.getByText(/Typically 1-3 minutes/i)).toBeDefined();
  });

  it("renders the PhaseStrip alongside the overlay so the user still sees ai_gen as active", () => {
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [],
      }),
    ];
    render(<DeckCreationCanvas messages={messages} />);

    // PhaseStrip remains visible above the overlay.
    expect(screen.getByTestId("deck-creation-phase-strip")).toBeDefined();
    expect(
      screen
        .getByTestId("deck-creation-phase-chip-ai_gen")
        .getAttribute("data-state"),
    ).toBe("current");

    // The grid (file tree + content) is hidden during this state — the
    // overlay takes over the body area. The tree's testid (which the file-
    // list tests above rely on) is not in the DOM.
    expect(
      screen.queryByTestId(
        "deck-creation-file-tree-item-src/decks/public/my/meta.ts",
      ),
    ).toBeNull();
  });

  it("does NOT render the composing overlay once files start to land", () => {
    const messages = [
      msgWithSnapshot({
        phase: "ai_gen",
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: "export const meta = {};",
            state: "writing",
          },
        ],
        currentFile: "src/decks/public/my/meta.ts",
      }),
    ];
    render(<DeckCreationCanvas messages={messages} slug="my" />);

    expect(
      screen.queryByTestId("deck-creation-composing-overlay"),
    ).toBeNull();
  });

  it("does NOT render the composing overlay in any non-ai_gen phase, even with empty files", () => {
    const messages = [
      msgWithSnapshot({
        phase: "clone",
        files: [],
      }),
    ];
    render(<DeckCreationCanvas messages={messages} />);

    expect(
      screen.queryByTestId("deck-creation-composing-overlay"),
    ).toBeNull();
  });

  describe("elapsed timer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts at 0:00 and advances every second in mm:ss format", () => {
      const messages = [
        msgWithSnapshot({
          phase: "ai_gen",
          files: [],
        }),
      ];
      render(<DeckCreationCanvas messages={messages} />);

      const timer = screen.getByTestId("deck-creation-composing-timer");
      expect(timer.textContent).toBe("0:00");

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(timer.textContent).toBe("0:01");

      act(() => {
        vi.advanceTimersByTime(22_000);
      });
      expect(timer.textContent).toBe("0:23");

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(timer.textContent).toBe("1:23");
    });

    it("resets to 0:00 when the overlay re-mounts (new ai_gen with empty files)", () => {
      const composing = msgWithSnapshot({
        phase: "ai_gen",
        files: [],
      });
      const populated = msgWithSnapshot({
        phase: "ai_gen",
        files: [
          {
            path: "src/decks/public/my/meta.ts",
            content: "...",
            state: "done",
          },
        ],
      });

      const view = render(<DeckCreationCanvas messages={[composing]} />);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(
        screen.getByTestId("deck-creation-composing-timer").textContent,
      ).toBe("0:05");

      // Files land — overlay unmounts.
      view.rerender(<DeckCreationCanvas messages={[populated]} slug="my" />);
      expect(
        screen.queryByTestId("deck-creation-composing-timer"),
      ).toBeNull();

      // A second generation kicks off (e.g. iteration on a new draft) —
      // overlay remounts, timer should restart from 0:00 (not pick up
      // the prior 0:05).
      view.rerender(<DeckCreationCanvas messages={[composing]} />);
      expect(
        screen.getByTestId("deck-creation-composing-timer").textContent,
      ).toBe("0:00");
    });
  });
});
