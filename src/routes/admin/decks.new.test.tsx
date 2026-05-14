/**
 * Tests for `/admin/decks/new` (issue #171 — AI-first new-deck
 * creator). The page is thin: a header + a lazy-mounted
 * `<StudioAgentPanel variant="page" />` with custom empty-state
 * copy. We assert the route's shape (header, back-link, page
 * variant mount, custom empty state) rather than the panel's
 * internals (those are covered exhaustively in
 * `src/components/StudioAgentPanel.test.tsx`).
 *
 * The agent hooks (`useAgent`, `useAgentChat`) and the Access auth
 * probe (`useAccessAuth`) are mocked to avoid a real WebSocket
 * upgrade and HTTP fetch in the test environment. Same mock shape
 * as the StudioAgentPanel test file.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Hoisted spies so `vi.mock` factories can reference them.
const { useAgentMock, useAgentChatMock, useAccessAuthMock } = vi.hoisted(
  () => ({
    useAgentMock: vi.fn(),
    useAgentChatMock: vi.fn(),
    useAccessAuthMock: vi.fn(),
  }),
);

vi.mock("agents/react", () => ({
  useAgent: useAgentMock,
}));

vi.mock("@cloudflare/ai-chat/react", () => ({
  useAgentChat: useAgentChatMock,
}));

vi.mock("@/lib/use-access-auth", () => ({
  useAccessAuth: useAccessAuthMock,
}));

// Mock the shared Shiki helper. FileContent (mounted inside the
// canvas, mounted inside the panel's left pane) calls highlight()
// on every file-content change. Without the mock the real module's
// dynamic-import chain fires — works in vitest but adds noise and
// risks flake if any future test waits on the highlighted output.
// Identity-ish output so assertions on body textContent still pass.
vi.mock("@/lib/shiki", () => {
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
    highlight: vi.fn(async (code: string, lang: string) => {
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<pre class="shiki" data-lang="${lang}"><code>${escaped}</code></pre>`;
    }),
    isSupportedLang: vi.fn((lang: string) => SUPPORTED.has(lang)),
  };
});

import NewDeckRoute from "./decks.new";

function setupHooks() {
  useAgentMock.mockReturnValue({
    agent: "DeckAuthorAgent",
    name: "new-deck-test-uuid",
    getHttpUrl: () => "https://example.com/api/admin/agents/...",
  });
  useAgentChatMock.mockReturnValue({
    messages: [],
    sendMessage: vi.fn(),
    clearHistory: vi.fn(),
    stop: vi.fn(),
    status: "ready",
    addToolOutput: vi.fn(),
    addToolApprovalResponse: vi.fn(),
    setMessages: vi.fn(),
    isStreaming: false,
    isServerStreaming: false,
    isToolContinuation: false,
  });
  useAccessAuthMock.mockReturnValue("authenticated");
}

afterEach(() => {
  cleanup();
  useAgentMock.mockReset();
  useAgentChatMock.mockReset();
  useAccessAuthMock.mockReset();
});

/**
 * Render `<NewDeckRoute>` inside a MemoryRouter so `useNavigate` /
 * `<Link>` resolve correctly. We mount it at `/admin/decks/new` to
 * match production routing.
 */
async function renderRoute() {
  const view = render(
    <MemoryRouter initialEntries={["/admin/decks/new"]}>
      <Routes>
        <Route path="/admin/decks/new" element={<NewDeckRoute />} />
        <Route path="/admin" element={<div data-testid="admin-index">admin</div>} />
      </Routes>
    </MemoryRouter>,
  );
  // The panel is lazy-loaded. Wait for it to resolve.
  await screen.findByTestId("studio-agent-panel");
  return view;
}

describe("<NewDeckRoute>", () => {
  it("renders the page-level header with title + description", async () => {
    setupHooks();
    await renderRoute();
    expect(screen.getByTestId("new-deck-route")).toBeDefined();
    expect(
      screen.getByRole("heading", { name: /build a deck with ai/i }),
    ).toBeDefined();
    // The description should reference Artifacts (the storage layer)
    // so the user knows where the draft is going.
    expect(screen.getByText(/cloudflare artifacts/i)).toBeDefined();
  });

  it("renders an Alpha pill next to the New deck kicker (#215)", async () => {
    setupHooks();
    await renderRoute();
    const pill = screen.getByTestId("ai-deck-creator-alpha-pill");
    expect(pill).toBeDefined();
    // Visible label is the single word.
    expect(pill.textContent?.trim()).toBe("Alpha");
    // Hover / SR explanation conveys WHY this is marked alpha — output
    // variability, model failures, stubbed preview. Matches the issue's
    // intent.
    const title = pill.getAttribute("title") ?? "";
    expect(title).toMatch(/alpha/i);
    expect(title).toMatch(/output quality/i);
    // ARIA label is set for screen readers (the visible label alone is
    // insufficient context).
    expect(pill.getAttribute("aria-label")).toMatch(/experimental/i);
  });

  it("renders a Back to decks link pointing at /admin", async () => {
    setupHooks();
    await renderRoute();
    const back = screen.getByRole("link", { name: /back to decks/i });
    expect(back).toBeDefined();
    expect(back.getAttribute("href")).toBe("/admin");
  });

  it("mounts the StudioAgentPanel in page variant (no slide-out chrome)", async () => {
    setupHooks();
    await renderRoute();
    const panel = screen.getByTestId("studio-agent-panel");
    // The variant prop surfaces as a data attribute on the panel
    // root — see StudioAgentPanel.tsx for the contract.
    expect(panel.dataset.variant).toBe("page");
    // Backdrop is suppressed in page variant (the panel IS the
    // page surface, no underlying content to dim).
    expect(screen.queryByTestId("studio-agent-backdrop")).toBeNull();
  });

  it("uses a per-tab agent name with the new-deck- prefix", async () => {
    setupHooks();
    await renderRoute();
    const [opts] = useAgentMock.mock.calls[0];
    // Conversation history isolated per-tab: the DO instance name
    // is a fresh UUID prefixed with `new-deck-` so wrangler tail
    // shows what kind of conversation this is.
    expect(opts.name).toMatch(/^new-deck-/);
  });

  it("renders the new-deck-specific empty state, not the default", async () => {
    setupHooks();
    await renderRoute();
    // The empty state is suppressed in the default panel copy and
    // replaced with the new-deck-specific prompt-hint. The
    // historic "Ask me anything about your deck" line MUST NOT
    // appear — that's the existing-deck context.
    expect(screen.queryByText(/ask me anything about your deck/i)).toBeNull();
    expect(
      screen.getByText(/what deck would you like to build/i),
    ).toBeDefined();
  });

  it("mounts the panel as connected to DeckAuthorAgent under the admin prefix", async () => {
    setupHooks();
    await renderRoute();
    const [opts] = useAgentMock.mock.calls[0];
    expect(opts).toMatchObject({
      agent: "DeckAuthorAgent",
      prefix: "api/admin/agents",
    });
  });

  // Issue #171 visibility toggle — the user's choice on this surface
  // threads through useAgentChat's `body` so the agent's
  // `onChatMessage` sees it on every turn and can pass it through
  // to `createDeckDraft`. Default is "private".
  describe("visibility toggle", () => {
    it("renders both visibility options with the private one active by default", async () => {
      setupHooks();
      await renderRoute();
      expect(screen.getByTestId("new-deck-visibility")).toBeDefined();
      const privateBtn = screen.getByTestId("new-deck-visibility-private");
      const publicBtn = screen.getByTestId("new-deck-visibility-public");
      expect(privateBtn.getAttribute("aria-checked")).toBe("true");
      expect(publicBtn.getAttribute("aria-checked")).toBe("false");
    });

    it("passes visibility through useAgentChat's body (defaults to private)", async () => {
      setupHooks();
      await renderRoute();
      const [chatOpts] = useAgentChatMock.mock.calls[0];
      // The body merges extraBody (visibility) BEFORE the model
      // key, so model is last and wins on collisions. visibility
      // sits alongside it.
      expect(chatOpts.body).toMatchObject({ visibility: "private" });
    });

    it("flips visibility to public when the public button is clicked", async () => {
      setupHooks();
      await renderRoute();
      fireEvent.click(screen.getByTestId("new-deck-visibility-public"));
      // The panel re-renders with the new body. Look at the last
      // call to useAgentChat for the up-to-date body.
      const calls = useAgentChatMock.mock.calls;
      const latest = calls[calls.length - 1][0];
      expect(latest.body).toMatchObject({ visibility: "public" });
    });

    it("flips active aria-checked on click", async () => {
      setupHooks();
      await renderRoute();
      fireEvent.click(screen.getByTestId("new-deck-visibility-public"));
      const privateBtn = screen.getByTestId("new-deck-visibility-private");
      const publicBtn = screen.getByTestId("new-deck-visibility-public");
      expect(privateBtn.getAttribute("aria-checked")).toBe("false");
      expect(publicBtn.getAttribute("aria-checked")).toBe("true");
    });

    // Issue #178 polish — once the canvas pivots (the model fired a
    // `createDeckDraft` or `iterateOnDeckDraft` tool-call) the
    // visibility toggle becomes a no-op: the draft has already been
    // created with the chosen value, and changing it from the UI
    // wouldn't propagate. Replace the interactive segmented control
    // with a static chip showing the chosen value so the user can
    // see what they picked but can't pointlessly fiddle with it.
    describe("post-pivot chip", () => {
      it("hides the interactive selector and renders a static chip once a deck-creation tool-call lands", async () => {
        useAgentMock.mockReturnValue({
          agent: "DeckAuthorAgent",
          name: "new-deck-test-uuid",
          getHttpUrl: () => "https://example.com/api/admin/agents/...",
        });
        useAgentChatMock.mockReturnValue({
          messages: [
            {
              id: "msg-1",
              role: "assistant",
              parts: [
                {
                  type: "tool-createDeckDraft",
                  toolCallId: "call-1",
                  state: "output-available",
                  output: {
                    phase: "ai_gen",
                    files: [],
                    draftId: "test-com-hello",
                  },
                },
              ],
            },
          ],
          sendMessage: vi.fn(),
          clearHistory: vi.fn(),
          stop: vi.fn(),
          status: "streaming",
          addToolOutput: vi.fn(),
          addToolApprovalResponse: vi.fn(),
          setMessages: vi.fn(),
          isStreaming: true,
          isServerStreaming: false,
          isToolContinuation: false,
        });
        useAccessAuthMock.mockReturnValue("authenticated");

        await renderRoute();

        // Interactive segmented control is gone (its testid'd root
        // and both button testids disappear together so we can't
        // accidentally pass on a "container kept, buttons removed"
        // half-implementation).
        expect(screen.queryByTestId("new-deck-visibility")).toBeNull();
        expect(screen.queryByTestId("new-deck-visibility-private")).toBeNull();
        expect(screen.queryByTestId("new-deck-visibility-public")).toBeNull();

        // Static chip is present, showing the default Private value.
        const chip = screen.getByTestId("new-deck-visibility-chip");
        expect(chip.textContent ?? "").toMatch(/private/i);
        // It must NOT be a button or a radio control — it's purely
        // informational. (No `role="radio"`, no `<button>`.)
        expect(chip.getAttribute("role")).not.toBe("radio");
        expect(chip.tagName.toLowerCase()).not.toBe("button");
      });
    });
  });

  // Issue #178 polish — the canvas's ErrorOverlay shows a Retry
  // button when the route wires `onRetry`. The route's job is to
  // remember the last user prompt so a click re-sends it without
  // making the user retype.
  describe("retry button wiring", () => {
    it("re-sends the most recent user prompt when Retry is clicked on the error overlay", async () => {
      const sendMessage = vi.fn();
      useAgentMock.mockReturnValue({
        agent: "DeckAuthorAgent",
        name: "new-deck-test-uuid",
        getHttpUrl: () => "https://example.com/api/admin/agents/...",
      });
      useAgentChatMock.mockReturnValue({
        messages: [
          // Prior user prompt — the one we want re-sent.
          {
            id: "msg-user",
            role: "user",
            parts: [
              { type: "text", text: "Build me a deck about CRDT collaborative editing" },
            ],
          },
          // Assistant's tool-call landed in an error phase.
          {
            id: "msg-assistant",
            role: "assistant",
            parts: [
              {
                type: "tool-createDeckDraft",
                toolCallId: "call-1",
                state: "output-available",
                output: {
                  phase: "error",
                  files: [],
                  error: "Fork failed: ArtifactsError: An internal error occurred.",
                  failedPhase: "fork",
                  draftId: "test-com-crdt",
                },
              },
            ],
          },
        ],
        sendMessage,
        clearHistory: vi.fn(),
        stop: vi.fn(),
        status: "ready",
        addToolOutput: vi.fn(),
        addToolApprovalResponse: vi.fn(),
        setMessages: vi.fn(),
        isStreaming: false,
        isServerStreaming: false,
        isToolContinuation: false,
      });
      useAccessAuthMock.mockReturnValue("authenticated");

      await renderRoute();
      // Sanity: the error overlay is on screen with the Retry button.
      expect(screen.getByTestId("deck-creation-error-overlay")).toBeDefined();
      fireEvent.click(screen.getByTestId("deck-creation-error-retry"));
      // The route plumbed sendMessage from useAgentChat into the
      // canvas's onRetry handler, with the original user prompt.
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith({
        text: "Build me a deck about CRDT collaborative editing",
      });
    });

    it("hides the Retry button when there's no prior user prompt to re-send", async () => {
      // Defensive: in the (unlikely) case the chat history has an
      // assistant tool-call error but no preceding user text part,
      // we shouldn't render a Retry button — clicking it would
      // sendMessage("") which is just noise. The canvas already
      // hides the button when onRetry is undefined; this asserts
      // the route doesn't manufacture an empty-string onRetry.
      useAgentMock.mockReturnValue({
        agent: "DeckAuthorAgent",
        name: "new-deck-test-uuid",
        getHttpUrl: () => "https://example.com/api/admin/agents/...",
      });
      useAgentChatMock.mockReturnValue({
        messages: [
          {
            id: "msg-assistant",
            role: "assistant",
            parts: [
              {
                type: "tool-createDeckDraft",
                toolCallId: "call-1",
                state: "output-available",
                output: {
                  phase: "error",
                  files: [],
                  error: "boom",
                  failedPhase: "ai_gen",
                  draftId: "test-com-orphan",
                },
              },
            ],
          },
        ],
        sendMessage: vi.fn(),
        clearHistory: vi.fn(),
        stop: vi.fn(),
        status: "ready",
        addToolOutput: vi.fn(),
        addToolApprovalResponse: vi.fn(),
        setMessages: vi.fn(),
        isStreaming: false,
        isServerStreaming: false,
        isToolContinuation: false,
      });
      useAccessAuthMock.mockReturnValue("authenticated");

      await renderRoute();
      expect(screen.getByTestId("deck-creation-error-overlay")).toBeDefined();
      // No retry button — overlay still shows the heading + message,
      // just not the affordance.
      expect(screen.queryByTestId("deck-creation-error-retry")).toBeNull();
    });
  });

  // Issue #178 sub-pieces 1 + 3 — the deck-creation canvas mounts
  // as a left-pane slot the moment the model fires a
  // `createDeckDraft` or `iterateOnDeckDraft` tool call.
  describe("deck-creation canvas wiring", () => {
    it("does NOT render the canvas in the empty state (no tool calls yet)", async () => {
      setupHooks();
      await renderRoute();
      expect(screen.queryByTestId("deck-creation-canvas")).toBeNull();
      expect(screen.queryByTestId("studio-agent-split-layout")).toBeNull();
    });

    it("pivots to a split layout with the canvas when a createDeckDraft tool-call lands", async () => {
      useAgentMock.mockReturnValue({
        agent: "DeckAuthorAgent",
        name: "new-deck-test-uuid",
        getHttpUrl: () => "https://example.com/api/admin/agents/...",
      });
      useAgentChatMock.mockReturnValue({
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            parts: [
              {
                type: "tool-createDeckDraft",
                toolCallId: "call-1",
                state: "output-available",
                output: {
                  phase: "ai_gen",
                  files: [
                    {
                      path: "src/decks/public/hello/meta.ts",
                      content: "export const meta = { slug:",
                      state: "writing",
                    },
                  ],
                  currentFile: "src/decks/public/hello/meta.ts",
                  draftId: "test-com-hello",
                },
              },
            ],
          },
        ],
        sendMessage: vi.fn(),
        clearHistory: vi.fn(),
        stop: vi.fn(),
        status: "streaming",
        addToolOutput: vi.fn(),
        addToolApprovalResponse: vi.fn(),
        setMessages: vi.fn(),
        isStreaming: true,
        isServerStreaming: false,
        isToolContinuation: false,
      });
      useAccessAuthMock.mockReturnValue("authenticated");

      await renderRoute();

      // Split layout container appears.
      expect(screen.getByTestId("studio-agent-split-layout")).toBeDefined();
      expect(screen.getByTestId("studio-agent-left-pane")).toBeDefined();
      // The canvas renders inside the left pane with the snapshot's
      // phase reflected as the data-state.
      const canvas = screen.getByTestId("deck-creation-canvas");
      expect(canvas.getAttribute("data-state")).toBe("ai_gen");
      // The streaming file is rendered with its writing caret.
      expect(screen.getByTestId("deck-creation-writing-caret")).toBeDefined();
    });
  });
});
