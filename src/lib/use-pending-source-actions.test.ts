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
