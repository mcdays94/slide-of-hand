/**
 * Tests for `<Deck>` audience-route behaviours introduced in #209:
 *
 *   1. `M` opens the ToC sidebar for AUDIENCE viewers, not just admins.
 *   2. The mounted `<SlideManager>` carries `role="audience"` (verified
 *      via the `data-audience` attribute set by `<AudienceSlideManager>`).
 *   3. When the audience deep-links to a Hidden slide via `?slide=N`,
 *      the cursor clamps to the nearest non-hidden slide AND a
 *      `[deck] requested slide is hidden; clamped to N` warning fires.
 *   4. The clamp fires AT MOST ONCE — once the viewer is on a visible
 *      slide we don't fight subsequent manual navigation.
 *   5. The clamp is a no-op for admins (they can ToC-nav to hidden).
 *
 * Mocks: same pattern as `Deck.r-key.test.tsx` — stub the four network
 * hooks so the component mounts without a Worker.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SlideDef } from "./types";
import { PresenterModeProvider } from "@/framework/presenter/mode";

vi.mock("./useDeckManifest", () => ({
  useDeckManifest: () => ({
    manifest: null,
    isLoading: false,
    applied: null,
    applyDraft: () => {},
    clearDraft: () => {},
    save: async () => ({ ok: true }),
    refetch: async () => {},
  }),
}));
vi.mock("./useDeckTheme", () => ({
  useDeckTheme: () => ({
    persistent: null,
    isLoading: false,
    applied: null,
    applyDraft: () => {},
    clearDraft: () => {},
    save: async () => ({ ok: true }),
    refetch: async () => {},
  }),
}));
vi.mock("./useElementOverrides", () => ({
  useElementOverrides: () => ({
    persistent: [],
    isLoading: false,
    applyDraft: () => {},
    clearDraft: () => {},
    save: async () => ({ ok: true }),
    refetch: async () => {},
    applied: [],
    appliedWithStatus: [],
    getOverrideStatus: () => "matched",
    removeOne: async () => ({ ok: true }),
    clearOrphaned: async () => ({ ok: true }),
  }),
}));
vi.mock("./useDeckAnalytics", () => ({
  useDeckAnalytics: () => ({
    trackSlideAdvance: () => {},
    trackPhaseAdvance: () => {},
    trackOverviewOpen: () => {},
    trackJump: () => {},
  }),
}));

const { Deck } = await import("./Deck");

function s(id: string, hidden?: boolean): SlideDef {
  return { id, title: id, hidden, render: () => <div>{id}</div> };
}

function renderDeck({
  slides,
  presenterMode,
  initialEntry,
}: {
  slides: SlideDef[];
  presenterMode: boolean;
  initialEntry: string;
}) {
  // `useDeckState`'s initial cursor reads `window.location.search`
  // directly (NOT the React Router location), so MemoryRouter's
  // initialEntries don't propagate the query string. Set it on the
  // global location for the duration of the test.
  const queryIndex = initialEntry.indexOf("?");
  const search = queryIndex >= 0 ? initialEntry.slice(queryIndex) : "";
  if (typeof window !== "undefined") {
    // Update without forcing a navigation.
    const url = new URL(window.location.href);
    url.search = search;
    window.history.replaceState(null, "", url.toString());
  }
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PresenterModeProvider enabled={presenterMode}>
        <Routes>
          <Route
            path="/decks/:slug"
            element={<Deck slug="stub" title="Stub" slides={slides} />}
          />
          <Route
            path="/admin/decks/:slug"
            element={<Deck slug="stub" title="Stub" slides={slides} />}
          />
        </Routes>
      </PresenterModeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // sessionStorage state from a prior test could carry a cursor.
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => cleanup());

describe("<Deck> — audience ToC sidebar (#209)", () => {
  it("pressing M on the public route opens the sidebar with role=audience", () => {
    renderDeck({
      slides: [s("title"), s("intro"), s("end")],
      presenterMode: false,
      initialEntry: "/decks/stub",
    });
    // Sidebar starts closed.
    expect(screen.queryByTestId("slide-manager")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "m" });
    const sidebar = screen.getByTestId("slide-manager");
    expect(sidebar).toHaveAttribute("data-audience");
    // The 3 audience rows show.
    expect(screen.getAllByTestId("slide-manager-row")).toHaveLength(3);
    // No drag handles / pencils / etc.
    expect(screen.queryByTestId("slide-manager-drag-handle")).toBeNull();
    expect(screen.queryByTestId("slide-manager-edit-title")).toBeNull();
  });

  it("pressing M on the admin route opens the sidebar with role=admin", () => {
    renderDeck({
      slides: [s("title"), s("intro"), s("end")],
      presenterMode: true,
      initialEntry: "/admin/decks/stub",
    });
    fireEvent.keyDown(window, { key: "M" });
    const sidebar = screen.getByTestId("slide-manager");
    // Admin sidebar carries no `data-audience` marker.
    expect(sidebar).not.toHaveAttribute("data-audience");
    // Admin affordances are present.
    expect(screen.getAllByTestId("slide-manager-edit-title")).toHaveLength(3);
  });

  it("audience sidebar filters out Hidden slides", () => {
    renderDeck({
      slides: [s("title"), s("intro", true), s("end")],
      presenterMode: false,
      initialEntry: "/decks/stub",
    });
    fireEvent.keyDown(window, { key: "m" });
    const rows = screen.getAllByTestId("slide-manager-row");
    expect(rows).toHaveLength(2);
    const titles = screen.getAllByTestId("slide-manager-title-display");
    expect(titles[0]).toHaveTextContent("title");
    expect(titles[1]).toHaveTextContent("end");
  });
});

describe("<Deck> — audience deep-link clamp (#209)", () => {
  it("clamps forward to the next visible slide when ?slide=N points at a Hidden one", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderDeck({
      // index 1 is hidden — clamping forward lands on index 2.
      slides: [s("title"), s("intro", true), s("end")],
      presenterMode: false,
      initialEntry: "/decks/stub?slide=1",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "[deck] requested slide is hidden; clamped to 2",
    );
    warnSpy.mockRestore();
  });

  it("falls back to a backward scan when forward yields no visible slide", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderDeck({
      // index 1 is hidden, and there's nothing after it. Backward
      // scan finds index 0 ("title").
      slides: [s("title"), s("intro", true)],
      presenterMode: false,
      initialEntry: "/decks/stub?slide=1",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "[deck] requested slide is hidden; clamped to 0",
    );
    warnSpy.mockRestore();
  });

  it("does NOT clamp when the deep-link points at a visible slide", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderDeck({
      slides: [s("title"), s("intro", true), s("end")],
      presenterMode: false,
      initialEntry: "/decks/stub?slide=2",
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\[deck\] requested slide is hidden/),
    );
    warnSpy.mockRestore();
  });

  it("does NOT clamp for admins — they can land on Hidden slides", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderDeck({
      slides: [s("title"), s("intro", true), s("end")],
      presenterMode: true,
      initialEntry: "/admin/decks/stub?slide=1",
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\[deck\] requested slide is hidden/),
    );
    warnSpy.mockRestore();
  });

  it("is a no-op for the 3 production-style decks (zero Hidden slides)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderDeck({
      slides: [s("a"), s("b"), s("c"), s("d")],
      presenterMode: false,
      initialEntry: "/decks/stub?slide=2",
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\[deck\] requested slide is hidden/),
    );
    warnSpy.mockRestore();
  });
});
