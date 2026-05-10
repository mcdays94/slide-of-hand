/**
 * Tests for `/decks/<slug>` — the public deck route.
 *
 * Three resolution paths (Slice 5 / #61):
 *   1. Build-time hit → lazy-load the deck's chunk and render the
 *      existing source-based `<Deck>` (issue #105).
 *   2. Build-time miss + KV hit → render `<DataDeck>` (which wraps `<Deck>`).
 *   3. Both miss → 404 page.
 *
 * We mock both `<Deck>` and `<DataDeck>` to keep the suite light and to make
 * the assertion surface the route's resolution decision (which component it
 * picked) rather than the heavy viewer internals.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Deck } from "@/framework/viewer/types";
import type { DataDeck as DataDeckRecord } from "@/lib/deck-record";

const stubSlide = { id: "stub", render: () => null };

const sourceDeck: Deck = {
  meta: {
    slug: "source-deck",
    title: "Source Deck",
    description: "from build-time",
    date: "2026-04-01",
  },
  slides: [stubSlide],
};

const dataDeckRecord: DataDeckRecord = {
  meta: {
    slug: "kv-deck",
    title: "KV Deck",
    date: "2026-04-02",
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

vi.mock("@/framework/viewer/Deck", () => ({
  Deck: ({ slug, title }: { slug: string; title: string }) => (
    <div data-testid="source-deck-stub" data-slug={slug} data-title={title}>
      source deck
    </div>
  ),
}));

vi.mock("@/framework/viewer/DataDeck", async () => {
  const actual = await vi.importActual<
    typeof import("@/framework/viewer/DataDeck")
  >("@/framework/viewer/DataDeck");
  return {
    ...actual,
    DataDeck: ({ deck }: { deck: DataDeckRecord }) => (
      <div data-testid="data-deck-stub" data-slug={deck.meta.slug}>
        data deck
      </div>
    ),
  };
});

vi.mock("@/framework/presenter/PresenterWindow", () => ({
  PresenterWindow: ({ deck }: { deck: Deck }) => (
    <div
      data-testid="presenter-window-stub"
      data-slug={deck.meta.slug}
      data-title={deck.meta.title}
    >
      presenter window
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
});

function mockFetchSequence(
  responses: Array<{ ok: boolean; body: unknown }>,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn();
  for (const r of responses) {
    mock.mockResolvedValueOnce({
      ok: r.ok,
      json: async () => r.body,
    });
  }
  return mock;
}

async function renderRouteAt(slug: string, queryString = "") {
  const mod = await import("./deck.$slug");
  const DeckRoute = mod.default;
  const initialEntry = `/decks/${slug}${queryString}`;
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/decks/:slug" element={<DeckRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Build a stubbed registry module that emulates the lazy build-time deck
 * API. `buildTimeDecks` is a slug → Deck map; lookups simulate
 * `hasBuildTimeDeck` and `getDeckResource` as a synchronously-resolved
 * resource (no real chunk fetching in tests).
 */
function makeRegistryMock(buildTimeDecks: Record<string, Deck>) {
  return async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/decks-registry")
    >("@/lib/decks-registry");
    return {
      ...actual,
      hasBuildTimeDeck: (slug: string) => Boolean(buildTimeDecks[slug]),
      getDeckResource: (slug: string) => ({
        // Resource read returns the Deck synchronously — there is no
        // pending state in tests, so Suspense never throws.
        read: () => buildTimeDecks[slug],
      }),
      getDeckMetaBySlug: (slug: string) => buildTimeDecks[slug]?.meta,
    };
  };
}

describe("/decks/<slug> — KV fallback (Slice 5)", () => {
  it("renders source <Deck> when slug hits the build-time registry", async () => {
    vi.doMock(
      "@/lib/decks-registry",
      makeRegistryMock({ "source-deck": sourceDeck }),
    );

    await renderRouteAt("source-deck");
    expect(screen.getByTestId("source-deck-stub")).toBeTruthy();
    expect(screen.getByTestId("source-deck-stub").getAttribute("data-slug")).toBe(
      "source-deck",
    );
    expect(screen.queryByTestId("data-deck-stub")).toBeNull();
  });

  it("falls back to <DataDeck> when build-time misses but KV has the deck", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: true, body: dataDeckRecord }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));

    await renderRouteAt("kv-deck");
    await waitFor(() =>
      expect(screen.queryByTestId("data-deck-stub")).toBeTruthy(),
    );
    expect(screen.getByTestId("data-deck-stub").getAttribute("data-slug")).toBe(
      "kv-deck",
    );
    expect(screen.queryByTestId("source-deck-stub")).toBeNull();
  });

  it("renders the 404 page when both build-time and KV miss", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: false, body: { error: "not found" } }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));

    await renderRouteAt("missing-deck");
    await waitFor(() =>
      expect(screen.getByText(/no deck called/i)).toBeTruthy(),
    );
    expect(screen.queryByTestId("source-deck-stub")).toBeNull();
    expect(screen.queryByTestId("data-deck-stub")).toBeNull();
  });

  it("treats a private-deck-as-404 from the worker as the 404 path", async () => {
    // Worker returns 404 for private slugs on the public read endpoint
    // (no leak). The route must surface 404 rather than rendering anything.
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: false, body: { error: "not found" } }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));

    await renderRouteAt("private-only");
    await waitFor(() =>
      expect(screen.getByText(/no deck called/i)).toBeTruthy(),
    );
  });

  // ── presenter mode for KV decks (#61 follow-up) ──────────────────────
  it("renders <PresenterWindow> for a KV-backed deck when ?presenter=1", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: true, body: dataDeckRecord }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));

    await renderRouteAt("kv-deck", "?presenter=1");
    await waitFor(() =>
      expect(screen.queryByTestId("presenter-window-stub")).toBeTruthy(),
    );
    const stub = screen.getByTestId("presenter-window-stub");
    expect(stub.getAttribute("data-slug")).toBe("kv-deck");
    expect(stub.getAttribute("data-title")).toBe("KV Deck");
    // The viewer stubs must NOT have rendered.
    expect(screen.queryByTestId("data-deck-stub")).toBeNull();
    expect(screen.queryByTestId("source-deck-stub")).toBeNull();
  });

  it("does not fire a KV fetch when the build-time registry has the slug", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock(
      "@/lib/decks-registry",
      makeRegistryMock({ "source-deck": sourceDeck }),
    );

    await renderRouteAt("source-deck");
    // Hook still mounts but with no slug-shaped fetch — we assert the
    // /api/decks/<slug> URL was never requested.
    const calledWithKvUrl = fetchMock.mock.calls.some(
      (args) =>
        typeof args[0] === "string" &&
        args[0].startsWith("/api/decks/source-deck"),
    );
    expect(calledWithKvUrl).toBe(false);
  });
});
