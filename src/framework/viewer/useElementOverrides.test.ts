/**
 * Hook tests for `useElementOverrides`. Mirrors `useDeckTheme.test.ts` /
 * `useDeckManifest.test.ts` in shape: stub `fetch`, render the hook in
 * a tiny harness, assert against `result.current` for the public surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useElementOverrides,
  type ElementOverride,
} from "./useElementOverrides";

const sample: ElementOverride = {
  slideId: "title",
  selector: "h1:nth-child(1)",
  fingerprint: { tag: "h1", text: "Hello, Slide of Hand" },
  classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
};

const sample2: ElementOverride = {
  slideId: "second",
  selector: "p:nth-child(1)",
  fingerprint: { tag: "p", text: "JSX-first slides." },
  classOverrides: [{ from: "text-cf-text-muted", to: "text-cf-blue" }],
};

function mockFetch(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => response,
  });
}

beforeEach(() => {
  // Default: empty overrides list.
  vi.stubGlobal("fetch", mockFetch({ overrides: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useElementOverrides", () => {
  it("loads persistent overrides on mount and exposes them via applied", async () => {
    vi.stubGlobal("fetch", mockFetch({ overrides: [sample] }));
    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.persistent).toEqual([sample]);
    expect(result.current.applied).toEqual([sample]);
  });

  it("falls back to an empty list when the endpoint returns non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetch({ overrides: [] }, false));
    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.persistent).toEqual([]);
    expect(result.current.applied).toEqual([]);
  });

  it("falls back gracefully on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.persistent).toEqual([]);
    expect(result.current.applied).toEqual([]);
  });

  it("applyDraft swaps applied without mutating persistent", async () => {
    vi.stubGlobal("fetch", mockFetch({ overrides: [sample] }));
    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.applyDraft([sample, sample2]));
    expect(result.current.applied).toEqual([sample, sample2]);
    expect(result.current.persistent).toEqual([sample]);
  });

  it("clearDraft drops the draft so applied falls back to persistent", async () => {
    vi.stubGlobal("fetch", mockFetch({ overrides: [sample] }));
    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.applyDraft([sample, sample2]));
    expect(result.current.applied).toEqual([sample, sample2]);

    act(() => result.current.clearDraft());
    expect(result.current.applied).toEqual([sample]);
  });

  it("save POSTs to the admin endpoint with the override payload", async () => {
    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [] }) })
      // POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [sample] }) })
      // refetch GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [sample] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let saveResult: { ok: boolean; status?: number } | undefined;
    await act(async () => {
      saveResult = await result.current.save([sample]);
    });
    expect(saveResult?.ok).toBe(true);

    // 0 = initial GET, 1 = POST, 2 = refetch GET.
    expect(fetchMock.mock.calls).toHaveLength(3);
    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(postUrl).toBe("/api/admin/element-overrides/hello");
    expect(postInit.method).toBe("POST");
    expect(JSON.parse(postInit.body)).toEqual({ overrides: [sample] });

    // refetch ran → persistent is the post-save value.
    await waitFor(() => expect(result.current.persistent).toEqual([sample]));
  });

  it("save returns ok=false when the endpoint refuses (e.g. 403)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let saveResult: { ok: boolean; status?: number } | undefined;
    await act(async () => {
      saveResult = await result.current.save([sample]);
    });
    expect(saveResult).toEqual({ ok: false, status: 403 });
  });

  it("save returns ok=false on network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [] }) })
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let saveResult: { ok: boolean; status?: number } | undefined;
    await act(async () => {
      saveResult = await result.current.save([sample]);
    });
    expect(saveResult?.ok).toBe(false);
  });

  it("save injects the dev Access header on localhost", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [sample] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [sample] }) });
    vi.stubGlobal("fetch", fetchMock);

    // happy-dom defaults `window.location.hostname` to "localhost".
    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.save([sample]);
    });

    const [, postInit] = fetchMock.mock.calls[1];
    const headers = postInit.headers as Record<string, string>;
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
  });

  it("refetch picks up newly-saved overrides", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [sample] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.persistent).toEqual([]);

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.persistent).toEqual([sample]);
  });

  it("URL-encodes the slug in fetch calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ overrides: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useElementOverrides("with space"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/element-overrides/with%20space",
    );
  });
});
