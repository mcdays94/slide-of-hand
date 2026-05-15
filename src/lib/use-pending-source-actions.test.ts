/**
 * Tests for `usePendingSourceActions` — the client-side hook that
 * powers the pending pill projection (issue #246 / PRD #242).
 *
 * Each test stubs `fetch` and asserts the hook's externally visible
 * surface: the `actions` map, the loading flag, and the side effects
 * of `clearPending`. The implementation detail of HOW the map is
 * built (filter / forEach / reduce) is deliberately not pinned.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePendingSourceActions } from "./use-pending-source-actions";

const PR_URL = "https://github.com/mcdays94/slide-of-hand/pull/123";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("usePendingSourceActions — initial fetch", () => {
  it("populates the actions map keyed by slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          actions: [
            {
              slug: "hello",
              action: "archive",
              prUrl: PR_URL,
              expectedState: "archived",
              createdAt: "2026-05-15T11:23:45.000Z",
            },
            {
              slug: "world",
              action: "restore",
              prUrl: PR_URL,
              expectedState: "active",
              createdAt: "2026-05-15T11:24:00.000Z",
            },
          ],
        }),
      }),
    );

    const { result } = renderHook(() => usePendingSourceActions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(Object.keys(result.current.actions).sort()).toEqual([
      "hello",
      "world",
    ]);
    expect(result.current.actions.hello?.action).toBe("archive");
    expect(result.current.actions.world?.expectedState).toBe("active");
  });

  it("falls back to an empty map on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "forbidden" }),
      }),
    );
    const { result } = renderHook(() => usePendingSourceActions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.actions).toEqual({});
  });

  it("falls back to an empty map on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => usePendingSourceActions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.actions).toEqual({});
  });
});

describe("usePendingSourceActions — clearPending", () => {
  it("fires DELETE /api/admin/deck-source-actions/<slug> and removes the local entry", async () => {
    const fetchMock = vi
      .fn()
      // Initial list fetch.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          actions: [
            {
              slug: "hello",
              action: "archive",
              prUrl: PR_URL,
              expectedState: "archived",
              createdAt: "2026-05-15T11:23:45.000Z",
            },
          ],
        }),
      })
      // clearPending DELETE.
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePendingSourceActions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.actions.hello).toBeDefined();

    await act(async () => {
      await result.current.clearPending("hello");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/admin/deck-source-actions/hello");
    expect((init as RequestInit).method).toBe("DELETE");
    expect(result.current.actions.hello).toBeUndefined();
  });

  it("throws an Error with the server message on failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ actions: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "kv unavailable" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePendingSourceActions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.clearPending("hello");
      }),
    ).rejects.toThrow(/kv unavailable/);
  });
});

// ─── reconcile (issue #250) ──────────────────────────────────────
describe("usePendingSourceActions — reconcile", () => {
  it("POSTs the sourceState and drops the local entry on { reconciled: true }", async () => {
    const fetchMock = vi
      .fn()
      // Initial list fetch.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          actions: [
            {
              slug: "hello",
              action: "archive",
              prUrl: PR_URL,
              expectedState: "archived",
              createdAt: "2026-05-15T11:23:45.000Z",
            },
          ],
        }),
      })
      // Reconcile call.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          reconciled: true,
          action: "archive",
          cleared: ["pending-source-action:hello"],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePendingSourceActions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.actions.hello).toBeDefined();

    let reconcileResult: { reconciled: boolean } = { reconciled: false };
    await act(async () => {
      reconcileResult = await result.current.reconcile("hello", "archived");
    });

    expect(reconcileResult.reconciled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/admin/deck-source-actions/hello/reconcile");
    expect((init as RequestInit).method).toBe("POST");
    expect(
      JSON.parse((init as RequestInit).body as string),
    ).toEqual({ sourceState: "archived" });
    expect(result.current.actions.hello).toBeUndefined();
  });

  it("keeps the local entry on { reconciled: false } (server mismatch)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          actions: [
            {
              slug: "hello",
              action: "archive",
              prUrl: PR_URL,
              expectedState: "archived",
              createdAt: "2026-05-15T11:23:45.000Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ reconciled: false }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePendingSourceActions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reconcile("hello", "active");
    });
    expect(result.current.actions.hello).toBeDefined();
  });

  it("swallows network failures (entry stays put, next render can retry)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          actions: [
            {
              slug: "hello",
              action: "archive",
              prUrl: PR_URL,
              expectedState: "archived",
              createdAt: "2026-05-15T11:23:45.000Z",
            },
          ],
        }),
      })
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePendingSourceActions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let res: { reconciled: boolean } = { reconciled: true };
    await act(async () => {
      res = await result.current.reconcile("hello", "archived");
    });
    expect(res.reconciled).toBe(false);
    expect(result.current.actions.hello).toBeDefined();
  });
});
