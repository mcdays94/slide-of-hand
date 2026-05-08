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

describe("useDeckEditor — slide CRUD ops", () => {
  function multiSlideDeck(): DataDeck {
    return {
      meta: {
        slug: "hello",
        title: "Hello",
        date: "2026-05-01",
        visibility: "private",
      },
      slides: [
        {
          id: "intro",
          template: "default",
          slots: {
            title: { kind: "text", value: "Intro" },
            body: { kind: "richtext", value: "Body" },
          },
        },
        {
          id: "slide-2",
          template: "default",
          slots: {
            title: { kind: "text", value: "Two" },
            body: { kind: "richtext", value: "Two body" },
          },
        },
        {
          id: "slide-3",
          template: "default",
          slots: {
            title: { kind: "text", value: "Three" },
            body: { kind: "richtext", value: "Three body" },
          },
        },
      ],
    };
  }

  it("deleteSlide removes a slide by id and marks dirty", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.deleteSlide("slide-2"));

    const slides = result.current.draft?.slides ?? [];
    expect(slides).toHaveLength(2);
    expect(slides.map((s) => s.id)).toEqual(["intro", "slide-3"]);
    expect(result.current.isDirty).toBe(true);
    // Persistent untouched.
    expect(result.current.persistent?.slides).toHaveLength(3);
  });

  it("deleteSlide is a no-op when the id is unknown", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.deleteSlide("nonexistent"));
    expect(result.current.draft?.slides).toHaveLength(3);
    expect(result.current.isDirty).toBe(false);
  });

  it("duplicateSlide inserts a copy with a fresh id immediately after", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.duplicateSlide("intro"));

    const slides = result.current.draft?.slides ?? [];
    expect(slides).toHaveLength(4);
    // The copy is at index 1, immediately after the source.
    expect(slides[0].id).toBe("intro");
    expect(slides[1].id).not.toBe("intro");
    expect(slides[1].template).toBe("intro" === "intro" ? "default" : "");
    // Slot values cloned.
    expect(slides[1].slots.title).toEqual({ kind: "text", value: "Intro" });
    expect(result.current.isDirty).toBe(true);
  });

  it("duplicateSlide is a no-op when the id is unknown", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.duplicateSlide("nonexistent"));
    expect(result.current.draft?.slides).toHaveLength(3);
    expect(result.current.isDirty).toBe(false);
  });

  it("duplicateSlide deep-clones slot values (mutating one doesn't bleed)", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.duplicateSlide("intro"));
    const dupId = result.current.draft!.slides[1].id;
    act(() =>
      result.current.updateSlide(dupId, (s) => ({
        ...s,
        slots: {
          ...s.slots,
          title: { kind: "text", value: "Different" },
        },
      })),
    );
    // Source slot stayed the same.
    expect(result.current.draft?.slides[0].slots.title).toEqual({
      kind: "text",
      value: "Intro",
    });
  });

  it("reorderSlides moves a slide from one index to another", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Move first slide to last position.
    act(() => result.current.reorderSlides(0, 2));

    const ids = result.current.draft?.slides.map((s) => s.id) ?? [];
    expect(ids).toEqual(["slide-2", "slide-3", "intro"]);
    expect(result.current.isDirty).toBe(true);
  });

  it("reorderSlides handles backward moves", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Move last slide to the first position.
    act(() => result.current.reorderSlides(2, 0));

    const ids = result.current.draft?.slides.map((s) => s.id) ?? [];
    expect(ids).toEqual(["slide-3", "intro", "slide-2"]);
  });

  it("reorderSlides is a no-op when from === to", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.reorderSlides(1, 1));
    expect(result.current.isDirty).toBe(false);
  });

  it("reorderSlides ignores out-of-range indices", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.reorderSlides(-1, 0));
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.reorderSlides(0, 99));
    expect(result.current.isDirty).toBe(false);
  });

  it("setActiveSlide / activeSlideId track the focused slide", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Defaults to the first slide id.
    expect(result.current.activeSlideId).toBe("intro");

    act(() => result.current.setActiveSlide("slide-2"));
    expect(result.current.activeSlideId).toBe("slide-2");
  });

  it("setActiveSlide does not affect dirty state", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setActiveSlide("slide-3"));
    expect(result.current.isDirty).toBe(false);
  });

  it("addSlide auto-selects the new slide", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addSlide("default"));
    const last = result.current.draft!.slides.at(-1)!;
    expect(result.current.activeSlideId).toBe(last.id);
  });

  it("addSlide(template, afterIndex) inserts after the given index", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addSlide("default", 0));

    const ids = result.current.draft?.slides.map((s) => s.id) ?? [];
    // New slide inserted at index 1, after "intro".
    expect(ids[0]).toBe("intro");
    expect(ids[1]).toBe("slide-4"); // next id after slide-3
    expect(ids[2]).toBe("slide-2");
    expect(result.current.activeSlideId).toBe("slide-4");
  });

  it("deleteSlide picks a sensible neighbour as the new active slide", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setActiveSlide("slide-2"));
    act(() => result.current.deleteSlide("slide-2"));
    // After deleting slide-2 (index 1), the next-best is slide-3 (was index 2).
    expect(result.current.activeSlideId).toBe("slide-3");
  });

  it("deleting the active slide when it's last falls back to the new last", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setActiveSlide("slide-3"));
    act(() => result.current.deleteSlide("slide-3"));
    expect(result.current.activeSlideId).toBe("slide-2");
  });

  it("duplicateSlide auto-selects the new copy", async () => {
    vi.stubGlobal("fetch", mockFetch(multiSlideDeck()));
    const { result } = renderHook(() => useDeckEditor("hello"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.duplicateSlide("intro"));
    const dup = result.current.draft!.slides[1];
    expect(result.current.activeSlideId).toBe(dup.id);
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
