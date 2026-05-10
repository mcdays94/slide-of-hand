/**
 * Tests for `<DeckCardGrid>` (issue #127).
 *
 * The grid is the unified renderer for both the public homepage (`/`) and
 * the Studio admin index (`/admin`). It composes `<DeckCard>` for each
 * item and exposes a Grid/List segmented control above the list. The
 * chosen view mode is persisted per-surface via `useViewPreference`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DeckCardGrid, type DeckCardGridItem } from "./DeckCardGrid";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  cleanup();
});

const item = (
  slug: string,
  title: string,
  overrides: Partial<DeckCardGridItem> = {},
): DeckCardGridItem => ({
  meta: {
    slug,
    title,
    description: `${title} description`,
    date: "2026-04-01",
  },
  to: `/decks/${slug}`,
  ...overrides,
});

describe("DeckCardGrid", () => {
  it("renders an empty-state slot when items is empty", () => {
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="public"
          items={[]}
          emptyState={
            <p data-testid="grid-empty">No decks discovered yet.</p>
          }
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("grid-empty")).toBeDefined();
  });

  it("renders one card per item", () => {
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="public"
          items={[item("a", "Alpha"), item("b", "Bravo")]}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId("deck-card")).toHaveLength(2);
    expect(screen.getByText("Alpha")).toBeDefined();
    expect(screen.getByText("Bravo")).toBeDefined();
  });

  it('starts in grid view by default and exposes data-view="grid" on cards', () => {
    render(
      <MemoryRouter>
        <DeckCardGrid surface="public" items={[item("a", "Alpha")]} />
      </MemoryRouter>,
    );
    const card = screen.getByTestId("deck-card");
    expect(card.getAttribute("data-view")).toBe("grid");
  });

  it("exposes a Grid/List segmented control", () => {
    render(
      <MemoryRouter>
        <DeckCardGrid surface="public" items={[item("a", "Alpha")]} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("view-mode-grid")).toBeDefined();
    expect(screen.getByTestId("view-mode-list")).toBeDefined();
  });

  it("clicking the List control switches all cards to list view", () => {
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="public"
          items={[item("a", "Alpha"), item("b", "Bravo")]}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("view-mode-list"));
    for (const card of screen.getAllByTestId("deck-card")) {
      expect(card.getAttribute("data-view")).toBe("list");
    }
  });

  it("clicking List persists the choice to localStorage under the surface key", () => {
    render(
      <MemoryRouter>
        <DeckCardGrid surface="public" items={[item("a", "Alpha")]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("view-mode-list"));
    expect(
      window.localStorage.getItem("slide-of-hand:view-preference:public"),
    ).toBe("list");
  });

  it("hydrates from a pre-existing public preference", () => {
    window.localStorage.setItem(
      "slide-of-hand:view-preference:public",
      "list",
    );
    render(
      <MemoryRouter>
        <DeckCardGrid surface="public" items={[item("a", "Alpha")]} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("deck-card").getAttribute("data-view")).toBe(
      "list",
    );
  });

  it("scopes preferences per surface — admin and public are independent", () => {
    window.localStorage.setItem(
      "slide-of-hand:view-preference:admin",
      "list",
    );
    render(
      <MemoryRouter>
        <DeckCardGrid surface="admin" items={[item("a", "Alpha")]} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("deck-card").getAttribute("data-view")).toBe(
      "list",
    );
  });

  it("forwards visibility from the item to the card", () => {
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="admin"
          items={[item("a", "Alpha", { visibility: "private" })]}
        />
      </MemoryRouter>,
    );
    expect(document.querySelector("[data-visibility='private']")).not.toBeNull();
  });

  it("forwards ideHref from the item to the card", () => {
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="admin"
          items={[item("a", "Alpha", { ideHref: "vscode://example" })]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("open-in-ide").getAttribute("href")).toBe(
      "vscode://example",
    );
  });

  it("renders a trashcan only on items where canDelete=true", () => {
    const onDelete = vi.fn();
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="admin"
          items={[
            item("source-deck", "Source", { canDelete: false }),
            item("kv-deck", "KV", { canDelete: true }),
          ]}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("delete-deck-source-deck")).toBeNull();
    expect(screen.getByTestId("delete-deck-kv-deck")).toBeDefined();
  });

  it("does NOT render any trashcan when onDelete prop is omitted (public surface)", () => {
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="public"
          items={[item("kv-deck", "KV", { canDelete: true })]}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("delete-deck-kv-deck")).toBeNull();
  });

  it("invokes onDelete with the slug when the user confirms", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="admin"
          items={[item("kv-deck", "KV", { canDelete: true })]}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("delete-deck-kv-deck"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("kv-deck"));
  });
});
