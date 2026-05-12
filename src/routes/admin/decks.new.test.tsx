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
import { cleanup, render, screen } from "@testing-library/react";
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
});
