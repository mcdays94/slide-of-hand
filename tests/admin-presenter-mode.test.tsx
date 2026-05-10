/**
 * Verifies the cross-slice wiring contract: the admin viewer route activates
 * presenter mode (so slice #5's window key handler + slice #6's tools mount),
 * while the public viewer route leaves it disabled.
 *
 * We replace the heavy `<Deck>` with a probe that calls `usePresenterMode()`
 * and stashes the result. Then we mount each route under a `<MemoryRouter>`
 * and read the captured value.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { usePresenterMode } from "@/framework/presenter/mode";

let lastObserved: boolean | null = null;

vi.mock("@/framework/viewer/Deck", () => ({
  Deck: () => {
    lastObserved = usePresenterMode();
    return <div data-testid="deck-stub">deck</div>;
  },
}));

const stubDeck = {
  meta: {
    slug: "stub",
    title: "Stub",
    description: "Stub deck",
    date: "2026-05-01",
  },
  slides: [{ id: "title", render: () => null }],
};

vi.mock("@/lib/decks-registry", () => ({
  // Lazy build-time deck API (issue #105). The route reads
  // `hasBuildTimeDeck(slug)` first, then suspends on `getDeckResource(slug)`.
  // Tests stub both with the same `stub` deck so the route renders.
  hasBuildTimeDeck: (slug: string) => slug === "stub",
  getDeckResource: () => ({ read: () => stubDeck }),
  getDeckMetaBySlug: (slug: string) =>
    slug === "stub" ? stubDeck.meta : undefined,
  // Backwards-compat shim still used by some legacy call sites.
  getDeckBySlug: (slug: string) => (slug === "stub" ? stubDeck : undefined),
  getAllDecks: () => [],
  getAllDeckMetas: () => [],
  getPublicDecks: () => [],
  getPublicDeckMetas: () => [],
  getAllDeckEntries: () => [],
  // Slice 5 (#61): the route reads the KV hook even when the build-time
  // registry has the slug (the hook short-circuits on empty slug). The
  // mock just needs to expose the same shape so the import resolves.
  useDataDeck: () => ({
    deck: null,
    isLoading: false,
    notFound: false,
    refetch: async () => {},
  }),
  // Slice 6 (#62): the admin route now reads the admin-variant hook
  // so private KV decks resolve. Same shape as `useDataDeck`.
  useAdminDataDeck: () => ({
    deck: null,
    isLoading: false,
    notFound: false,
    refetch: async () => {},
  }),
  useDataDeckList: () => ({ decks: [], isLoading: false }),
}));

const { default: AdminDeckRoute } = await import(
  "@/routes/admin/decks.$slug"
);
const { default: PublicDeckRoute } = await import("@/routes/deck.$slug");

afterEach(() => {
  lastObserved = null;
  cleanup();
});

describe("PresenterMode wiring across viewer routes", () => {
  it("admin viewer at /admin/decks/<slug> activates presenter mode", () => {
    render(
      <MemoryRouter initialEntries={["/admin/decks/stub"]}>
        <Routes>
          <Route path="/admin/decks/:slug" element={<AdminDeckRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(lastObserved).toBe(true);
  });

  it("public viewer at /decks/<slug> leaves presenter mode disabled", () => {
    render(
      <MemoryRouter initialEntries={["/decks/stub"]}>
        <Routes>
          <Route path="/decks/:slug" element={<PublicDeckRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(lastObserved).toBe(false);
  });
});
