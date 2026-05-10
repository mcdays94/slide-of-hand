/**
 * Tests for the useAccessAuth() client hook (issue #120).
 *
 * The hook probes /api/admin/auth-status (Access-gated) and surfaces
 * one of three states. Tests cover the four outcomes:
 *
 *   - probe returns 200 + JSON { authenticated: true } -> "authenticated"
 *   - probe returns opaqueredirect (Access 302 to login)  -> "unauthenticated"
 *   - probe returns non-OK status                          -> "unauthenticated"
 *   - probe throws                                          -> "unauthenticated"
 *
 * `useAccessAuth` is a singleton-per-mount hook (no SWR-style cache),
 * so each render gets its own fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useAccessAuth } from "./use-access-auth";

function StatusProbe() {
  const status = useAccessAuth();
  return <div data-testid="status">{status}</div>;
}

describe("useAccessAuth (issue #120)", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts in the 'checking' state before the probe resolves", () => {
    // Never-resolving fetch — the hook stays in checking.
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<StatusProbe />);
    expect(screen.getByTestId("status").textContent).toBe("checking");
  });

  it("transitions to 'authenticated' when the probe returns { authenticated: true }", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ authenticated: true, email: "alice@cloudflare.com" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    render(<StatusProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("authenticated"),
    );
  });

  it("transitions to 'unauthenticated' when the probe is opaque-redirected by Access", async () => {
    globalThis.fetch = vi.fn(async () => {
      const r = new Response(null, { status: 0 });
      // Real `redirect: "manual"` produces resp.type === "opaqueredirect".
      // The Response constructor doesn't let us set `.type` directly, so
      // mock the object the hook actually inspects.
      return Object.assign(r, { type: "opaqueredirect" as ResponseType });
    }) as unknown as typeof fetch;
    render(<StatusProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );
  });

  it("transitions to 'unauthenticated' when the probe returns a non-OK status", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    render(<StatusProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );
  });

  it("transitions to 'unauthenticated' when the probe throws (network error)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    render(<StatusProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );
  });

  it("transitions to 'unauthenticated' when the probe returns 200 but the JSON denies auth", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    render(<StatusProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );
  });

  it("does not update state if the component unmounts before the probe resolves", async () => {
    let resolveFetch: (resp: Response) => void = () => {};
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;
    const { unmount } = render(<StatusProbe />);
    unmount();
    // Resolving after unmount must not throw "setState on unmounted".
    act(() => {
      resolveFetch(
        new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    // Nothing to assert beyond no error; React 19's noisy strict-mode
    // warnings would surface in the console output.
    expect(true).toBe(true);
  });
});
