/**
 * Tests for the public deck index page.
 *
 * Covers:
 *   - Sort order is `meta.date` descending
 *   - Empty state renders when no public decks are discovered
 *   - The page title is set to "Slide of Hand" on mount
 *   - Cards link to `/decks/<slug>`
 *   - Slice 5 (#61): merges KV-backed deck summaries with the build-time
 *     list, with build-time winning on slug collision.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Deck } from "@/framework/viewer/types";
import type { DataDeckSummary } from "@/lib/decks-registry";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

const stubSlide = { id: "stub", render: () => null };

const makeDeck = (
  slug: string,
  date: string,
  extra: Partial<Deck["meta"]> = {},
): Deck => ({
  meta: { slug, title: slug, description: `${slug} description.`, date, ...extra },
  slides: [stubSlide],
});

const summary = (
  slug: string,
  date: string,
  rest: Partial<DataDeckSummary> = {},
): DataDeckSummary => ({
  slug,
  title: rest.title ?? slug,
  description: rest.description,
  date,
  cover: rest.cover,
  visibility: rest.visibility ?? "public",
  runtimeMinutes: rest.runtimeMinutes,
});

function mockFetch(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => response,
  });
}

async function renderRoot(decks: Deck[], kvSummaries: DataDeckSummary[] = []) {
  vi.stubGlobal("fetch", mockFetch({ decks: kvSummaries }));
  vi.doMock("@/lib/decks-registry", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/decks-registry")
    >("@/lib/decks-registry");
    // We override `useDataDeckList` rather than `getPublicDeckMetas`
    // because the hook in the actual module would otherwise call its own
    // bound reference of `getPublicDeckMetas` (vi.doMock can't intercept
    // same-module calls). Delegate the merge logic to the real
    // `mergeDeckLists` so we still exercise the precedence + sort code path.
    return {
      ...actual,
      getPublicDeckMetas: () => decks.map((d) => d.meta),
      getAllDeckMetas: () => decks.map((d) => d.meta),
      getDeckMetaBySlug: (slug: string) =>
        decks.find((d) => d.meta.slug === slug)?.meta,
      hasBuildTimeDeck: (slug: string) =>
        decks.some((d) => d.meta.slug === slug),
      useDataDeckList: () => ({
        decks: actual.mergeDeckLists(
          decks.map((d) => d.meta),
          kvSummaries,
        ),
        isLoading: false,
      }),
    };
  });
  const mod = await import("./_root");
  const Root = mod.default;
  const utils = render(
    <MemoryRouter>
      <Root />
    </MemoryRouter>,
  );
  return utils;
}

describe("/ — public deck index", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders one card per public deck", async () => {
    await renderRoot([
      makeDeck("alpha", "2026-01-01"),
      makeDeck("beta", "2026-02-01"),
      makeDeck("gamma", "2026-03-01"),
    ]);
    expect(screen.getAllByTestId("deck-card")).toHaveLength(3);
  });

  it("sorts cards by date descending", async () => {
    await renderRoot([
      makeDeck("oldest", "2024-01-01"),
      makeDeck("newest", "2026-12-01"),
      makeDeck("middle", "2025-06-15"),
    ]);
    const cards = screen.getAllByTestId("deck-card");
    const slugs = cards.map((c) => c.getAttribute("href"));
    expect(slugs).toEqual([
      "/decks/newest",
      "/decks/middle",
      "/decks/oldest",
    ]);
  });

  it("renders an empty state when no public decks are discovered", async () => {
    await renderRoot([]);
    expect(
      screen.getByText(/no decks/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("deck-card")).toBeNull();
  });

  it('sets document.title to "Slide of Hand"', async () => {
    document.title = "Something else";
    await renderRoot([makeDeck("alpha", "2026-01-01")]);
    expect(document.title).toBe("Slide of Hand");
  });

  it("renders cards as links to /decks/<slug>", async () => {
    await renderRoot([
      makeDeck("alpha", "2026-01-01", {
        event: "Demo Day",
        runtimeMinutes: 15,
        tags: ["demo"],
      }),
    ]);
    const link = screen.getByRole("link", { name: /alpha/i });
    expect(link.getAttribute("href")).toBe("/decks/alpha");
  });

  it("renders a Studio link in the header pointing to /admin", async () => {
    await renderRoot([makeDeck("alpha", "2026-01-01")]);
    const adminLink = screen.getByTestId("admin-link");
    expect(adminLink.getAttribute("href")).toBe("/admin");
    expect(adminLink.textContent?.toLowerCase()).toContain("studio");
  });

  it("renders the Studio link even when no decks exist", async () => {
    await renderRoot([]);
    const adminLink = screen.getByTestId("admin-link");
    expect(adminLink.getAttribute("href")).toBe("/admin");
  });

  // ── Slice 5 (#61) — KV-backed deck merging ─────────────────────────────

  it("renders KV-backed deck cards alongside build-time cards", async () => {
    await renderRoot(
      [makeDeck("source", "2026-01-01")],
      [summary("kv-only", "2026-02-01", { title: "KV Only" })],
    );
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      const slugs = cards.map((c) => c.getAttribute("href"));
      expect(slugs).toContain("/decks/source");
      expect(slugs).toContain("/decks/kv-only");
    });
  });

  it("merges with date desc precedence (KV slot newest wins)", async () => {
    await renderRoot(
      [makeDeck("source-old", "2025-01-01")],
      [summary("kv-newer", "2026-12-01")],
    );
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      const slugs = cards.map((c) => c.getAttribute("href"));
      expect(slugs).toEqual(["/decks/kv-newer", "/decks/source-old"]);
    });
  });

  it("makes build-time win on slug collision (KV entry dropped)", async () => {
    await renderRoot(
      [
        makeDeck("shared", "2026-01-01", {
          title: "Build-time title",
          description: "build-time desc",
        }),
      ],
      [
        summary("shared", "2026-12-01", {
          title: "KV title",
          description: "kv desc",
        }),
      ],
    );
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      expect(cards).toHaveLength(1);
    });
    // The build-time title shows, not the KV title.
    expect(screen.getByText(/build-time title/i)).toBeTruthy();
    expect(screen.queryByText(/^KV title$/)).toBeNull();
  });

  it("falls back to build-time only when /api/decks fails", async () => {
    // Network failure → KV array empty, but build-time list still served.
    await renderRoot([makeDeck("source-only", "2026-01-01")], []);
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      expect(cards.map((c) => c.getAttribute("href"))).toEqual([
        "/decks/source-only",
      ]);
    });
  });

  it("does not list private KV summaries even if the worker returns them", async () => {
    await renderRoot(
      [],
      [
        summary("public-kv", "2026-01-01"),
        summary("private-kv", "2026-01-01", { visibility: "private" }),
      ],
    );
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      expect(cards.map((c) => c.getAttribute("href"))).toEqual([
        "/decks/public-kv",
      ]);
    });
  });

  // ── Slice 2 (#191) — draft filtering ───────────────────────────────────

  it("hides build-time decks with meta.draft === true", async () => {
    await renderRoot([
      makeDeck("published", "2026-02-01"),
      makeDeck("wip", "2026-03-01", { draft: true }),
    ]);
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      expect(cards.map((c) => c.getAttribute("href"))).toEqual([
        "/decks/published",
      ]);
    });
  });

  it("renders build-time decks with draft === false or undefined", async () => {
    await renderRoot([
      makeDeck("a-undef", "2026-02-01"),
      makeDeck("b-false", "2026-01-01", { draft: false }),
    ]);
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      const slugs = cards.map((c) => c.getAttribute("href"));
      expect(slugs.sort()).toEqual(["/decks/a-undef", "/decks/b-false"]);
    });
  });

  it("hides KV-backed decks with draft === true", async () => {
    await renderRoot(
      [],
      [
        summary("kv-published", "2026-02-01"),
        // `draft` is not in the basic `summary()` factory — extend inline.
        {
          ...summary("kv-draft", "2026-03-01"),
          draft: true,
        },
      ],
    );
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      expect(cards.map((c) => c.getAttribute("href"))).toEqual([
        "/decks/kv-published",
      ]);
    });
  });

  // ── Slice 1 (#243) — archived filtering ────────────────────────────────

  it("hides build-time decks with meta.archived === true", async () => {
    await renderRoot([
      makeDeck("active", "2026-02-01"),
      makeDeck("retired", "2026-03-01", { archived: true }),
    ]);
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      expect(cards.map((c) => c.getAttribute("href"))).toEqual([
        "/decks/active",
      ]);
    });
  });

  it("hides KV-backed decks with archived === true", async () => {
    await renderRoot(
      [],
      [
        summary("kv-active", "2026-02-01"),
        {
          ...summary("kv-retired", "2026-03-01"),
          archived: true,
        },
      ],
    );
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      expect(cards.map((c) => c.getAttribute("href"))).toEqual([
        "/decks/kv-active",
      ]);
    });
  });

  it("hides decks that are both draft AND archived (archived wins)", async () => {
    await renderRoot(
      [makeDeck("both", "2026-03-01", { draft: true, archived: true })],
      [
        {
          ...summary("kv-both", "2026-03-01"),
          draft: true,
          archived: true,
        },
        summary("kv-active", "2026-02-01"),
      ],
    );
    await waitFor(() => {
      const cards = screen.getAllByTestId("deck-card");
      expect(cards.map((c) => c.getAttribute("href"))).toEqual([
        "/decks/kv-active",
      ]);
    });
  });
});
