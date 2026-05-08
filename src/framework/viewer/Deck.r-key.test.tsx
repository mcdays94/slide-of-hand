/**
 * Tests for the `R`-key edit-mode toggle in `<Deck>` (Slice 6 / #62).
 *
 * Behaviour contract:
 *   1. `R` (and `r`) on `/admin/decks/<slug>` toggles `?edit=1` on the URL.
 *   2. The same key on `/decks/<slug>` (public viewer) does NOTHING — no
 *      navigation, no URL change.
 *   3. Pressing `R` while `?edit=1` is already set REMOVES the param.
 *
 * `<Deck>` has many fetch-driven hooks (manifest, theme, overrides,
 * analytics). We stub them with empty defaults to keep the test
 * focused on the keyboard handler. The R-key path is a pure URL
 * transformation — it only depends on `useLocation` and `useNavigate`.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type { SlideDef } from "./types";

// Stub all the network-driven hooks that <Deck> mounts so we can
// exercise just the R-key without setting up a Worker.
vi.mock("./useDeckManifest", () => ({
  useDeckManifest: () => ({
    manifest: null,
    isLoading: false,
    // null = source default order; <Deck> calls `mergeSlides(slides, null)`
    // and gets the source slides back unchanged.
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

const slides: SlideDef[] = [
  {
    id: "title",
    title: "Title",
    render: () => <div>title slide</div>,
  },
];

function PathWitness() {
  const location = useLocation();
  return (
    <div data-testid="path">{location.pathname + location.search}</div>
  );
}

function renderAt(initialEntry: string, routePath: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path={routePath}
          element={
            <>
              <PathWitness />
              <Deck slug="stub" title="Stub" slides={slides} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // Silence localStorage setItem failures in some happy-dom configs.
});

afterEach(() => cleanup());

describe("<Deck> — R key edit-mode toggle", () => {
  it("on /admin/decks/<slug>, pressing R adds ?edit=1", () => {
    renderAt("/admin/decks/stub", "/admin/decks/:slug");
    expect(screen.getByTestId("path").textContent).toBe(
      "/admin/decks/stub",
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByTestId("path").textContent).toBe(
      "/admin/decks/stub?edit=1",
    );
  });

  it("uppercase R also toggles", () => {
    renderAt("/admin/decks/stub", "/admin/decks/:slug");
    fireEvent.keyDown(window, { key: "R" });
    expect(screen.getByTestId("path").textContent).toBe(
      "/admin/decks/stub?edit=1",
    );
  });

  it("R again removes ?edit=1", () => {
    renderAt("/admin/decks/stub?edit=1", "/admin/decks/:slug");
    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByTestId("path").textContent).toBe(
      "/admin/decks/stub",
    );
  });

  it("on /decks/<slug> (public), R does nothing", () => {
    renderAt("/decks/stub", "/decks/:slug");
    const before = screen.getByTestId("path").textContent;
    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByTestId("path").textContent).toBe(before);
  });
});
