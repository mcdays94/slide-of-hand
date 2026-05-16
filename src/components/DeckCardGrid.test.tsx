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
import { SettingsProvider } from "@/framework/viewer/useSettings";
import { STORAGE_KEY, type Settings } from "@/lib/settings";

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

  it("renders a lifecycle menu trigger only on items where canDelete=true (when no other lifecycle callbacks)", () => {
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
    // Source row: no lifecycle wiring at all → no trigger.
    expect(
      screen.queryByTestId("lifecycle-menu-trigger-source-deck"),
    ).toBeNull();
    // KV row: delete is wired → trigger present, Delete inside.
    expect(screen.getByTestId("lifecycle-menu-trigger-kv-deck")).toBeDefined();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    expect(screen.getByTestId("lifecycle-menu-delete-kv-deck")).toBeDefined();
  });

  it("does NOT render any lifecycle menu when no lifecycle callbacks are provided (public surface)", () => {
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="public"
          items={[item("kv-deck", "KV", { canDelete: true })]}
        />
      </MemoryRouter>,
    );
    expect(
      screen.queryByTestId("lifecycle-menu-trigger-kv-deck"),
    ).toBeNull();
  });

  it("invokes onDelete with the slug after the user types it and confirms", async () => {
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
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-delete-kv-deck"));
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "kv-deck" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("kv-deck"));
  });

  it("renders Archive menu item only on active items where canArchive=true", () => {
    const onArchive = vi.fn();
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="admin"
          items={[
            item("source-deck", "Source", { canArchive: false }),
            item("archivable", "Archivable", { canArchive: true }),
          ]}
          onArchive={onArchive}
        />
      </MemoryRouter>,
    );
    // Non-archivable: no trigger at all.
    expect(
      screen.queryByTestId("lifecycle-menu-trigger-source-deck"),
    ).toBeNull();
    // Archivable: menu trigger present with Archive item.
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-archivable"));
    expect(
      screen.getByTestId("lifecycle-menu-archive-archivable"),
    ).toBeDefined();
  });

  it("renders Restore menu item only on archived items where canRestore=true", () => {
    const onRestore = vi.fn();
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="admin"
          items={[
            // Active deck with canRestore=true should NOT render Restore;
            // restore only applies to archived lifecycle.
            item("active-with-restore", "Active", { canRestore: true }),
            // Archived deck with canRestore=true should render Restore.
            {
              meta: {
                slug: "archived-restorable",
                title: "Archived Restorable",
                description: "x",
                date: "2026-04-01",
                archived: true,
              },
              to: "/decks/archived-restorable",
              canRestore: true,
            },
          ]}
          onRestore={onRestore}
        />
      </MemoryRouter>,
    );
    // Active row: no menu (no Archive cb wired, restore doesn't apply).
    expect(
      screen.queryByTestId("lifecycle-menu-trigger-active-with-restore"),
    ).toBeNull();
    // Archived row: Restore visible inside the menu.
    fireEvent.click(
      screen.getByTestId("lifecycle-menu-trigger-archived-restorable"),
    );
    expect(
      screen.getByTestId("lifecycle-menu-restore-archived-restorable"),
    ).toBeDefined();
  });

  it("invokes onArchive with the slug after the user confirms the archive dialog", async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <DeckCardGrid
          surface="admin"
          items={[
            item("kv-deck", "KV Deck", { canArchive: true }),
          ]}
          onArchive={onArchive}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-kv-deck"));
    // Archive uses a simple ConfirmDialog (no typed-slug input).
    expect(screen.queryByTestId("typed-slug-input")).toBeNull();
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith("kv-deck"));
  });

  describe("hover preview animation (issue #128)", () => {
    /** Pre-seed localStorage with a partial Settings blob. */
    function seedSettings(partial: Partial<Settings>) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
    }

    it("renders preload <img> tags for each card by default (enabled=true, slideCount=3)", () => {
      // Default settings → enabled, slideCount=3 → 2 preloads per card (slides 02, 03).
      render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid
              surface="public"
              items={[item("a", "Alpha"), item("b", "Bravo")]}
            />
          </SettingsProvider>
        </MemoryRouter>,
      );
      // 2 cards × 2 preloads each = 4 preload images.
      expect(
        document.querySelectorAll("[data-hover-preload]").length,
      ).toBe(4);
    });

    it("threads the slideCount setting through to each card's preload count", () => {
      seedSettings({
        deckCardHoverAnimation: { enabled: true, slideCount: 6 },
      });
      render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid surface="public" items={[item("a", "Alpha")]} />
          </SettingsProvider>
        </MemoryRouter>,
      );
      // slideCount=6 → 5 preloads (02..06) on the single card.
      expect(
        document.querySelectorAll("[data-hover-preload]").length,
      ).toBe(5);
    });

    it("does NOT render any preloads when the setting is disabled", () => {
      seedSettings({
        deckCardHoverAnimation: { enabled: false, slideCount: 6 },
      });
      render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid
              surface="public"
              items={[item("a", "Alpha"), item("b", "Bravo")]}
            />
          </SettingsProvider>
        </MemoryRouter>,
      );
      expect(
        document.querySelectorAll("[data-hover-preload]").length,
      ).toBe(0);
    });

    it("does NOT render preloads in list view, even when the setting is enabled", () => {
      window.localStorage.setItem(
        "slide-of-hand:view-preference:public",
        "list",
      );
      seedSettings({
        deckCardHoverAnimation: { enabled: true, slideCount: 5 },
      });
      render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid surface="public" items={[item("a", "Alpha")]} />
          </SettingsProvider>
        </MemoryRouter>,
      );
      expect(
        document.querySelectorAll("[data-hover-preload]").length,
      ).toBe(0);
    });

    it("affects both surfaces (public and admin) since the setting is global", () => {
      seedSettings({
        deckCardHoverAnimation: { enabled: true, slideCount: 4 },
      });
      const { unmount } = render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid surface="public" items={[item("a", "Alpha")]} />
          </SettingsProvider>
        </MemoryRouter>,
      );
      // Public surface: slideCount=4 → 3 preloads.
      expect(
        document.querySelectorAll("[data-hover-preload]").length,
      ).toBe(3);
      unmount();
      cleanup();

      render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid surface="admin" items={[item("a", "Alpha")]} />
          </SettingsProvider>
        </MemoryRouter>,
      );
      // Admin surface: same global setting, same preload count.
      expect(
        document.querySelectorAll("[data-hover-preload]").length,
      ).toBe(3);
    });
  });

  describe("visibility toggle wiring (issue #214)", () => {
    /**
     * The grid threads `onToggleVisibility` through to each card,
     * gated by the per-item `canToggleVisibility` flag (so source-
     * backed admin rows don't get an enabled toggle).
     *
     * Public surface MUST NEVER render the toggle — the homepage has
     * no admin authority and the audience must never see a control
     * that promises to mutate the deck.
     */
    it("renders an enabled visibility toggle on KV-backed admin items when onToggleVisibility is wired", () => {
      const onToggleVisibility = vi.fn();
      render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid
              surface="admin"
              items={[
                item("kv-a", "KV A", {
                  visibility: "public",
                  canToggleVisibility: true,
                }),
              ]}
              onToggleVisibility={onToggleVisibility}
            />
          </SettingsProvider>
        </MemoryRouter>,
      );
      expect(screen.getByTestId("deck-visibility-toggle-kv-a")).toBeDefined();
    });

    it("does NOT render the toggle on source-backed admin items (canToggleVisibility=false)", () => {
      const onToggleVisibility = vi.fn();
      render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid
              surface="admin"
              items={[
                item("src-deck", "Source Deck", {
                  visibility: "public",
                  canToggleVisibility: false,
                }),
              ]}
              onToggleVisibility={onToggleVisibility}
            />
          </SettingsProvider>
        </MemoryRouter>,
      );
      expect(
        screen.queryByTestId("deck-visibility-toggle-src-deck"),
      ).toBeNull();
    });

    it("public surface never renders the toggle even when items declare canToggleVisibility=true", () => {
      // The public DeckCardGrid never receives `onToggleVisibility`,
      // so the toggle stays off regardless of per-item flags.
      render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid
              surface="public"
              items={[
                item("kv-a", "KV A", {
                  visibility: "public",
                  canToggleVisibility: true,
                }),
              ]}
            />
          </SettingsProvider>
        </MemoryRouter>,
      );
      expect(
        screen.queryByTestId("deck-visibility-toggle-kv-a"),
      ).toBeNull();
    });

    it("clicking the toggle invokes the grid-level handler with (slug, next)", async () => {
      const onToggleVisibility = vi.fn().mockResolvedValue(undefined);
      render(
        <MemoryRouter>
          <SettingsProvider>
            <DeckCardGrid
              surface="admin"
              items={[
                item("kv-a", "KV A", {
                  visibility: "private",
                  canToggleVisibility: true,
                }),
              ]}
              onToggleVisibility={onToggleVisibility}
            />
          </SettingsProvider>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByTestId("deck-visibility-toggle-kv-a"));
      await waitFor(() =>
        expect(onToggleVisibility).toHaveBeenCalledWith("kv-a", "public"),
      );
    });
  });
});
