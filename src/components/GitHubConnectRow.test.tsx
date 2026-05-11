/**
 * Tests for `<GitHubConnectRow>` (issue #131 phase 3 prep).
 *
 * The row is a thin renderer over `useGitHubOAuth()`. Tests mock
 * the hook and verify the three render branches (checking,
 * connected, disconnected) plus the connect/disconnect affordances.
 *
 * Also covers the auto-refetch behaviour when the OAuth callback
 * redirects back with `?github_oauth=connected` in the URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Hook stub — wired via vi.hoisted so the import-time mock can find it.
const { useGitHubOAuthMock } = vi.hoisted(() => ({
  useGitHubOAuthMock: vi.fn(),
}));
vi.mock("@/lib/use-github-oauth", () => ({
  useGitHubOAuth: useGitHubOAuthMock,
}));

// Import AFTER the mock is registered.
import { GitHubConnectRow } from "./GitHubConnectRow";

beforeEach(() => {
  useGitHubOAuthMock.mockReset();
});

afterEach(() => {
  cleanup();
  // Reset window.history state for tests that mutate the URL.
  if (typeof window !== "undefined") {
    window.history.replaceState({}, "", "/");
  }
});

function defaultConnection() {
  return {
    state: "disconnected" as const,
    username: null,
    scopes: [],
    connectedAt: null,
    refetch: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    startUrl: () => "/api/admin/auth/github/start?returnTo=%2Fadmin",
  };
}

describe("<GitHubConnectRow>", () => {
  it("renders the Connect button when state is disconnected", () => {
    useGitHubOAuthMock.mockReturnValue(defaultConnection());
    render(<GitHubConnectRow />);
    const connect = screen.getByTestId("settings-modal-github-connect-connect");
    expect(connect.tagName).toBe("A");
    expect((connect as HTMLAnchorElement).getAttribute("href")).toContain(
      "/api/admin/auth/github/start",
    );
    expect(screen.queryByTestId("settings-modal-github-connect-disconnect"))
      .toBeNull();
  });

  it("renders the Connected-as badge and Disconnect button when connected", () => {
    useGitHubOAuthMock.mockReturnValue({
      ...defaultConnection(),
      state: "connected",
      username: "alice-gh",
      scopes: ["public_repo"],
      connectedAt: 1234,
    });
    render(<GitHubConnectRow />);
    expect(
      screen.getByTestId("settings-modal-github-connect-status-connected")
        .textContent,
    ).toContain("@alice-gh");
    expect(screen.getByTestId("settings-modal-github-connect-disconnect"))
      .toBeTruthy();
    expect(screen.queryByTestId("settings-modal-github-connect-connect"))
      .toBeNull();
  });

  it("renders the checking placeholder before the probe resolves", () => {
    useGitHubOAuthMock.mockReturnValue({
      ...defaultConnection(),
      state: "checking",
    });
    render(<GitHubConnectRow />);
    expect(
      screen.getByTestId("settings-modal-github-connect-status-checking")
        .textContent,
    ).toMatch(/checking/i);
    expect(screen.queryByTestId("settings-modal-github-connect-connect"))
      .toBeNull();
    expect(screen.queryByTestId("settings-modal-github-connect-disconnect"))
      .toBeNull();
  });

  it("clicking Disconnect invokes the hook's disconnect()", async () => {
    const connection = {
      ...defaultConnection(),
      state: "connected" as const,
      username: "alice-gh",
      scopes: ["public_repo"],
      connectedAt: 1234,
    };
    useGitHubOAuthMock.mockReturnValue(connection);
    render(<GitHubConnectRow />);
    act(() => {
      fireEvent.click(
        screen.getByTestId("settings-modal-github-connect-disconnect"),
      );
    });
    expect(connection.disconnect).toHaveBeenCalledTimes(1);
  });

  it("on mount, if URL has ?github_oauth=connected, triggers refetch and cleans the flag", () => {
    // Simulate post-OAuth callback URL state.
    window.history.replaceState({}, "", "/admin/decks/hello?github_oauth=connected&other=keep");
    const connection = defaultConnection();
    useGitHubOAuthMock.mockReturnValue(connection);
    render(<GitHubConnectRow />);
    expect(connection.refetch).toHaveBeenCalledTimes(1);
    // The flag is gone, but the other query param stays.
    expect(window.location.search).not.toContain("github_oauth");
    expect(window.location.search).toContain("other=keep");
  });

  it("on mount, if URL has ?github_oauth=denied, also refetches and cleans the flag", () => {
    window.history.replaceState({}, "", "/admin/decks/hello?github_oauth=denied");
    const connection = defaultConnection();
    useGitHubOAuthMock.mockReturnValue(connection);
    render(<GitHubConnectRow />);
    expect(connection.refetch).toHaveBeenCalledTimes(1);
    expect(window.location.search).not.toContain("github_oauth");
  });

  it("on mount with no OAuth flag, does NOT call refetch (it's only an explicit-trigger path)", () => {
    window.history.replaceState({}, "", "/admin/decks/hello");
    const connection = defaultConnection();
    useGitHubOAuthMock.mockReturnValue(connection);
    render(<GitHubConnectRow />);
    expect(connection.refetch).not.toHaveBeenCalled();
  });

  it("renders a GitHub-applications revoke link in the description", () => {
    useGitHubOAuthMock.mockReturnValue(defaultConnection());
    render(<GitHubConnectRow />);
    const link = screen.getByRole("link", { name: /github → applications/i });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/settings/applications",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
