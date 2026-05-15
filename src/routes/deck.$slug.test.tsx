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
import type { ReactNode } from "react";
import type { Deck } from "@/framework/viewer/types";
import type { DataDeck as DataDeckRecord } from "@/lib/deck-record";

// `useAccessAuth` and `PresenterModeProvider` are now load-bearing for
// the route's security model — the provider's `enabled` is driven by
// the hook's result. Mock both at file root so:
//   - existing tests still pass (the PresenterModeProvider mock is a
//     passthrough that renders its children, so the stub Deck /
//     DataDeck assertions are unaffected);
//   - new tests below can flip `useAccessAuth`'s return value to
//     verify the `enabled` prop tracks auth status.
const useAccessAuthMock = vi.hoisted(() => vi.fn());
const presenterModeProviderMock = vi.hoisted(() =>
  vi.fn(({ children }: { children: ReactNode; enabled: boolean }) => children),
);

vi.mock("@/lib/use-access-auth", () => ({
  useAccessAuth: useAccessAuthMock,
}));

vi.mock("@/framework/presenter/mode", async () => {
  const actual = await vi.importActual<
    typeof import("@/framework/presenter/mode")
  >("@/framework/presenter/mode");
  return {
    ...actual,
    PresenterModeProvider: presenterModeProviderMock,
  };
});

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
  // Default to "authenticated" so existing tests (which don't care
  // about the auth-gate logic) see the full admin chrome wired up.
  // The new "PresenterModeProvider auth wiring" describe overrides
  // per-test to exercise the other states.
  useAccessAuthMock.mockReturnValue("authenticated");
  presenterModeProviderMock.mockClear();
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

const archivedSourceDeck: Deck = {
  meta: {
    slug: "retired-talk",
    title: "Retired Talk",
    description: "from build-time, archived",
    date: "2024-04-01",
    archived: true,
  },
  slides: [stubSlide],
};

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

  // Issue #243 — archived source decks 404 on the public route. The
  // build-time registry tags them with `meta.archived = true`; the
  // route checks the meta synchronously and renders <NotFound>
  // without loading the deck's chunk.
  it("returns 404 for an archived build-time source deck", async () => {
    vi.doMock(
      "@/lib/decks-registry",
      makeRegistryMock({ "retired-talk": archivedSourceDeck }),
    );
    await renderRouteAt("retired-talk");
    expect(screen.getByText(/no deck called/i)).toBeTruthy();
    // The source-deck stub MUST NOT render — the archived gate fires
    // before the lazy load.
    expect(screen.queryByTestId("source-deck-stub")).toBeNull();
  });

  // Issue #243 — archived KV-backed decks come back from
  // `/api/decks/<slug>` as 404 (the worker filters them on the public
  // read endpoint). The route surfaces this as the normal 404 page.
  it("returns 404 for an archived KV-backed deck (worker responds 404)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: false, body: { error: "not found" } }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));
    await renderRouteAt("retired-kv-deck");
    await waitFor(() =>
      expect(screen.getByText(/no deck called/i)).toBeTruthy(),
    );
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

// Security: the public `/decks/<slug>` route used to wrap the viewer in
// `<PresenterModeProvider enabled={true}>` unconditionally, exposing
// the admin chrome (Theme / Inspect / Analytics / AI buttons, Settings
// rows for AI model / GitHub / speaker-notes mode / deck-card hover,
// the P-key presenter trigger) to anyone hitting the URL. The fix
// drives `enabled` from `useAccessAuth()` so unauthenticated visitors
// get the audience view and authenticated admins still see their
// tooling when previewing on the public URL.
describe("/decks/<slug> — PresenterModeProvider auth wiring (security)", () => {
  it("passes enabled=true to PresenterModeProvider for a build-time deck when the visitor is authenticated", async () => {
    useAccessAuthMock.mockReturnValue("authenticated");
    vi.doMock(
      "@/lib/decks-registry",
      makeRegistryMock({ "source-deck": sourceDeck }),
    );
    await renderRouteAt("source-deck");
    // The provider may be invoked more than once during render; the
    // SECURITY-RELEVANT invocation is the one wrapping the deck stub.
    // Filter to calls that actually rendered children (i.e. were the
    // wrap call, not React's internal probing).
    expect(presenterModeProviderMock).toHaveBeenCalled();
    const lastCall =
      presenterModeProviderMock.mock.calls[
        presenterModeProviderMock.mock.calls.length - 1
      ];
    expect(lastCall[0]).toMatchObject({ enabled: true });
  });

  it("passes enabled=false to PresenterModeProvider for a build-time deck when the visitor is unauthenticated", async () => {
    useAccessAuthMock.mockReturnValue("unauthenticated");
    vi.doMock(
      "@/lib/decks-registry",
      makeRegistryMock({ "source-deck": sourceDeck }),
    );
    await renderRouteAt("source-deck");
    expect(presenterModeProviderMock).toHaveBeenCalled();
    const lastCall =
      presenterModeProviderMock.mock.calls[
        presenterModeProviderMock.mock.calls.length - 1
      ];
    expect(lastCall[0]).toMatchObject({ enabled: false });
  });

  it("passes enabled=false during the initial 'checking' probe (conservative — no admin-UI flash)", async () => {
    // Before the auth probe resolves the route mounts in `checking`
    // state. Treat that as not-yet-authenticated so admin chrome
    // never flashes for non-Access visitors.
    useAccessAuthMock.mockReturnValue("checking");
    vi.doMock(
      "@/lib/decks-registry",
      makeRegistryMock({ "source-deck": sourceDeck }),
    );
    await renderRouteAt("source-deck");
    expect(presenterModeProviderMock).toHaveBeenCalled();
    const lastCall =
      presenterModeProviderMock.mock.calls[
        presenterModeProviderMock.mock.calls.length - 1
      ];
    expect(lastCall[0]).toMatchObject({ enabled: false });
  });

  it("passes enabled=true to PresenterModeProvider for a KV-backed deck when authenticated", async () => {
    useAccessAuthMock.mockReturnValue("authenticated");
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: true, body: dataDeckRecord }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));
    await renderRouteAt("kv-deck");
    await waitFor(() =>
      expect(screen.queryByTestId("data-deck-stub")).toBeTruthy(),
    );
    expect(presenterModeProviderMock).toHaveBeenCalled();
    const lastCall =
      presenterModeProviderMock.mock.calls[
        presenterModeProviderMock.mock.calls.length - 1
      ];
    expect(lastCall[0]).toMatchObject({ enabled: true });
  });

  it("passes enabled=false to PresenterModeProvider for a KV-backed deck when unauthenticated", async () => {
    useAccessAuthMock.mockReturnValue("unauthenticated");
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: true, body: dataDeckRecord }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));
    await renderRouteAt("kv-deck");
    await waitFor(() =>
      expect(screen.queryByTestId("data-deck-stub")).toBeTruthy(),
    );
    expect(presenterModeProviderMock).toHaveBeenCalled();
    const lastCall =
      presenterModeProviderMock.mock.calls[
        presenterModeProviderMock.mock.calls.length - 1
      ];
    expect(lastCall[0]).toMatchObject({ enabled: false });
  });
});
