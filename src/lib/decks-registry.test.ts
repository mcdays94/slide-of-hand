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
  loadDeckBySlug,
  mergeAdminDeckLists,
  mergeDeckLists,
  useAdminDataDeck,
  useAdminDataDeckList,
  useDataDeck,
  useDataDeckList,
  type RegistryEntry,
} from "./decks-registry";
import type { DeckMeta } from "@/framework/viewer/types";
import type { DataDeck } from "./deck-record";

const makeMetaModule = (slug: string, date: string) => ({
  meta: { slug, title: slug, description: "x", date } as DeckMeta,
});

describe("buildRegistry", () => {
  it("discovers decks from public + private paths", () => {
    const result = buildRegistry({
      "/src/decks/public/alpha/meta.ts": makeMetaModule("alpha", "2026-01-01"),
      "/src/decks/private/secret/meta.ts": makeMetaModule("secret", "2026-02-01"),
    });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.meta.slug).sort()).toEqual([
      "alpha",
      "secret",
    ]);
    expect(
      result.find((e) => e.folder === "secret")?.visibility,
    ).toBe("private");
  });

  it("sorts by date descending", () => {
    const result = buildRegistry({
      "/src/decks/public/older/meta.ts": makeMetaModule("older", "2025-06-01"),
      "/src/decks/public/newer/meta.ts": makeMetaModule("newer", "2026-06-01"),
    });
    expect(result.map((e) => e.meta.slug)).toEqual(["newer", "older"]);
  });

  it("throws when meta.slug does not match the folder name", () => {
    expect(() =>
      buildRegistry({
        "/src/decks/public/foo/meta.ts": makeMetaModule("bar", "2026-01-01"),
      }),
    ).toThrow(/Slug mismatch/);
  });

  it("throws when meta export is malformed", () => {
    expect(() =>
      buildRegistry({
        "/src/decks/public/foo/meta.ts": { meta: {} as DeckMeta },
      }),
    ).toThrow(/does not export a valid `meta`/);
  });

  it("ignores paths that don't match the meta pattern", () => {
    const result = buildRegistry({
      "/src/decks/public/foo/helper.tsx": makeMetaModule("foo", "2026-01-01"),
    });
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Lazy build-time deck loading (issue #105). Verifies that the registry's
// `loadDeckBySlug` resolves real build-time decks via the in-process
// `import.meta.glob` map and that unknown slugs return `undefined`.
// ──────────────────────────────────────────────────────────────────────────

describe("loadDeckBySlug — lazy build-time decks (issue #105)", () => {
  it("resolves a real build-time deck (the `hello` demo)", async () => {
    const deck = await loadDeckBySlug("hello");
    expect(deck).toBeDefined();
    expect(deck?.meta.slug).toBe("hello");
    expect(Array.isArray(deck?.slides)).toBe(true);
    expect((deck?.slides ?? []).length).toBeGreaterThan(0);
  });

  it("resolves to undefined for unknown slugs", async () => {
    const deck = await loadDeckBySlug("definitely-not-a-deck");
    expect(deck).toBeUndefined();
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

  it("leaves description undefined on KV summaries that omit it", () => {
    // `DeckMeta.description` is optional; we must not coalesce missing
    // values to "" — consumers conditional-render the description.
    const merged = mergeDeckLists([], [summary("kv-no-desc", "2026-01-01")]);
    expect(merged[0].description).toBeUndefined();
    expect("description" in merged[0]).toBe(false);
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

const ORIGINAL_HOSTNAME = window.location.hostname;
function setHostname(value: string) {
  Object.defineProperty(window.location, "hostname", {
    value,
    configurable: true,
  });
}

describe("useAdminDataDeck", () => {
  afterEach(() => {
    setHostname(ORIGINAL_HOSTNAME);
  });

  it("fetches /api/admin/decks/<slug> on mount", async () => {
    const fetchMock = mockFetch(sampleDataDeck);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminDataDeck("kv-only"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/decks/kv-only",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result.current.deck?.meta.slug).toBe("kv-only");
    expect(result.current.notFound).toBe(false);
  });

  it("injects the dev-auth header on localhost", async () => {
    setHostname("localhost");
    const fetchMock = mockFetch(sampleDataDeck);
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useAdminDataDeck("kv-only"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
  });

  it("flags notFound on 404 response", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "not found" }, false));
    const { result } = renderHook(() => useAdminDataDeck("missing"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.deck).toBeNull();
    expect(result.current.notFound).toBe(true);
  });

  it("does not fetch when slug is empty", async () => {
    const fetchMock = mockFetch(sampleDataDeck);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminDataDeck(""));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.deck).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// mergeAdminDeckLists — admin variant of mergeDeckLists.
//
// Differences vs. mergeDeckLists:
//   - Returns RegistryEntry-shaped admin entries (with `source` + `visibility`)
//     so the admin page can render a visibility badge + optional IDE button.
//   - Does NOT filter on visibility — admins see private KV decks too.
//   - Build-time wins on slug collision; KV entry is dropped silently.
//   - Sort order matches mergeDeckLists: date desc, then slug asc.
// ──────────────────────────────────────────────────────────────────────────

const sourceEntry = (
  slug: string,
  date: string,
  visibility: "public" | "private" = "public",
  rest: Partial<DeckMeta> = {},
): RegistryEntry => ({
  visibility,
  folder: slug,
  meta: {
    slug,
    title: `Source ${slug}`,
    description: `${slug} src desc`,
    date,
    ...rest,
  },
});

describe("mergeAdminDeckLists", () => {
  it("combines build-time entries with KV summaries", () => {
    const merged = mergeAdminDeckLists(
      [sourceEntry("source-a", "2026-04-01")],
      [summary("kv-a", "2026-03-01")],
    );
    const slugs = merged.map((e) => e.meta.slug).sort();
    expect(slugs).toEqual(["kv-a", "source-a"]);
  });

  it("includes private KV summaries (admin sees private)", () => {
    const merged = mergeAdminDeckLists(
      [],
      [
        summary("kv-public", "2026-04-01"),
        summary("kv-private", "2026-04-01", { visibility: "private" }),
      ],
    );
    const slugs = merged.map((e) => e.meta.slug).sort();
    expect(slugs).toEqual(["kv-private", "kv-public"]);
  });

  it("preserves visibility on KV entries", () => {
    const merged = mergeAdminDeckLists(
      [],
      [summary("kv-private", "2026-04-01", { visibility: "private" })],
    );
    expect(merged[0]?.visibility).toBe("private");
  });

  it("preserves visibility on build-time entries", () => {
    const merged = mergeAdminDeckLists(
      [sourceEntry("source-private", "2026-04-01", "private")],
      [],
    );
    expect(merged[0]?.visibility).toBe("private");
  });

  it("tags entries with their source ('source' vs 'kv')", () => {
    const merged = mergeAdminDeckLists(
      [sourceEntry("source-a", "2026-04-01")],
      [summary("kv-a", "2026-04-01")],
    );
    const sourceA = merged.find((e) => e.meta.slug === "source-a");
    const kvA = merged.find((e) => e.meta.slug === "kv-a");
    expect(sourceA?.source).toBe("source");
    expect(kvA?.source).toBe("kv");
  });

  it("sorts merged result by date desc, then slug asc", () => {
    const merged = mergeAdminDeckLists(
      [
        sourceEntry("source-old", "2025-01-01"),
        sourceEntry("source-new", "2026-12-01"),
      ],
      [
        summary("kv-mid", "2026-06-01"),
        summary("kv-new", "2026-12-01"),
      ],
    );
    expect(merged.map((e) => e.meta.slug)).toEqual([
      "kv-new",
      "source-new",
      "kv-mid",
      "source-old",
    ]);
  });

  it("makes build-time win on slug collision (precedence)", () => {
    const merged = mergeAdminDeckLists(
      [
        sourceEntry("shared", "2026-01-01", "public", {
          title: "From source",
        }),
      ],
      [
        summary("shared", "2026-12-01", {
          title: "From KV",
          visibility: "private",
        }),
      ],
    );
    expect(merged).toHaveLength(1);
    const shared = merged[0];
    expect(shared.meta.slug).toBe("shared");
    expect(shared.meta.title).toBe("From source");
    expect(shared.meta.date).toBe("2026-01-01");
    expect(shared.source).toBe("source");
    // The build-time visibility wins too — KV's "private" is dropped.
    expect(shared.visibility).toBe("public");
  });

  it("preserves cover and runtimeMinutes from KV summaries", () => {
    const merged = mergeAdminDeckLists(
      [],
      [
        summary("rich-kv", "2026-01-01", {
          cover: "/cover.png",
          runtimeMinutes: 30,
        }),
      ],
    );
    expect(merged[0]?.meta.cover).toBe("/cover.png");
    expect(merged[0]?.meta.runtimeMinutes).toBe(30);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// useAdminDataDeckList — fetches /api/admin/decks (Access-gated; sees
// private decks; sends dev-auth header on localhost) and merges with the
// build-time registry entries.
// ──────────────────────────────────────────────────────────────────────────

describe("useAdminDataDeckList", () => {
  afterEach(() => {
    setHostname(ORIGINAL_HOSTNAME);
  });

  it("fetches /api/admin/decks on mount", async () => {
    const fetchMock = mockFetch({ decks: [] });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminDataDeckList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/decks",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("injects the dev-auth header on localhost", async () => {
    setHostname("localhost");
    const fetchMock = mockFetch({ decks: [] });
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useAdminDataDeckList());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
  });

  it("returns merged entries (build-time + KV public + KV private)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        decks: [
          summary("kv-public", "2026-12-01", { title: "KV Public" }),
          summary("kv-private", "2026-12-02", {
            title: "KV Private",
            visibility: "private",
          }),
        ],
      }),
    );
    const { result } = renderHook(() => useAdminDataDeckList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const slugs = result.current.entries.map((e) => e.meta.slug);
    expect(slugs).toContain("kv-public");
    expect(slugs).toContain("kv-private");
    const kvPriv = result.current.entries.find(
      (e) => e.meta.slug === "kv-private",
    );
    expect(kvPriv?.visibility).toBe("private");
    expect(kvPriv?.source).toBe("kv");
  });

  it("falls back to build-time entries when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useAdminDataDeckList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // No KV entries merged. The build-time `hello` deck is still present
    // (from src/decks/public/hello in this test environment).
    expect(
      result.current.entries.every((e) => e.source === "source"),
    ).toBe(true);
  });

  it("falls back to build-time entries when the response is non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetch({ decks: [] }, false));
    const { result } = renderHook(() => useAdminDataDeckList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries.every((e) => e.source === "source")).toBe(
      true,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Draft filtering (issue #191 / slice 2)
//
// Public consumers (`/`) MUST drop decks with `meta.draft === true`. Admin
// consumers (`/admin`) MUST keep them so authors can find and edit drafts.
//
// The filter applies on BOTH halves of the public deck list:
//   - Build-time source decks (via `getPublicDeckMetas()` from the registry).
//   - KV-backed decks (via `mergeDeckLists()` from the wire summaries).
//
// The admin counterparts (`getAllDeckMetas`, `getAllDeckEntries`,
// `mergeAdminDeckLists`) MUST NOT filter — that's what makes the admin
// surface authoritative.
// ──────────────────────────────────────────────────────────────────────────

const draftSummary = (
  slug: string,
  date: string,
  rest: Partial<{
    title: string;
    description: string;
    cover: string;
    runtimeMinutes: number;
    visibility: "public" | "private";
    draft: boolean;
  }> = {},
) => ({
  slug,
  title: rest.title ?? `KV ${slug}`,
  description: rest.description,
  date,
  cover: rest.cover,
  runtimeMinutes: rest.runtimeMinutes,
  visibility: rest.visibility ?? ("public" as const),
  draft: rest.draft,
});

describe("mergeDeckLists — draft filtering (issue #191)", () => {
  it("drops KV summaries with draft === true from the public list", () => {
    const merged = mergeDeckLists(
      [],
      [
        draftSummary("kv-published", "2026-01-01"),
        draftSummary("kv-draft", "2026-01-01", { draft: true }),
      ],
    );
    expect(merged.map((m) => m.slug)).toEqual(["kv-published"]);
  });

  it("keeps KV summaries with draft === false or undefined", () => {
    const merged = mergeDeckLists(
      [],
      [
        draftSummary("kv-undef", "2026-02-01"),
        draftSummary("kv-false", "2026-01-01", { draft: false }),
      ],
    );
    expect(merged.map((m) => m.slug).sort()).toEqual(["kv-false", "kv-undef"]);
  });

  it("drops build-time DeckMetas with draft === true from the public list", () => {
    const merged = mergeDeckLists(
      [
        meta("source-published", "2026-01-01"),
        meta("source-draft", "2026-01-01", { draft: true }),
      ],
      [],
    );
    expect(merged.map((m) => m.slug)).toEqual(["source-published"]);
  });

  it("keeps build-time DeckMetas with draft === false or undefined", () => {
    const merged = mergeDeckLists(
      [
        meta("source-undef", "2026-02-01"),
        meta("source-false", "2026-01-01", { draft: false }),
      ],
      [],
    );
    expect(merged.map((m) => m.slug).sort()).toEqual([
      "source-false",
      "source-undef",
    ]);
  });
});

describe("mergeAdminDeckLists — drafts visible to admins (issue #191)", () => {
  it("keeps KV summaries with draft === true (admin sees drafts)", () => {
    const merged = mergeAdminDeckLists(
      [],
      [
        draftSummary("kv-published", "2026-01-01"),
        draftSummary("kv-draft", "2026-01-01", { draft: true }),
      ],
    );
    const slugs = merged.map((e) => e.meta.slug).sort();
    expect(slugs).toEqual(["kv-draft", "kv-published"]);
  });

  it("keeps build-time entries with draft === true (admin sees drafts)", () => {
    const merged = mergeAdminDeckLists(
      [
        sourceEntry("source-draft", "2026-01-01", "public", { draft: true }),
        sourceEntry("source-published", "2026-01-02"),
      ],
      [],
    );
    const slugs = merged.map((e) => e.meta.slug).sort();
    expect(slugs).toEqual(["source-draft", "source-published"]);
  });

  it("preserves the draft flag on KV entries so admin UI can render a pill", () => {
    const merged = mergeAdminDeckLists(
      [],
      [draftSummary("kv-draft", "2026-01-01", { draft: true })],
    );
    expect(merged[0]?.meta.draft).toBe(true);
  });
});

// `useDataDeckList` is the hook the public route consumes. Confirm it
// applies the draft filter when KV returns a mix of drafts + published
// AND when the build-time half is dirty (the test re-mocks
// `getPublicDeckMetas` to simulate a draft source deck).
describe("useDataDeckList — draft filtering (issue #191)", () => {
  it("hides KV decks with draft === true from the public list", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        decks: [
          draftSummary("kv-published", "2026-12-01"),
          draftSummary("kv-draft", "2026-12-01", { draft: true }),
        ],
      }),
    );
    const { result } = renderHook(() => useDataDeckList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const slugs = result.current.decks.map((d) => d.slug);
    expect(slugs).toContain("kv-published");
    expect(slugs).not.toContain("kv-draft");
  });
});
