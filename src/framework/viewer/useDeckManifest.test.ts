/**
 * Hook tests for `useDeckManifest`.
 *
 * happy-dom + a stubbed `fetch`. Unlike `useDeckTheme`, this hook does
 * not write to the DOM directly — it returns the "applied" manifest as
 * state and the consumer (`<Deck>`) feeds it through `mergeSlides`. So
 * we assert against `result.current.applied` rather than the document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useDeckManifest } from "./useDeckManifest";
import type { Manifest } from "@/lib/manifest";

const persisted: Manifest = {
  version: 1,
  order: ["title", "intro", "middle", "end"],
  overrides: { intro: { hidden: true } },
  updatedAt: "2026-05-06T00:00:00.000Z",
};

const draft: Manifest = {
  version: 1,
  order: ["end", "intro", "middle", "title"],
  overrides: { title: { title: "Drafted" } },
  updatedAt: "2026-05-06T01:00:00.000Z",
};

function mockFetchOnce(response: { manifest: Manifest | null }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
  });
}

beforeEach(() => {
  // happy-dom doesn't reset between renderHook calls.
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDeckManifest", () => {
  it("loads the persisted manifest on mount and exposes it as `applied`", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ manifest: persisted }));
    const { result } = renderHook(() => useDeckManifest("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.manifest).toEqual(persisted);
    expect(result.current.applied).toEqual(persisted);
    expect(result.current.updatedAt).toBe(persisted.updatedAt);
  });

  it("reports null `applied` when no manifest is persisted", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ manifest: null }));
    const { result } = renderHook(() => useDeckManifest("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.manifest).toBeNull();
    expect(result.current.applied).toBeNull();
    expect(result.current.updatedAt).toBeNull();
  });

  it("falls back gracefully on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useDeckManifest("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.applied).toBeNull();
  });

  it("applyDraft replaces `applied` without changing `manifest`", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ manifest: persisted }));
    const { result } = renderHook(() => useDeckManifest("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.applyDraft(draft));
    expect(result.current.applied).toEqual(draft);
    // Persisted state untouched.
    expect(result.current.manifest).toEqual(persisted);
  });

  it("clearDraft reverts to the persisted manifest when present", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ manifest: persisted }));
    const { result } = renderHook(() => useDeckManifest("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.applyDraft(draft));
    expect(result.current.applied).toEqual(draft);
    act(() => result.current.clearDraft());
    expect(result.current.applied).toEqual(persisted);
  });

  it("clearDraft reverts to null when no manifest is persisted", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ manifest: null }));
    const { result } = renderHook(() => useDeckManifest("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.applyDraft(draft));
    expect(result.current.applied).toEqual(draft);
    act(() => result.current.clearDraft());
    expect(result.current.applied).toBeNull();
  });

  it("refetch picks up newly-saved manifests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ manifest: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ manifest: persisted }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDeckManifest("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.manifest).toBeNull();

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.manifest).toEqual(persisted);
    expect(result.current.applied).toEqual(persisted);
  });

  it("issues fetches with cache: 'no-store'", async () => {
    const fetchMock = mockFetchOnce({ manifest: null });
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useDeckManifest("hello"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/manifests/hello");
    expect(init).toMatchObject({ cache: "no-store" });
  });
});
