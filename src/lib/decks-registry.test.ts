/**
 * Tests for the deck registry — both the pure build-time transformation
 * and the KV-merge helpers (Slice 5 / #61).
 *
 * The real registry calls `import.meta.glob` at module import time; rather
 * than mock that, we expose `buildRegistry()` and `mergeDeckLists()` which
 * take the same shape and apply our assertions on them directly.
 *
 * Hooks (`useDataDeckList` / `useDataDeck`) are exercised via React Testing
 * Library against a stubbed `fetch`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  buildRegistry,
  mergeDeckLists,
  useDataDeck,
  useDataDeckList,
} from "./decks-registry";
import type { Deck, DeckMeta } from "@/framework/viewer/types";
import type { DataDeck } from "./deck-record";

const stubSlide = {
  id: "stub",
  render: () => null,
};

const makeDeck = (slug: string, date: string): Deck => ({
  meta: { slug, title: slug, description: "x", date },
  slides: [stubSlide],
});

describe("buildRegistry", () => {
  it("discovers decks from public + private paths", () => {
    const result = buildRegistry({
      "/src/decks/public/alpha/index.tsx": { default: makeDeck("alpha", "2026-01-01") },
      "/src/decks/private/secret/index.tsx": { default: makeDeck("secret", "2026-02-01") },
    });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.deck.meta.slug).sort()).toEqual([
      "alpha",
      "secret",
    ]);
    expect(
      result.find((e) => e.folder === "secret")?.visibility,
    ).toBe("private");
  });

  it("sorts by date descending", () => {
    const result = buildRegistry({
      "/src/decks/public/older/index.tsx": { default: makeDeck("older", "2025-06-01") },
      "/src/decks/public/newer/index.tsx": { default: makeDeck("newer", "2026-06-01") },
    });
    expect(result.map((e) => e.deck.meta.slug)).toEqual(["newer", "older"]);
  });

  it("throws when meta.slug does not match the folder name", () => {
    expect(() =>
      buildRegistry({
        "/src/decks/public/foo/index.tsx": { default: makeDeck("bar", "2026-01-01") },
      }),
    ).toThrow(/Slug mismatch/);
  });

  it("throws when default export is not a Deck", () => {
    expect(() =>
      buildRegistry({
        "/src/decks/public/foo/index.tsx": { default: {} as Deck },
      }),
    ).toThrow(/does not default-export a Deck/);
  });

  it("ignores paths that don't match the registry pattern", () => {
    const result = buildRegistry({
      "/src/decks/public/foo/helper.tsx": { default: makeDeck("foo", "2026-01-01") },
    });
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// mergeDeckLists — pure helper that combines build-time + KV summaries
// into a single `DeckMeta[]` ready for the public index.
// ──────────────────────────────────────────────────────────────────────────

const meta = (
  slug: string,
  date: string,
  rest: Partial<DeckMeta> = {},
): DeckMeta => ({
  slug,
  title: `Deck ${slug}`,
  description: `${slug} desc`,
  date,
  ...rest,
});

const summary = (
  slug: string,
  date: string,
  rest: Partial<{
    title: string;
    description: string;
    cover: string;
    runtimeMinutes: number;
    visibility: "public" | "private";
  }> = {},
) => ({
  slug,
  title: rest.title ?? `KV ${slug}`,
  description: rest.description,
  date,
  cover: rest.cover,
  runtimeMinutes: rest.runtimeMinutes,
  visibility: rest.visibility ?? ("public" as const),
});

describe("mergeDeckLists", () => {
  it("combines build-time decks with KV summaries", () => {
    const merged = mergeDeckLists(
      [meta("source-a", "2026-04-01")],
      [summary("kv-a", "2026-03-01")],
    );
    expect(merged.map((m) => m.slug).sort()).toEqual(["kv-a", "source-a"]);
  });

  it("sorts merged result by date desc, then slug asc", () => {
    const merged = mergeDeckLists(
      [meta("source-old", "2025-01-01"), meta("source-new", "2026-12-01")],
      [
        summary("kv-mid", "2026-06-01"),
        summary("kv-new", "2026-12-01"),
      ],
    );
    expect(merged.map((m) => m.slug)).toEqual([
      "kv-new",
      "source-new",
      "kv-mid",
      "source-old",
    ]);
  });

  it("makes build-time win on slug collision (precedence)", () => {
    const merged = mergeDeckLists(
      [meta("shared", "2026-01-01", { description: "from source" })],
      [
        summary("shared", "2026-12-01", {
          title: "from KV",
          description: "kv version",
        }),
      ],
    );
    const shared = merged.find((m) => m.slug === "shared");
    expect(shared?.title).toBe("Deck shared"); // build-time title
    expect(shared?.description).toBe("from source");
    expect(shared?.date).toBe("2026-01-01");
    expect(merged).toHaveLength(1); // KV entry dropped
  });

  it("filters out non-public KV summaries defensively", () => {
    const merged = mergeDeckLists(
      [],
      [
        summary("public-one", "2026-04-01"),
        summary("private-one", "2026-04-01", { visibility: "private" }),
      ],
    );
    expect(merged.map((m) => m.slug)).toEqual(["public-one"]);
  });

  it("converts KV summaries into DeckMeta shape (description default)", () => {
    const merged = mergeDeckLists([], [summary("kv-no-desc", "2026-01-01")]);
    expect(merged[0].description).toBe("");
  });

  it("preserves cover and runtimeMinutes from KV", () => {
    const merged = mergeDeckLists(
      [],
      [
        summary("rich", "2026-01-01", {
          cover: "/cover.png",
          runtimeMinutes: 30,
        }),
      ],
    );
    expect(merged[0].cover).toBe("/cover.png");
    expect(merged[0].runtimeMinutes).toBe(30);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// useDataDeckList — fetches /api/decks and merges with build-time list.
// ──────────────────────────────────────────────────────────────────────────

function mockFetch(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => response,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch({ decks: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDataDeckList", () => {
  it("fetches /api/decks on mount", async () => {
    const fetchMock = mockFetch({ decks: [] });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDataDeckList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/decks",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("returns merged + sorted decks once the fetch resolves", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        decks: [summary("kv-deck", "2026-12-01", { title: "KV Deck" })],
      }),
    );
    const { result } = renderHook(() => useDataDeckList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const slugs = result.current.decks.map((d) => d.slug);
    // Build-time `hello` (from src/decks/public/hello) is auto-discovered;
    // it'll be in the list along with the KV deck. We only assert the KV
    // entry is present with the right title.
    expect(slugs).toContain("kv-deck");
    const kv = result.current.decks.find((d) => d.slug === "kv-deck");
    expect(kv?.title).toBe("KV Deck");
  });

  it("falls back to build-time only when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useDataDeckList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // No KV decks merged. Build-time "hello" still present.
    expect(result.current.decks.every((d) => d.slug !== "kv-deck")).toBe(true);
  });

  it("falls back to build-time only when the response is non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetch({ decks: [] }, false));
    const { result } = renderHook(() => useDataDeckList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isLoading).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// useDataDeck — fetches /api/decks/<slug>
// ──────────────────────────────────────────────────────────────────────────

const sampleDataDeck: DataDeck = {
  meta: {
    slug: "kv-only",
    title: "KV Only",
    date: "2026-04-01",
    visibility: "public",
  },
  slides: [
    {
      id: "title",
      template: "cover",
      slots: { title: { kind: "text", value: "Hello" } },
    },
  ],
};

describe("useDataDeck", () => {
  it("fetches /api/decks/<slug> on mount", async () => {
    const fetchMock = mockFetch(sampleDataDeck);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDataDeck("kv-only"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/decks/kv-only",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result.current.deck?.meta.slug).toBe("kv-only");
    expect(result.current.notFound).toBe(false);
  });

  it("URL-encodes the slug", async () => {
    const fetchMock = mockFetch(sampleDataDeck);
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useDataDeck("weird slug"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/decks/weird%20slug",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("flags notFound on 404 response", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "not found" }, false));
    const { result } = renderHook(() => useDataDeck("missing"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.deck).toBeNull();
    expect(result.current.notFound).toBe(true);
  });

  it("flags notFound on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useDataDeck("kv-only"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.deck).toBeNull();
    expect(result.current.notFound).toBe(true);
  });

  it("does not fetch when slug is empty", async () => {
    const fetchMock = mockFetch(sampleDataDeck);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDataDeck(""));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.deck).toBeNull();
  });

  it("re-fetches when the slug changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => sampleDataDeck })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...sampleDataDeck,
          meta: { ...sampleDataDeck.meta, slug: "another", title: "Another" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ slug }: { slug: string }) => useDataDeck(slug),
      { initialProps: { slug: "kv-only" } },
    );
    await waitFor(() => expect(result.current.deck?.meta.slug).toBe("kv-only"));
    rerender({ slug: "another" });
    await waitFor(() => expect(result.current.deck?.meta.slug).toBe("another"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
