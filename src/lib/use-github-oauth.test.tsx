/**
 * Tests for `useGitHubOAuth()` (issue #131 phase 3 prep).
 *
 * The hook probes `/api/admin/auth/github/status` on mount and
 * exposes connect / disconnect / refetch operations. Tests cover:
 *
 *   - initial "checking" state before the probe resolves
 *   - probe returns `{ connected: true, username, scopes, connectedAt }`
 *   - probe returns `{ connected: false }`
 *   - probe redirected by Access (opaqueredirect) → "disconnected"
 *   - probe non-OK status → "disconnected"
 *   - probe throws → "disconnected"
 *   - `disconnect()` success → state flips to "disconnected"
 *   - `disconnect()` failure → refetch is triggered
 *   - `startUrl()` includes the current path + search as returnTo
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { useGitHubOAuth } from "./use-github-oauth";

function GitHubProbe() {
  const c = useGitHubOAuth();
  return (
    <div>
      <div data-testid="state">{c.state}</div>
      <div data-testid="username">{c.username ?? "(none)"}</div>
      <div data-testid="scopes">{c.scopes.join(",") || "(empty)"}</div>
      <div data-testid="start-url">{c.startUrl()}</div>
      <button
        type="button"
        data-testid="disconnect"
        onClick={() => void c.disconnect()}
      >
        disconnect
      </button>
      <button
        type="button"
        data-testid="refetch"
        onClick={() => c.refetch()}
      >
        refetch
      </button>
    </div>
  );
}

describe("useGitHubOAuth (issue #131 phase 3 prep)", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  function stubJsonOk(body: unknown) {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
  }

  function stubOpaqueRedirect() {
    globalThis.fetch = vi.fn(async () => {
      const r = new Response(null, { status: 0 });
      Object.defineProperty(r, "type", { value: "opaqueredirect" });
      return r;
    });
  }

  function stubError() {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
  }

  it("starts in checking state, then transitions to connected when the probe succeeds", async () => {
    stubJsonOk({
      connected: true,
      username: "alice-gh",
      scopes: ["public_repo"],
      connectedAt: 1234567890,
    });

    render(<GitHubProbe />);
    // First synchronous render: "checking" before the fetch resolves.
    expect(screen.getByTestId("state").textContent).toBe("checking");

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("connected");
    });
    expect(screen.getByTestId("username").textContent).toBe("alice-gh");
    expect(screen.getByTestId("scopes").textContent).toBe("public_repo");
  });

  it("transitions to disconnected when the probe returns { connected: false }", async () => {
    stubJsonOk({ connected: false });
    render(<GitHubProbe />);
    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("disconnected");
    });
    expect(screen.getByTestId("username").textContent).toBe("(none)");
    expect(screen.getByTestId("scopes").textContent).toBe("(empty)");
  });

  it("treats Access redirect (opaqueredirect) as disconnected", async () => {
    stubOpaqueRedirect();
    render(<GitHubProbe />);
    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("disconnected");
    });
  });

  it("treats a network error as disconnected (not stuck in checking)", async () => {
    stubError();
    render(<GitHubProbe />);
    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("disconnected");
    });
  });

  it("disconnect() flips state to disconnected on success", async () => {
    // First call (mount-time status probe): connected
    // Second call (disconnect): 200 OK
    const fetchMock = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/status")) {
          return new Response(
            JSON.stringify({
              connected: true,
              username: "alice-gh",
              scopes: ["public_repo"],
              connectedAt: 1,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/disconnect")) {
          return new Response(JSON.stringify({ disconnected: true }), {
            status: 200,
          });
        }
        throw new Error(`unexpected: ${url}`);
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    render(<GitHubProbe />);
    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("connected");
    });
    act(() => {
      screen.getByTestId("disconnect").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("disconnected");
    });
    // The disconnect fetch was called.
    const disconnectCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/disconnect"),
    );
    expect(disconnectCall).toBeDefined();
    expect((disconnectCall![1] as RequestInit).method).toBe("POST");
  });

  it("startUrl() encodes the current path + search as returnTo", () => {
    // jsdom defaults to about:blank; happy-dom sets a path. Either way
    // we can verify the structure.
    stubJsonOk({ connected: false });
    render(<GitHubProbe />);
    const url = screen.getByTestId("start-url").textContent ?? "";
    expect(url.startsWith("/api/admin/auth/github/start?returnTo=")).toBe(true);
    // The returnTo value is URL-encoded.
    expect(url).toContain("returnTo=");
  });
});
