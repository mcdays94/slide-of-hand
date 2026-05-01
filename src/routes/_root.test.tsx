/**
 * Tests for the public deck index page.
 *
 * Covers:
 *   - Sort order is `meta.date` descending
 *   - Empty state renders when no public decks are discovered
 *   - The page title is set to "ReAction" on mount
 *   - Cards link to `/decks/<slug>`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Deck } from "@/framework/viewer/types";

afterEach(() => {
  cleanup();
  vi.resetModules();
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

async function renderRoot(decks: Deck[]) {
  vi.doMock("@/lib/decks-registry", () => ({
    getPublicDecks: () => decks,
    getAllDecks: () => decks,
    getDeckBySlug: (slug: string) =>
      decks.find((d) => d.meta.slug === slug),
  }));
  const mod = await import("./_root");
  const Root = mod.default;
  return render(
    <MemoryRouter>
      <Root />
    </MemoryRouter>,
  );
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

  it('sets document.title to "ReAction"', async () => {
    document.title = "Something else";
    await renderRoot([makeDeck("alpha", "2026-01-01")]);
    expect(document.title).toBe("ReAction");
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
});
