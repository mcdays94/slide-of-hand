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

  // ── Pinning the shared admin-fetch helper consumption (#62 follow-up) //
  // After collapsing the inline `adminWriteHeaders` onto
  // `src/lib/admin-fetch.ts`, this test pins both the auth header AND
  // the content-type header in a single POST. If the shared helper's
  // contract drifts in a way that drops content-type, this fails.
  it("save still sets content-type: application/json (shared helper contract)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [sample] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ overrides: [sample] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useElementOverrides("hello"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.save([sample]);
    });

    const [, postInit] = fetchMock.mock.calls[1];
    const headers = postInit.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
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

  // ── Slice 5 (#47): per-element revert + orphaned-status surfacing ──

  describe("appliedWithStatus / getOverrideStatus", () => {
    afterEach(() => {
      // Clean up any slide roots the test mounted into document.body so
      // subsequent tests start with a clean DOM.
      document
        .querySelectorAll("[data-slide-id]")
        .forEach((el) => el.remove());
    });

    function mountSlideRoot(slideId: string): HTMLElement {
      const root = document.createElement("section");
      root.setAttribute("data-slide-id", slideId);
      document.body.appendChild(root);
      return root;
    }

    it("reports matched when the slide root has the expected element + fingerprint", async () => {
      vi.stubGlobal("fetch", mockFetch({ overrides: [sample] }));
      const root = mountSlideRoot("title");
      const h1 = document.createElement("h1");
      h1.textContent = "Hello, Slide of Hand";
      root.appendChild(h1);

      const { result } = renderHook(() => useElementOverrides("hello"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.getOverrideStatus(sample)).toBe("matched");
      expect(result.current.appliedWithStatus).toEqual([
        { override: sample, status: "matched" },
      ]);
    });

    it("reports orphaned when the selector matches but the fingerprint differs", async () => {
      vi.stubGlobal("fetch", mockFetch({ overrides: [sample] }));
      const root = mountSlideRoot("title");
      const h1 = document.createElement("h1");
      h1.textContent = "Different content"; // fingerprint mismatch
      root.appendChild(h1);

      const { result } = renderHook(() => useElementOverrides("hello"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.getOverrideStatus(sample)).toBe("orphaned");
      expect(result.current.appliedWithStatus[0]?.status).toBe("orphaned");
    });

    it("reports missing when the selector resolves to nothing", async () => {
      vi.stubGlobal("fetch", mockFetch({ overrides: [sample] }));
      // Mount the slide root but with no children → selector misses.
      mountSlideRoot("title");

      const { result } = renderHook(() => useElementOverrides("hello"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.getOverrideStatus(sample)).toBe("missing");
      expect(result.current.appliedWithStatus[0]?.status).toBe("missing");
    });

    it("defaults to matched when the target slide isn't currently mounted", async () => {
      // The audience is on a different slide entirely → we have no
      // information about the override's element. Optimistic default
      // keeps the warning icon off until the user navigates over.
      vi.stubGlobal("fetch", mockFetch({ overrides: [sample] }));
      // No slide roots in the DOM.

      const { result } = renderHook(() => useElementOverrides("hello"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.getOverrideStatus(sample)).toBe("matched");
    });
  });

  describe("removeOne", () => {
    it("POSTs the persistent list minus the matching entry", async () => {
      const fetchMock = vi
        .fn()
        // initial GET
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample, sample2] }),
        })
        // POST (delete)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample2] }),
        })
        // refetch GET
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample2] }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useElementOverrides("hello"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.persistent).toEqual([sample, sample2]);

      let removeResult: { ok: boolean; status?: number } | undefined;
      await act(async () => {
        removeResult = await result.current.removeOne(sample);
      });
      expect(removeResult?.ok).toBe(true);

      // 0 = initial GET, 1 = POST, 2 = refetch GET.
      expect(fetchMock.mock.calls).toHaveLength(3);
      const [postUrl, postInit] = fetchMock.mock.calls[1];
      expect(postUrl).toBe("/api/admin/element-overrides/hello");
      expect(postInit.method).toBe("POST");
      expect(JSON.parse(postInit.body)).toEqual({ overrides: [sample2] });

      // Local state mirrors KV after refetch.
      await waitFor(() =>
        expect(result.current.persistent).toEqual([sample2]),
      );
    });

    it("matches on (slideId, selector) — same selector under a different slide is preserved", async () => {
      const sameSelectorOtherSlide: ElementOverride = {
        ...sample,
        slideId: "elsewhere",
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample, sameSelectorOtherSlide] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sameSelectorOtherSlide] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sameSelectorOtherSlide] }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useElementOverrides("hello"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.removeOne(sample);
      });

      const [, postInit] = fetchMock.mock.calls[1];
      expect(JSON.parse(postInit.body)).toEqual({
        overrides: [sameSelectorOtherSlide],
      });
    });

    it("returns ok=false when the endpoint refuses", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample] }),
        })
        .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useElementOverrides("hello"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let removeResult: { ok: boolean; status?: number } | undefined;
      await act(async () => {
        removeResult = await result.current.removeOne(sample);
      });
      expect(removeResult).toEqual({ ok: false, status: 403 });
    });
  });

  describe("clearOrphaned", () => {
    afterEach(() => {
      document
        .querySelectorAll("[data-slide-id]")
        .forEach((el) => el.remove());
    });

    function mountSlideRoot(slideId: string): HTMLElement {
      const root = document.createElement("section");
      root.setAttribute("data-slide-id", slideId);
      document.body.appendChild(root);
      return root;
    }

    it("POSTs the persistent list filtered to matched entries", async () => {
      // sample1 is matched; sample2's slide is mounted with NO matching
      // child → status = "missing" → filtered out.
      const root1 = mountSlideRoot("title");
      const h1 = document.createElement("h1");
      h1.textContent = "Hello, Slide of Hand";
      root1.appendChild(h1);
      mountSlideRoot("second"); // no children → sample2 missing

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample, sample2] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample] }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useElementOverrides("hello"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.clearOrphaned();
      });

      const [postUrl, postInit] = fetchMock.mock.calls[1];
      expect(postUrl).toBe("/api/admin/element-overrides/hello");
      expect(JSON.parse(postInit.body)).toEqual({ overrides: [sample] });
    });

    it("preserves entries whose slide isn't currently mounted (status defaults to matched)", async () => {
      // No slide roots in the DOM → both entries default to "matched"
      // → none filtered out → POST body equals the original list.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample, sample2] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample, sample2] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ overrides: [sample, sample2] }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useElementOverrides("hello"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.clearOrphaned();
      });

      const [, postInit] = fetchMock.mock.calls[1];
      expect(JSON.parse(postInit.body)).toEqual({
        overrides: [sample, sample2],
      });
    });
  });
});
