/**
 * Hook tests for `useDeckTheme`.
 *
 * happy-dom + a stubbed `fetch`. We render the hook in a tiny harness and
 * assert against `document.documentElement.style` for the four CSS custom
 * properties — that is the actual contract the deck depends on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useDeckTheme } from "./useDeckTheme";

const validTokens = {
  "cf-bg-100": "#FFFBF5",
  "cf-text": "#521000",
  "cf-orange": "#FF4801",
  "cf-border": "#E0D3BD",
};

const draft = {
  "cf-bg-100": "#000000",
  "cf-text": "#FFFFFF",
  "cf-orange": "#19E306",
  "cf-border": "#444444",
};

function styleProp(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

function mockFetch(response: { tokens: unknown; updatedAt: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
  });
}

beforeEach(() => {
  document.documentElement.style.cssText = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.cssText = "";
});

describe("useDeckTheme", () => {
  it("applies persisted overrides on mount", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ tokens: validTokens, updatedAt: "2026-05-06T00:00:00Z" }),
    );
    const { result } = renderHook(() => useDeckTheme("hello"));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.tokens).toEqual(validTokens);
    expect(styleProp("--color-cf-orange")).toBe("#FF4801");
    expect(styleProp("--color-cf-bg-100")).toBe("#FFFBF5");
  });

  it("does not apply any properties when no override exists", async () => {
    vi.stubGlobal("fetch", mockFetch({ tokens: null, updatedAt: null }));
    const { result } = renderHook(() => useDeckTheme("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tokens).toBeNull();
    expect(styleProp("--color-cf-orange")).toBe("");
  });

  it("falls back gracefully on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useDeckTheme("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tokens).toBeNull();
    expect(styleProp("--color-cf-orange")).toBe("");
  });

  it("cleans up :root inline properties on unmount", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ tokens: validTokens, updatedAt: "2026-05-06T00:00:00Z" }),
    );
    const { result, unmount } = renderHook(() => useDeckTheme("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(styleProp("--color-cf-orange")).toBe("#FF4801");
    unmount();
    expect(styleProp("--color-cf-orange")).toBe("");
    expect(styleProp("--color-cf-bg-100")).toBe("");
  });

  it("applyDraft overrides without persisting", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ tokens: validTokens, updatedAt: "2026-05-06T00:00:00Z" }),
    );
    const { result } = renderHook(() => useDeckTheme("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.applyDraft(draft));
    expect(styleProp("--color-cf-orange")).toBe("#19E306");
    // Persisted state untouched — the hook still reports the saved tokens.
    expect(result.current.tokens).toEqual(validTokens);
  });

  it("clearDraft reverts to persisted tokens when present", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ tokens: validTokens, updatedAt: "2026-05-06T00:00:00Z" }),
    );
    const { result } = renderHook(() => useDeckTheme("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.applyDraft(draft));
    act(() => result.current.clearDraft());
    expect(styleProp("--color-cf-orange")).toBe("#FF4801");
  });

  it("clearDraft removes properties when no override is persisted", async () => {
    vi.stubGlobal("fetch", mockFetch({ tokens: null, updatedAt: null }));
    const { result } = renderHook(() => useDeckTheme("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.applyDraft(draft));
    expect(styleProp("--color-cf-orange")).toBe("#19E306");
    act(() => result.current.clearDraft());
    expect(styleProp("--color-cf-orange")).toBe("");
    expect(styleProp("--color-cf-bg-100")).toBe("");
  });

  it("refetch picks up newly-saved tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tokens: null, updatedAt: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tokens: validTokens,
          updatedAt: "2026-05-06T00:00:00Z",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDeckTheme("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tokens).toBeNull();

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.tokens).toEqual(validTokens);
    expect(styleProp("--color-cf-orange")).toBe("#FF4801");
  });
});
