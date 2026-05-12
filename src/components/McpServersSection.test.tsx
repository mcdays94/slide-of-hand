/**
 * Tests for `<McpServersSection>` — the Settings-modal subsection for
 * the per-user MCP server registry (issue #168 Wave 6 / Worker C).
 *
 * Mocks `useMcpServers` so the component is exercised in isolation;
 * the hook itself is tested separately in `use-mcp-servers.test.ts`.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { McpServerPublic } from "@/lib/use-mcp-servers";

const { useMcpServersMock } = vi.hoisted(() => ({
  useMcpServersMock: vi.fn(),
}));
vi.mock("@/lib/use-mcp-servers", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/use-mcp-servers")>(
      "@/lib/use-mcp-servers",
    );
  return {
    ...actual,
    useMcpServers: useMcpServersMock,
  };
});

import { McpServersSection } from "./McpServersSection";

function buildHookValue(overrides: Partial<ReturnType<typeof useMcpServersMock>> = {}) {
  return {
    servers: [] as McpServerPublic[],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    addServer: vi.fn().mockResolvedValue({ ok: true }),
    deleteServer: vi.fn().mockResolvedValue({ ok: true }),
    probeHealth: vi.fn().mockResolvedValue({ ok: true, toolCount: 0 }),
    ...overrides,
  };
}

beforeEach(() => {
  useMcpServersMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("<McpServersSection> — empty state", () => {
  it("renders the section header + empty state when no servers are configured", () => {
    useMcpServersMock.mockReturnValue(buildHookValue());
    render(<McpServersSection />);
    // The header is a <p> with font-medium — match that one specifically.
    // (The string "MCP servers" also appears in the description paragraph
    // beneath, so a bare /MCP servers/i would match twice.)
    expect(
      screen.getByTestId("settings-modal-mcp-servers"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("settings-modal-mcp-servers-empty"),
    ).toBeInTheDocument();
  });

  it("surfaces an error banner when the hook reports an error", () => {
    useMcpServersMock.mockReturnValue(
      buildHookValue({ error: "MCP_SERVERS not bound" }),
    );
    render(<McpServersSection />);
    expect(
      screen.getByTestId("settings-modal-mcp-servers-error"),
    ).toHaveTextContent("MCP_SERVERS not bound");
  });
});

describe("<McpServersSection> — server list", () => {
  it("renders one row per configured server with name + URL + token badge", () => {
    useMcpServersMock.mockReturnValue(
      buildHookValue({
        servers: [
          {
            id: "a",
            name: "Internal Docs",
            url: "https://docs.example.com",
            enabled: true,
            hasBearerToken: true,
          },
          {
            id: "b",
            name: "Public API",
            url: "https://public.example.com",
            enabled: true,
          },
        ],
      }),
    );
    render(<McpServersSection />);
    expect(screen.getByText("Internal Docs")).toBeInTheDocument();
    expect(screen.getByText("https://docs.example.com")).toBeInTheDocument();
    expect(screen.getByText("Public API")).toBeInTheDocument();

    // Token badge is per-row. Only the first row shows it.
    expect(
      screen.getByTestId("settings-modal-mcp-servers-row-a"),
    ).toHaveTextContent(/Bearer token configured/i);
    expect(
      screen.getByTestId("settings-modal-mcp-servers-row-b"),
    ).not.toHaveTextContent(/Bearer token configured/i);
  });

  it("calls probeHealth and renders the health badge", async () => {
    const probeHealth = vi
      .fn()
      .mockResolvedValue({ ok: true, toolCount: 7 });
    useMcpServersMock.mockReturnValue(
      buildHookValue({
        servers: [
          { id: "a", name: "x", url: "https://x.example.com", enabled: true },
        ],
        probeHealth,
      }),
    );
    render(<McpServersSection />);

    const probeBtn = screen.getByTestId(
      "settings-modal-mcp-servers-row-a-probe",
    );
    fireEvent.click(probeBtn);

    await waitFor(() =>
      expect(probeHealth).toHaveBeenCalledWith("a"),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("settings-modal-mcp-servers-row-a-health"),
      ).toHaveTextContent(/7 tools/i),
    );
  });

  it("calls deleteServer when the Remove button is clicked", async () => {
    const deleteServer = vi.fn().mockResolvedValue({ ok: true });
    useMcpServersMock.mockReturnValue(
      buildHookValue({
        servers: [
          { id: "a", name: "x", url: "https://x.example.com", enabled: true },
        ],
        deleteServer,
      }),
    );
    render(<McpServersSection />);
    fireEvent.click(
      screen.getByTestId("settings-modal-mcp-servers-row-a-delete"),
    );
    await waitFor(() => expect(deleteServer).toHaveBeenCalledWith("a"));
  });
});

describe("<McpServersSection> — add form", () => {
  it("opens the form when the add button is clicked", async () => {
    useMcpServersMock.mockReturnValue(buildHookValue());
    render(<McpServersSection />);
    fireEvent.click(
      screen.getByTestId("settings-modal-mcp-servers-add-button"),
    );
    expect(
      screen.getByTestId("settings-modal-mcp-servers-add-form"),
    ).toBeInTheDocument();
  });

  it("submits the form and calls addServer with the right input", async () => {
    const user = userEvent.setup();
    const addServer = vi.fn().mockResolvedValue({
      ok: true,
      server: {
        id: "new",
        name: "Docs",
        url: "https://docs.example.com",
        enabled: true,
      },
    });
    useMcpServersMock.mockReturnValue(buildHookValue({ addServer }));
    render(<McpServersSection />);

    await user.click(
      screen.getByTestId("settings-modal-mcp-servers-add-button"),
    );
    await user.type(
      screen.getByTestId("settings-modal-mcp-servers-add-form-name"),
      "Docs",
    );
    await user.type(
      screen.getByTestId("settings-modal-mcp-servers-add-form-url"),
      "https://docs.example.com",
    );
    await user.type(
      screen.getByTestId("settings-modal-mcp-servers-add-form-bearer"),
      "secret-token",
    );
    await user.click(
      screen.getByTestId("settings-modal-mcp-servers-add-form-submit"),
    );

    await waitFor(() => {
      expect(addServer).toHaveBeenCalledWith({
        name: "Docs",
        url: "https://docs.example.com",
        bearerToken: "secret-token",
      });
    });
  });

  it("surfaces the addServer error in the form", async () => {
    const user = userEvent.setup();
    const addServer = vi.fn().mockResolvedValue({
      ok: false,
      error: "URL is not a valid URL.",
    });
    useMcpServersMock.mockReturnValue(buildHookValue({ addServer }));
    render(<McpServersSection />);

    await user.click(
      screen.getByTestId("settings-modal-mcp-servers-add-button"),
    );
    await user.type(
      screen.getByTestId("settings-modal-mcp-servers-add-form-name"),
      "x",
    );
    await user.type(
      screen.getByTestId("settings-modal-mcp-servers-add-form-url"),
      "https://x.example.com",
    );
    await user.click(
      screen.getByTestId("settings-modal-mcp-servers-add-form-submit"),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("settings-modal-mcp-servers-add-form-error"),
      ).toHaveTextContent(/not a valid URL/i),
    );
  });

  it("validates URL locally before submitting", async () => {
    const user = userEvent.setup();
    const addServer = vi.fn();
    useMcpServersMock.mockReturnValue(buildHookValue({ addServer }));
    render(<McpServersSection />);

    await user.click(
      screen.getByTestId("settings-modal-mcp-servers-add-button"),
    );
    await user.type(
      screen.getByTestId("settings-modal-mcp-servers-add-form-name"),
      "x",
    );
    // Form-level URL validation: native input[type=url] rejects
    // submission, but our explicit JS check kicks in if it gets past.
    // Type a clearly-invalid URL that the input doesn't reject and
    // confirm addServer is not called.
    fireEvent.change(
      screen.getByTestId("settings-modal-mcp-servers-add-form-url"),
      { target: { value: "not a url" } },
    );
    fireEvent.submit(
      screen.getByTestId("settings-modal-mcp-servers-add-form"),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("settings-modal-mcp-servers-add-form-error"),
      ).toHaveTextContent(/not a valid URL/i),
    );
    expect(addServer).not.toHaveBeenCalled();
  });

  it("closes the form on cancel", async () => {
    const user = userEvent.setup();
    useMcpServersMock.mockReturnValue(buildHookValue());
    render(<McpServersSection />);
    await user.click(
      screen.getByTestId("settings-modal-mcp-servers-add-button"),
    );
    await user.click(
      screen.getByTestId("settings-modal-mcp-servers-add-form-cancel"),
    );
    expect(
      screen.queryByTestId("settings-modal-mcp-servers-add-form"),
    ).not.toBeInTheDocument();
  });
});
