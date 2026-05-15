/**
 * Tests for `<GitHubConnectGate>` (issue #251).
 *
 * The gate is the app-native explanatory dialog that intercepts
 * source-backed deck lifecycle actions (Archive / Restore / Delete)
 * when GitHub is not connected. It replaces what would otherwise be
 * a `window.confirm` — see issue #251 for the gating contract.
 *
 * The component is intentionally dumb: the parent owns `isOpen`, the
 * intent shape, the connection state, and the retry handler. The
 * tests below pin the render shape and the click-routing behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { GitHubConnectGate } from "./GitHubConnectGate";

afterEach(() => {
  cleanup();
});

describe("<GitHubConnectGate>", () => {
  const baseProps = {
    isOpen: true,
    intent: {
      action: "archive" as const,
      slug: "hello",
      title: "Hello",
    },
    connectionState: "disconnected" as const,
    startUrl: "/api/admin/auth/github/start?returnTo=%2Fadmin",
    onCancel: vi.fn(),
    onRetry: vi.fn(),
  };

  beforeEach(() => {
    baseProps.onCancel.mockReset();
    baseProps.onRetry.mockReset();
  });

  it("renders nothing when isOpen is false", () => {
    render(<GitHubConnectGate {...baseProps} isOpen={false} />);
    expect(screen.queryByTestId("github-connect-gate")).toBeNull();
  });

  it("renders the explanatory heading and body copy when disconnected", () => {
    render(<GitHubConnectGate {...baseProps} />);
    const dialog = screen.getByTestId("github-connect-gate");
    expect(dialog.textContent).toMatch(/Connect GitHub/i);
    // Body explains source-backed deck changes are draft PRs.
    expect(dialog.textContent).toMatch(/draft PR/i);
  });

  it("renders the Connect GitHub anchor with the OAuth start URL", () => {
    render(<GitHubConnectGate {...baseProps} />);
    const connect = screen.getByTestId(
      "github-connect-gate-connect",
    ) as HTMLAnchorElement;
    expect(connect.tagName).toBe("A");
    expect(connect.getAttribute("href")).toContain(
      "/api/admin/auth/github/start",
    );
  });

  it("renders a Cancel button that calls onCancel", () => {
    render(<GitHubConnectGate {...baseProps} />);
    fireEvent.click(screen.getByTestId("github-connect-gate-cancel"));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("Esc invokes onCancel", () => {
    render(<GitHubConnectGate {...baseProps} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("references the action label (Archive / Restore / Delete) and deck title in the body copy", () => {
    const { rerender } = render(<GitHubConnectGate {...baseProps} />);
    expect(screen.getByTestId("github-connect-gate").textContent).toMatch(
      /archive/i,
    );
    expect(screen.getByTestId("github-connect-gate").textContent).toMatch(
      /Hello/,
    );
    rerender(
      <GitHubConnectGate
        {...baseProps}
        intent={{ action: "delete", slug: "kv-deck", title: "KV Deck" }}
      />,
    );
    expect(screen.getByTestId("github-connect-gate").textContent).toMatch(
      /delete/i,
    );
    expect(screen.getByTestId("github-connect-gate").textContent).toMatch(
      /KV Deck/,
    );
  });

  it("when connected, replaces the Connect CTA with a Retry button", () => {
    render(
      <GitHubConnectGate
        {...baseProps}
        connectionState="connected"
      />,
    );
    expect(screen.queryByTestId("github-connect-gate-connect")).toBeNull();
    expect(
      screen.getByTestId("github-connect-gate-retry"),
    ).toBeDefined();
  });

  it("Retry button invokes onRetry", () => {
    render(
      <GitHubConnectGate {...baseProps} connectionState="connected" />,
    );
    fireEvent.click(screen.getByTestId("github-connect-gate-retry"));
    expect(baseProps.onRetry).toHaveBeenCalledTimes(1);
  });

  it("while checking, renders a neutral 'Checking GitHub…' placeholder instead of Connect/Retry", () => {
    render(
      <GitHubConnectGate {...baseProps} connectionState="checking" />,
    );
    expect(
      screen.getByTestId("github-connect-gate-checking"),
    ).toBeDefined();
    expect(screen.queryByTestId("github-connect-gate-connect")).toBeNull();
    expect(screen.queryByTestId("github-connect-gate-retry")).toBeNull();
  });

  it("does NOT call window.confirm under any branch", () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    render(<GitHubConnectGate {...baseProps} />);
    fireEvent.click(screen.getByTestId("github-connect-gate-cancel"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("renders an inline error message when retryError is provided", () => {
    render(
      <GitHubConnectGate
        {...baseProps}
        connectionState="connected"
        retryError="Source archive backend is not wired yet."
      />,
    );
    expect(
      screen.getByTestId("github-connect-gate-error").textContent,
    ).toMatch(/not wired/i);
  });
});
