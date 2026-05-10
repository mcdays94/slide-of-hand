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

function setupHooks({
  messages = [],
  status = "ready",
}: {
  messages?: Array<{
    id: string;
    role: "user" | "assistant";
    parts: Array<{ type: string; text?: string }>;
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
});
