/**
 * Hook tests for `useDeckEditor`. Mirrors `useElementOverrides.test.ts`
 * shape: stub `fetch`, render the hook, assert against `result.current`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useDeckEditor,
  buildEmptySlide,
  nextSlideId,
} from "./useDeckEditor";
import type { DataDeck } from "@/lib/deck-record";

function sampleDeck(): DataDeck {
  return {
    meta: {
      slug: "hello",
      title: "Hello",
      date: "2026-05-01",
      visibility: "private",
    },
    slides: [
      {
        id: "title",
        template: "default",
        slots: {
          title: { kind: "text", value: "Hello" },
          body: { kind: "richtext", value: "World" },
        },
      },
    ],
  };
}

function mockFetch(response: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
  });
}

beforeEach(() => {
  // happy-dom defaults hostname="" — `adminWriteHeaders` only injects
  // the dev auth header when host is `localhost` / `127.0.0.1` /
  // `*.localhost`, so we override the location to make the tests
  // exercise that code path. We do this by reassigning
  // `window.location.hostname` rather than `vi.stubGlobal("window", …)`
  // because happy-dom's `window` carries the React Testing Library
  // container and stubbing it breaks `renderHook`.
  Object.defineProperty(window.location, "hostname", {
    value: "localhost",
    configurable: true,
  });
  vi.stubGlobal("fetch", mockFetch(sampleDeck()));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDeckEditor — load + initial state", () => {
  it("loads the persistent deck from /api/decks/<slug>", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.persistent).toEqual(sampleDeck());
    expect(result.current.draft).toEqual(sampleDeck());
    expect(result.current.isDirty).toBe(false);
  });

  it("flags persistent=null on a 404", async () => {
    vi.stubGlobal("fetch", mockFetch(null, false, 404));
    const { result } = renderHook(() => useDeckEditor("missing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.persistent).toBeNull();
    expect(result.current.draft).toBeNull();
    expect(result.current.isDirty).toBe(false);
  });

  it("flags persistent=null on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.persistent).toBeNull();
  });

  it("skips the fetch when slug is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDeckEditor(""));
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useDeckEditor — draft mutations", () => {
  it("updateSlide applies an updater and marks dirty", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      result.current.updateSlide("title", (s) => ({
        ...s,
        slots: {
          ...s.slots,
          title: { kind: "text", value: "New title" },
        },
      })),
    );

    expect(result.current.draft?.slides[0].slots.title).toEqual({
      kind: "text",
      value: "New title",
    });
    expect(result.current.isDirty).toBe(true);
    // Persistent untouched.
    expect(result.current.persistent?.slides[0].slots.title).toEqual({
      kind: "text",
      value: "Hello",
    });
  });

  it("updateMeta applies an updater and marks dirty", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      result.current.updateMeta((m) => ({ ...m, title: "Renamed" })),
    );

    expect(result.current.draft?.meta.title).toBe("Renamed");
    expect(result.current.isDirty).toBe(true);
  });

  it("addSlide appends a slide built from the template's slot specs", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addSlide("default"));

    const slides = result.current.draft?.slides ?? [];
    expect(slides).toHaveLength(2);
    const added = slides[1];
    expect(added.template).toBe("default");
    expect(added.id).toBe("slide-1");
    expect(added.slots.title).toEqual({ kind: "text", value: "" });
    expect(added.slots.body).toEqual({ kind: "richtext", value: "" });
  });

  it("addSlide is a no-op when the template id is unknown", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addSlide("nonexistent"));
    expect(result.current.draft?.slides).toHaveLength(1);
    expect(result.current.isDirty).toBe(false);
  });

  it("reset reverts the draft to persistent", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      result.current.updateMeta((m) => ({ ...m, title: "X" })),
    );
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.draft?.meta.title).toBe("Hello");
  });
});

describe("useDeckEditor — save lifecycle", () => {
  it("save POSTs the draft to /api/admin/decks/<slug>", async () => {
    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleDeck() })
      // save POST
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleDeck() })
      // refetch GET
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleDeck() });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      result.current.updateMeta((m) => ({ ...m, title: "Saved" })),
    );

    let saveResult: { ok: boolean; status?: number } | undefined;
    await act(async () => {
      saveResult = await result.current.save();
    });
    expect(saveResult?.ok).toBe(true);

    // Inspect the POST call.
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const url = postCall?.[0] as string;
    const init = postCall?.[1] as RequestInit;
    expect(url).toBe("/api/admin/decks/hello");
    const body = JSON.parse((init.body as string) ?? "{}") as DataDeck;
    expect(body.meta.title).toBe("Saved");
    // Dev-mode auth header injected.
    const headers = init.headers as Record<string, string>;
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
  });

  it("save refetches and clears the draft on success", async () => {
    const updated: DataDeck = {
      ...sampleDeck(),
      meta: { ...sampleDeck().meta, title: "Saved" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleDeck() })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => updated })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => updated });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      result.current.updateMeta((m) => ({ ...m, title: "Saved" })),
    );

    await act(async () => {
      await result.current.save();
    });

    await waitFor(() =>
      expect(result.current.persistent?.meta.title).toBe("Saved"),
    );
    expect(result.current.isDirty).toBe(false);
  });

  it("save returns ok=false + status on a 4xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleDeck() })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "validation failed" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { ok: boolean; status?: number; error?: string } | undefined;
    await act(async () => {
      saveResult = await result.current.save();
    });
    expect(saveResult?.ok).toBe(false);
    expect(saveResult?.status).toBe(400);
    expect(saveResult?.error).toBe("validation failed");
  });

  it("save returns ok=false on a network error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleDeck() })
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      saveResult = await result.current.save();
    });
    expect(saveResult?.ok).toBe(false);
    expect(saveResult?.error).toBe("offline");
  });
});

describe("nextSlideId / buildEmptySlide", () => {
  it("nextSlideId returns slide-1 for an empty deck", () => {
    expect(nextSlideId([])).toBe("slide-1");
  });

  it("nextSlideId increments past the highest existing slide-N", () => {
    expect(
      nextSlideId([
        { id: "slide-1", template: "default", slots: {} },
        { id: "slide-3", template: "default", slots: {} },
      ]),
    ).toBe("slide-4");
  });

  it("nextSlideId ignores non slide-N ids", () => {
    expect(
      nextSlideId([
        { id: "title", template: "default", slots: {} },
        { id: "intro", template: "default", slots: {} },
      ]),
    ).toBe("slide-1");
  });

  it("buildEmptySlide creates empty values for every declared slot", () => {
    const slide = buildEmptySlide("default", "slide-1", {
      title: {
        kind: "text",
        label: "Title",
        required: true,
      },
      body: {
        kind: "richtext",
        label: "Body",
        required: true,
      },
    });
    expect(slide.id).toBe("slide-1");
    expect(slide.template).toBe("default");
    expect(slide.slots.title).toEqual({ kind: "text", value: "" });
    expect(slide.slots.body).toEqual({ kind: "richtext", value: "" });
  });
});
