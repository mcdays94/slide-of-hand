/**
 * Tests for `<StudioAgentPanel>` — the in-Studio AI chat panel
 * (issue #131 phase 1).
 *
 * `useAgent` and `useAgentChat` open a WebSocket and pull in heavy
 * chunks (~300 KB of `agents/react` + `@cloudflare/ai-chat/react` +
 * `ai` + `@ai-sdk/react`). Neither works in jsdom/happy-dom; both
 * are stubbed via `vi.mock`. These tests pin the wiring contract
 * around the SDK boundary, not the SDK itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

// Hoisted spies so `vi.mock` factories can reference them.
const { useAgentMock, useAgentChatMock, sendMessageMock, clearHistoryMock } =
  vi.hoisted(() => ({
    useAgentMock: vi.fn(),
    useAgentChatMock: vi.fn(),
    sendMessageMock: vi.fn(),
    clearHistoryMock: vi.fn(),
  }));

vi.mock("agents/react", () => ({
  useAgent: useAgentMock,
}));

vi.mock("@cloudflare/ai-chat/react", () => ({
  useAgentChat: useAgentChatMock,
}));

import { StudioAgentPanel } from "./StudioAgentPanel";
import { SettingsProvider } from "@/framework/viewer/useSettings";
import { DEFAULT_SETTINGS } from "@/lib/settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestMessagePart = any;

function setupHooks({
  messages = [],
  status = "ready",
}: {
  messages?: Array<{
    id: string;
    role: "user" | "assistant";
    parts: TestMessagePart[];
  }>;
  status?: "ready" | "submitted" | "streaming" | "error";
} = {}) {
  useAgentMock.mockReturnValue({
    agent: "deck-author-agent",
    name: "hello",
    getHttpUrl: () => "https://example.com/api/admin/agents/...",
  });
  useAgentChatMock.mockReturnValue({
    messages,
    sendMessage: sendMessageMock,
    clearHistory: clearHistoryMock,
    status,
    addToolOutput: vi.fn(),
    addToolApprovalResponse: vi.fn(),
    setMessages: vi.fn(),
    isStreaming: status === "streaming",
    isServerStreaming: false,
    isToolContinuation: false,
  });
}

afterEach(() => {
  cleanup();
  useAgentMock.mockReset();
  useAgentChatMock.mockReset();
  sendMessageMock.mockReset();
  clearHistoryMock.mockReset();
});

describe("<StudioAgentPanel>", () => {
  it("renders the panel with header + empty state on first open", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    expect(screen.getByTestId("studio-agent-panel")).toBeDefined();
    expect(screen.getByTestId("studio-agent-empty")).toBeDefined();
    // Header explains the assistant's scope.
    expect(screen.getByText(/AI assistant/i)).toBeDefined();
  });

  it("connects useAgent with the admin prefix and the deck slug as instance name", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="my-deck" onClose={vi.fn()} />);
    expect(useAgentMock).toHaveBeenCalledOnce();
    const [opts] = useAgentMock.mock.calls[0];
    expect(opts).toMatchObject({
      agent: "DeckAuthorAgent",
      name: "my-deck",
      prefix: "api/admin/agents",
    });
    // `query` is a dev-only auth fallback for WebSocket upgrades
    // on localhost (browsers can't set custom headers there).
    // happy-dom's default hostname is "localhost", so the test
    // environment exercises the dev branch — see getDevAuthQuery.
    expect(opts.query).toEqual({ "cf-access-auth-email": "dev@local" });
  });

  // Item A model-picker plumbing (issue #131). On every render the
  // panel reads `settings.aiAssistantModel` from `useSettings` and
  // passes it to `useAgentChat` via the `body` option. The server
  // (worker/agent.ts, `resolveAiAssistantModel`) re-validates against
  // the allow-list and resolves to the catalog ID.
  it("passes the default aiAssistantModel via useAgentChat's body when no provider is mounted", () => {
    // No `<SettingsProvider>` wrapping → `useSettings()` falls back
    // to DEFAULT_SETTINGS, so the body should carry the default key.
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    expect(useAgentChatMock).toHaveBeenCalled();
    const [chatOpts] = useAgentChatMock.mock.calls[0];
    expect(chatOpts.body).toEqual({
      model: DEFAULT_SETTINGS.aiAssistantModel,
    });
  });

  it("passes the user's chosen aiAssistantModel via useAgentChat's body when SettingsProvider supplies one", () => {
    setupHooks();
    render(
      <SettingsProvider
        initialSettings={{
          ...DEFAULT_SETTINGS,
          aiAssistantModel: "gpt-oss-120b",
        }}
      >
        <StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />
      </SettingsProvider>,
    );
    expect(useAgentChatMock).toHaveBeenCalled();
    const [chatOpts] = useAgentChatMock.mock.calls[0];
    expect(chatOpts.body).toEqual({ model: "gpt-oss-120b" });
  });

  it("renders a message list when messages exist", () => {
    setupHooks({
      messages: [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello there" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "Hi! How can I help?" }],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const bubbles = screen.getAllByTestId("studio-agent-message");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].dataset.role).toBe("user");
    expect(bubbles[0].textContent).toMatch(/Hello there/);
    expect(bubbles[1].dataset.role).toBe("assistant");
    expect(bubbles[1].textContent).toMatch(/How can I help/);
    // Empty state is gone once there are messages.
    expect(screen.queryByTestId("studio-agent-empty")).toBeNull();
  });

  // Markdown rendering on assistant messages — fix from 2026-05-11.
  // Before: assistant output like `**bold**` rendered as literal
  // asterisks. Now: render markdown via react-markdown so the user
  // sees formatted prose.
  it("renders assistant text via react-markdown (bold + list + code)", () => {
    setupHooks({
      messages: [
        {
          id: "1",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "This is **bold** and `code`.\n\n1. First\n2. Second",
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const md = screen.getByTestId("studio-agent-markdown");
    // Bold → <strong>, NOT literal `**` in the text.
    const strong = md.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("bold");
    expect(md.textContent).not.toMatch(/\*\*bold\*\*/);
    // Inline code → <code>.
    const code = md.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("code");
    // Ordered list → <ol> with <li>s.
    const ol = md.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders assistant markdown LINKS as target=_blank with rel=noopener", () => {
    // Links in assistant output (e.g. PR URLs from proposeSourceEdit)
    // should open in a new tab — clicking inside the chat panel
    // shouldn't navigate the studio away from the deck.
    setupHooks({
      messages: [
        {
          id: "1",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Opened a PR: [#999](https://github.com/x/y/pull/999)",
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const link = screen
      .getByTestId("studio-agent-markdown")
      .querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      "https://github.com/x/y/pull/999",
    );
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toMatch(/noopener/);
  });

  it("renders USER text as plain (not markdown — preserves their literal input)", () => {
    // Users don't write markdown; if they happen to type `**` we
    // want it to show as-is, not be silently rendered. Easier to
    // explain to the user + protects against accidental
    // formatting-via-typo.
    setupHooks({
      messages: [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "what about **bold** here?" }],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const userBubble = screen.getByTestId("studio-agent-text");
    // Literal asterisks survive (no react-markdown processing).
    expect(userBubble.textContent).toMatch(/\*\*bold\*\*/);
    // And no markdown container in a user bubble.
    expect(
      screen.queryByTestId("studio-agent-markdown"),
    ).toBeNull();
  });

  it("calls sendMessage with the trimmed input on submit + clears the input", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const input = screen.getByTestId(
      "studio-agent-input",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "  what's up?  " } });
    fireEvent.submit(screen.getByTestId("studio-agent-form"));
    expect(sendMessageMock).toHaveBeenCalledWith({ text: "what's up?" });
    expect(input.value).toBe("");
  });

  it("does NOT call sendMessage for an empty / whitespace-only input", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const input = screen.getByTestId("studio-agent-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(screen.getByTestId("studio-agent-form"));
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("disables the send button while the assistant is streaming", () => {
    setupHooks({ status: "streaming" });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const send = screen.getByTestId("studio-agent-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    // The composer surfaces a "thinking" affordance instead of the
    // keyboard hint when a turn is in flight.
    expect(screen.getByText(/thinking/i)).toBeDefined();
  });

  it("disables the send button when the input is empty (status=ready)", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const send = screen.getByTestId("studio-agent-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("hides the Clear button when there are no messages", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    expect(screen.queryByTestId("studio-agent-clear")).toBeNull();
  });

  it("shows a Clear button when there are messages and wires it to clearHistory", () => {
    setupHooks({
      messages: [
        { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const clear = screen.getByTestId("studio-agent-clear");
    fireEvent.click(clear);
    expect(clearHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("renders the close button with a Close (Esc) hint", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const close = screen.getByTestId("studio-agent-close");
    expect(close.getAttribute("title")).toMatch(/Esc/i);
    expect(close.getAttribute("aria-label")).toMatch(/close/i);
  });

  it("has role=dialog + aria-label for screen readers", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const panel = screen.getByTestId("studio-agent-panel");
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-label")).toMatch(/AI assistant/i);
  });

  // Click-to-advance suppression — issue #131 item C. The viewer's
  // `<Deck>` advances on any unsuppressed click inside the slide;
  // its suppressor selector (`[data-no-advance], [data-interactive],
  // a, button, input, select, textarea, label, [contenteditable=true]`)
  // does NOT cover `<details>` / `<summary>`, so a click on the
  // tool-card "Show JSON" expander would otherwise bubble all the way
  // up and advance the slide while expanding the panel. Mark the
  // whole panel surface — and the backdrop sibling — as `data-no-advance`
  // so the entire chat interface is opted out, including any future
  // controls we add inside it.
  it("has data-no-advance on the panel root so clicks inside don't advance the slide", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const panel = screen.getByTestId("studio-agent-panel");
    expect(panel.hasAttribute("data-no-advance")).toBe(true);
  });

  it("has data-no-advance on the backdrop so clicking to close doesn't also advance", () => {
    setupHooks();
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const backdrop = screen.getByTestId("studio-agent-backdrop");
    expect(backdrop.hasAttribute("data-no-advance")).toBe(true);
  });
});

describe("<StudioAgentPanel> — tool-call rendering (phase 2)", () => {
  it("renders a 'Calling <name>…' pill while a tool call is in progress", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-readDeck",
              toolCallId: "call-1",
              state: "input-available",
              input: {},
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.dataset.tool).toBe("readDeck");
    expect(pill.dataset.state).toBe("input-available");
    expect(pill.textContent).toMatch(/calling.*readDeck/i);
  });

  it("renders the readDeck output with a friendly summary line", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-readDeck",
              toolCallId: "call-1",
              state: "output-available",
              input: {},
              output: {
                found: true,
                deck: {
                  meta: { title: "My Talk", slug: "my-talk" },
                  slides: [{ id: "a" }, { id: "b" }, { id: "c" }],
                },
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/read deck/i);
    expect(pill.textContent).toMatch(/My Talk/);
    expect(pill.textContent).toMatch(/3 slides/);
    // Output JSON should also be present, expandable via <details>.
    const json = screen.getByTestId("studio-agent-tool-output-json");
    expect(json.textContent).toMatch(/found.*true/);
  });

  it("renders a readDeck result indicating a build-time deck (found:false)", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-readDeck",
              toolCallId: "call-1",
              state: "output-available",
              input: {},
              output: {
                found: false,
                reason: "Not a data deck — likely a build-time JSX deck",
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/build-time/i);
  });

  it("renders the proposePatch dry-run summary", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-proposePatch",
              toolCallId: "call-1",
              state: "output-available",
              input: { patch: { meta: { title: "Renamed" } } },
              output: {
                ok: true,
                dryRun: {
                  meta: { title: "Renamed", slug: "my-talk" },
                  slides: [{ id: "a" }],
                },
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/proposed change.*dry-run/i);
    expect(pill.textContent).toMatch(/not saved/i);
    expect(pill.textContent).toMatch(/Renamed/);
  });

  it("renders the proposePatch failure case with errors visible", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-proposePatch",
              toolCallId: "call-1",
              state: "output-available",
              input: { patch: { meta: { visibility: "weird" } } },
              output: {
                ok: false,
                errors: ['meta.visibility must be "public" or "private"'],
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/rejected/i);
    expect(pill.textContent).toMatch(/visibility/);
  });

  it("renders an output-error tool part with the SDK-supplied errorText", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-readDeck",
              toolCallId: "call-1",
              state: "output-error",
              input: {},
              errorText: "KV unreachable",
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.dataset.state).toBe("output-error");
    expect(pill.textContent).toMatch(/KV unreachable/);
  });

  it("renders both a text part and the tool calls that follow in the same assistant turn", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "text", text: "Let me check the deck first." },
            {
              type: "tool-readDeck",
              toolCallId: "call-1",
              state: "output-available",
              input: {},
              output: {
                found: true,
                deck: { meta: { title: "X" }, slides: [] },
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    expect(screen.getByTestId("studio-agent-text").textContent).toMatch(
      /check the deck first/,
    );
    expect(screen.getByTestId("studio-agent-tool-part")).toBeDefined();
  });

  it("renders a dynamic-tool part (defensive fallback for future MCP tools)", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "futureMcpTool",
              toolCallId: "call-1",
              state: "output-available",
              input: { foo: "bar" },
              output: { ok: true },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.dataset.tool).toBe("futureMcpTool");
    // Falls back to the generic "Tool result" label.
    expect(pill.textContent).toMatch(/tool result/i);
  });
});

// ─── Phase 3a + 3b tool summaries ────────────────────────────────────

describe("<StudioAgentPanel> — phase 3 tool-call rendering", () => {
  it("renders the commitPatch success summary including the GitHub commit sha", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-commitPatch",
              toolCallId: "call-1",
              state: "output-available",
              input: { patch: { meta: { title: "Renamed" } } },
              output: {
                ok: true,
                persistedToKv: true,
                deck: {
                  meta: { title: "Renamed", slug: "my-talk" },
                  slides: [{ id: "a" }],
                },
                githubCommit: {
                  ok: true,
                  commitSha: "abcdef1234567890",
                  commitHtmlUrl:
                    "https://github.com/mcdays94/slide-of-hand/commit/abcdef1234567890",
                  path: "data-decks/my-talk.json",
                },
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="my-talk" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/saved/i);
    expect(pill.textContent).toMatch(/Renamed/);
    expect(pill.textContent).toMatch(/abcdef1/); // first 7 chars of sha
  });

  it("renders commitPatch success without GitHub when the commit was skipped", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-commitPatch",
              toolCallId: "call-1",
              state: "output-available",
              input: { patch: { meta: { title: "T" } } },
              output: {
                ok: true,
                persistedToKv: true,
                deck: {
                  meta: { title: "T", slug: "x" },
                  slides: [],
                },
                githubCommit: {
                  ok: false,
                  reason:
                    "GitHub not connected. Open Settings → GitHub → Connect.",
                },
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="x" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/saved/i);
    expect(pill.textContent).not.toMatch(/commitsha/i);
  });

  it("renders commitPatch failure", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-commitPatch",
              toolCallId: "call-1",
              state: "output-available",
              input: { patch: {} },
              output: {
                ok: false,
                errors: ["meta.slug is required"],
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="x" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/commit failed/i);
    expect(pill.textContent).toMatch(/slug/);
  });

  it("renders the listSourceTree success summary", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-listSourceTree",
              toolCallId: "call-1",
              state: "output-available",
              input: { path: "src/decks/public/hello" },
              output: {
                ok: true,
                path: "src/decks/public/hello",
                ref: "main",
                items: [
                  { name: "01-title.tsx", path: "x", type: "file", size: 100 },
                  { name: "lib", path: "y", type: "dir", size: 0 },
                ],
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/listed source tree/i);
    expect(pill.textContent).toMatch(/2 items/);
    expect(pill.textContent).toMatch(/src\/decks\/public\/hello/);
  });

  it("renders the readSource success summary", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-readSource",
              toolCallId: "call-1",
              state: "output-available",
              input: { path: "src/decks/public/hello/01-title.tsx" },
              output: {
                ok: true,
                path: "src/decks/public/hello/01-title.tsx",
                ref: "main",
                content: "// ... file content ...",
                size: 2048,
                sha: "abc",
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/read source/i);
    expect(pill.textContent).toMatch(/01-title\.tsx/);
    expect(pill.textContent).toMatch(/2\.0 KB/);
  });

  it("renders listSourceTree / readSource failures with the error message", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-readSource",
              toolCallId: "call-1",
              state: "output-available",
              input: { path: "missing.ts" },
              output: {
                ok: false,
                error: "GitHub not connected. Open Settings → GitHub → Connect.",
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/read failed/i);
    expect(pill.textContent).toMatch(/Settings/);
  });
});

// ─── proposeSourceEdit summary card (issue #131 phase 3c) ───────────

describe("<StudioAgentPanel> — proposeSourceEdit tool-call rendering", () => {
  it("renders the success card with PR number, branch, and a 'View →' link", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-proposeSourceEdit",
              toolCallId: "call-1",
              state: "output-available",
              input: {
                files: [{ path: "src/decks/public/hello/01.tsx", content: "..." }],
                summary: "tighten title slide copy",
              },
              output: {
                ok: true,
                prNumber: 999,
                prHtmlUrl: "https://github.com/mcdays94/slide-of-hand/pull/999",
                branch: "agent/hello-1715425200000",
                commitSha: "abcdef0123456789abcdef0123456789abcdef01",
                testGatePhases: [],
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.dataset.tool).toBe("proposeSourceEdit");
    expect(pill.textContent).toMatch(/opened draft pr/i);
    expect(pill.textContent).toMatch(/#999/);
    expect(pill.textContent).toMatch(/agent\/hello-/);
    // The View → link points at the PR URL and opens in a new tab.
    const link = screen.getByTestId("studio-agent-tool-link");
    expect(link.getAttribute("href")).toBe(
      "https://github.com/mcdays94/slide-of-hand/pull/999",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    // `data-interactive` so clicking it doesn't bubble to <Deck>'s
    // click-to-advance handler.
    expect(link.hasAttribute("data-interactive")).toBe(true);
  });

  it("renders the test-gate failure card with the failed phase surfaced", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-proposeSourceEdit",
              toolCallId: "call-1",
              state: "output-available",
              input: { files: [], summary: "x" },
              output: {
                ok: false,
                phase: "test_gate",
                failedTestGatePhase: "typecheck",
                testGatePhases: [],
                error: "Test gate failed at the `typecheck` phase.",
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/test gate failed/i);
    expect(pill.textContent).toMatch(/typecheck/);
    // No "View →" link on failure cards.
    expect(screen.queryByTestId("studio-agent-tool-link")).toBeNull();
  });

  it("renders the apply-phase failure with the failedPath surfaced", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-proposeSourceEdit",
              toolCallId: "call-1",
              state: "output-available",
              input: { files: [], summary: "x" },
              output: {
                ok: false,
                phase: "apply",
                failedPath: "/etc/passwd",
                error: "Path must be relative (no leading '/')",
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/file edit rejected/i);
    expect(pill.textContent).toMatch(/\/etc\/passwd/);
  });

  it("renders the no-effective-changes branch with a distinct label", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-proposeSourceEdit",
              toolCallId: "call-1",
              state: "output-available",
              input: { files: [], summary: "x" },
              output: {
                ok: false,
                phase: "commit_push",
                noEffectiveChanges: true,
                error: "No effective changes to commit.",
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/no effective changes/i);
  });

  it("renders the github-not-connected branch with a friendly label", () => {
    setupHooks({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-proposeSourceEdit",
              toolCallId: "call-1",
              state: "output-available",
              input: { files: [], summary: "x" },
              output: {
                ok: false,
                phase: "github_token",
                error: "GitHub not connected. Open Settings → GitHub → Connect.",
              },
            },
          ],
        },
      ],
    });
    render(<StudioAgentPanel deckSlug="hello" onClose={vi.fn()} />);
    const pill = screen.getByTestId("studio-agent-tool-part");
    expect(pill.textContent).toMatch(/github not connected/i);
    expect(pill.textContent).toMatch(/Settings/);
  });
});
