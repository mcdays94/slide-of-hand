/**
 * Tests for `/admin/decks/<slug>` — the admin deck viewer.
 *
 * Issue #243 (PRD #242, slice 1) — read-only preview for archived
 * decks. Two paths:
 *
 *   1. Source archived deck → registry tags `meta.archived = true`.
 *      The route mounts `<Deck>` wrapped in a non-active
 *      `<PresenterModeProvider>` and overlays the archived banner.
 *      `?edit=1` is ignored (EditMode is for KV only; build-time
 *      decks are never editable here).
 *   2. KV archived deck → `useAdminDataDeck` returns a record with
 *      `meta.archived === true`. The route mounts `<DataDeck>` in a
 *      non-active provider with the banner. `?edit=1` is ignored —
 *      no EditMode for archived decks.
 *
 * The active (non-archived) paths are not exercised here in full —
 * they're covered indirectly by the unit tests on the registry +
 * EditMode. Focus is on the read-only signal for archived.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import type { Deck } from "@/framework/viewer/types";
import type { DataDeck as DataDeckRecord } from "@/lib/deck-record";

// Use Access auth gate as authenticated so the inner route mounts.
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

const archivedSourceDeck: Deck = {
  meta: {
    slug: "retired-source",
    title: "Retired Source",
    description: "from build-time",
    date: "2024-04-01",
    archived: true,
  },
  slides: [stubSlide],
};

const activeSourceDeck: Deck = {
  meta: {
    slug: "active-source",
    title: "Active Source",
    date: "2026-04-01",
  },
  slides: [stubSlide],
};

const archivedKvDeck: DataDeckRecord = {
  meta: {
    slug: "retired-kv",
    title: "Retired KV",
    date: "2024-04-02",
    visibility: "public",
    archived: true,
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
  Deck: ({ slug }: { slug: string }) => (
    <div data-testid="source-deck-stub" data-slug={slug}>
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

// EditMode stub: when this renders, we know the route mounted the
// authoring path (which must NEVER happen for archived decks).
vi.mock("@/framework/editor/EditMode", () => ({
  EditMode: ({ slug }: { slug: string }) => (
    <div data-testid="edit-mode-stub" data-slug={slug}>
      edit mode
    </div>
  ),
}));

vi.mock("@/framework/presenter/PresenterWindow", () => ({
  PresenterWindow: ({ deck }: { deck: Deck }) => (
    <div data-testid="presenter-window-stub" data-slug={deck.meta.slug}>
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
  useAccessAuthMock.mockReturnValue("authenticated");
  presenterModeProviderMock.mockClear();
});

function mockFetchSequence(
  responses: Array<{ ok: boolean; body: unknown }>,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn();
  for (const r of responses) {
    mock.mockResolvedValueOnce({ ok: r.ok, json: async () => r.body });
  }
  return mock;
}

async function renderRouteAt(slug: string, queryString = "") {
  const mod = await import("./decks.$slug");
  const AdminDeckRoute = mod.default;
  const initialEntry = `/admin/decks/${slug}${queryString}`;
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/decks/:slug" element={<AdminDeckRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeRegistryMock(buildTimeDecks: Record<string, Deck>) {
  return async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/decks-registry")
    >("@/lib/decks-registry");
    return {
      ...actual,
      hasBuildTimeDeck: (slug: string) => Boolean(buildTimeDecks[slug]),
      getDeckResource: (slug: string) => ({
        read: () => buildTimeDecks[slug],
      }),
      getDeckMetaBySlug: (slug: string) => buildTimeDecks[slug]?.meta,
    };
  };
}

describe("/admin/decks/<slug> — archived read-only preview (#243)", () => {
  it("renders the archived banner for an archived source deck", async () => {
    vi.doMock(
      "@/lib/decks-registry",
      makeRegistryMock({ "retired-source": archivedSourceDeck }),
    );
    await renderRouteAt("retired-source");
    expect(screen.getByTestId("admin-archived-banner")).toBeDefined();
    // The deck still renders (admin can preview).
    expect(screen.getByTestId("source-deck-stub")).toBeDefined();
  });

  it("disables presenter mode for an archived source deck", async () => {
    vi.doMock(
      "@/lib/decks-registry",
      makeRegistryMock({ "retired-source": archivedSourceDeck }),
    );
    await renderRouteAt("retired-source");
    // The provider receives enabled=false so admin chrome (Theme /
    // Inspect / AI / etc.) is suppressed.
    const lastCall =
      presenterModeProviderMock.mock.calls[
        presenterModeProviderMock.mock.calls.length - 1
      ];
    expect(lastCall[0]).toMatchObject({ enabled: false });
  });

  it("does NOT render the banner for an active source deck", async () => {
    vi.doMock(
      "@/lib/decks-registry",
      makeRegistryMock({ "active-source": activeSourceDeck }),
    );
    await renderRouteAt("active-source");
    expect(screen.queryByTestId("admin-archived-banner")).toBeNull();
    // Active decks still mount with enabled=true.
    const lastCall =
      presenterModeProviderMock.mock.calls[
        presenterModeProviderMock.mock.calls.length - 1
      ];
    expect(lastCall[0]).toMatchObject({ enabled: true });
  });

  it("renders the archived banner for an archived KV deck", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: true, body: archivedKvDeck }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));
    await renderRouteAt("retired-kv");
    await waitFor(() =>
      expect(screen.queryByTestId("data-deck-stub")).toBeTruthy(),
    );
    expect(screen.getByTestId("admin-archived-banner")).toBeDefined();
  });

  it("disables presenter mode for an archived KV deck", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: true, body: archivedKvDeck }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));
    await renderRouteAt("retired-kv");
    await waitFor(() =>
      expect(screen.queryByTestId("data-deck-stub")).toBeTruthy(),
    );
    const lastCall =
      presenterModeProviderMock.mock.calls[
        presenterModeProviderMock.mock.calls.length - 1
      ];
    expect(lastCall[0]).toMatchObject({ enabled: false });
  });

  it("does NOT mount EditMode for archived KV decks even with ?edit=1", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: true, body: archivedKvDeck }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));
    await renderRouteAt("retired-kv", "?edit=1");
    await waitFor(() =>
      expect(screen.queryByTestId("data-deck-stub")).toBeTruthy(),
    );
    // EditMode must NOT mount — the read model says no authoring
    // controls until restored. The banner is the read-only signal.
    expect(screen.queryByTestId("edit-mode-stub")).toBeNull();
    expect(screen.getByTestId("admin-archived-banner")).toBeDefined();
  });

  it("does NOT enter presenter mode for archived KV decks even with ?presenter=1", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ ok: true, body: archivedKvDeck }]),
    );
    vi.doMock("@/lib/decks-registry", makeRegistryMock({}));
    await renderRouteAt("retired-kv", "?presenter=1");
    await waitFor(() =>
      expect(screen.queryByTestId("data-deck-stub")).toBeTruthy(),
    );
    expect(screen.queryByTestId("presenter-window-stub")).toBeNull();
    expect(screen.getByTestId("admin-archived-banner")).toBeDefined();
  });
});
