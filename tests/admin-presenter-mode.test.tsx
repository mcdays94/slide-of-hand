/**
 * Verifies the cross-slice wiring contract for `presenterMode`. Originally
 * (slices #5–7) the admin route enabled presenter mode and the public
 * route did not. Then (2026-05-10) the public route was opened up so
 * tools worked globally, by setting `enabled={true}` unconditionally.
 * Then (2026-05-11) that was identified as a security exposure: it
 * leaked all admin chrome (Theme / Inspect / Analytics / AI buttons,
 * admin-only Settings rows, P-key presenter trigger) to anyone hitting
 * the public `/decks/<slug>` URL.
 *
 * Current contract:
 *   - Admin route — `enabled={true}` always. Access at the edge already
 *     gates the route; everyone reaching here is authenticated.
 *   - Public route — `enabled={authStatus === "authenticated"}`. Audience
 *     members get the viewer-only chrome; admins previewing on the public
 *     URL still get their tooling because `useAccessAuth()` resolves to
 *     "authenticated".
 *
 * Tests below pin all three cases against a mocked `useAccessAuth`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { usePresenterMode } from "@/framework/presenter/mode";

let lastObserved: boolean | null = null;

const useAccessAuthMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/use-access-auth", () => ({
  useAccessAuth: useAccessAuthMock,
}));

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

beforeEach(() => {
  // Reset to a known default before each test. Each test overrides as
  // needed to exercise the auth-state branches.
  useAccessAuthMock.mockReturnValue("authenticated");
});

describe("PresenterMode wiring across viewer routes", () => {
  it("admin viewer at /admin/decks/<slug> activates presenter mode unconditionally", () => {
    // The admin route is Access-gated at the edge — by the time we get
    // here, authentication is already established. The route hard-
    // codes `enabled={true}` (no `useAccessAuth` dependency).
    render(
      <MemoryRouter initialEntries={["/admin/decks/stub"]}>
        <Routes>
          <Route path="/admin/decks/:slug" element={<AdminDeckRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(lastObserved).toBe(true);
  });

  it("public viewer at /decks/<slug> activates presenter mode WHEN the visitor is authenticated", () => {
    // Admin previewing their own deck on the public URL → useAccessAuth
    // resolves to "authenticated" → admin chrome stays available.
    useAccessAuthMock.mockReturnValue("authenticated");
    render(
      <MemoryRouter initialEntries={["/decks/stub"]}>
        <Routes>
          <Route path="/decks/:slug" element={<PublicDeckRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(lastObserved).toBe(true);
  });

  it("public viewer at /decks/<slug> DEACTIVATES presenter mode for unauthenticated visitors (security)", () => {
    // The audience case. No Access session → useAccessAuth resolves to
    // "unauthenticated" → presenterMode is false → no admin chrome
    // leaks. This is the regression we explicitly guard against.
    useAccessAuthMock.mockReturnValue("unauthenticated");
    render(
      <MemoryRouter initialEntries={["/decks/stub"]}>
        <Routes>
          <Route path="/decks/:slug" element={<PublicDeckRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(lastObserved).toBe(false);
  });

  it("public viewer at /decks/<slug> DEACTIVATES presenter mode during the initial 'checking' probe", () => {
    // While the auth probe is in flight we treat the visitor as not-
    // yet-authenticated. Avoids flashing admin chrome to a non-Access
    // visitor for the brief window before the probe resolves.
    useAccessAuthMock.mockReturnValue("checking");
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
