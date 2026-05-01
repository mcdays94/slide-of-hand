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

vi.mock("@/lib/decks-registry", () => ({
  getDeckBySlug: () => ({
    meta: {
      slug: "stub",
      title: "Stub",
      description: "Stub deck",
      date: "2026-05-01",
    },
    slides: [{ id: "title", render: () => null }],
  }),
  getAllDecks: () => [],
  getPublicDecks: () => [],
  getAllDeckEntries: () => [],
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
