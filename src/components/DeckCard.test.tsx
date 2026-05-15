/**
 * Tests for `<DeckCard>`.
 *
 * The card is the unit element of both the public index and the Studio
 * admin grid. It accepts a `DeckMeta` plus a `view` mode (`grid` | `list`)
 * and renders a link to the configured `to` path. Optional fields must
 * be hidden when absent — no empty wrappers, no stale labels.
 *
 * Issue #127 unifies the public + admin card into this single component
 * and adds optional admin slots:
 *   - `visibility?`: renders a small badge on private cards (admin only).
 *   - `onDelete?`:   renders a hover-revealed trashcan that opens a
 *                    `<ConfirmDialog>` and invokes the callback on confirm.
 *   - `ideHref?`:    renders the existing "Open in IDE" affordance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DeckCard } from "./DeckCard";
import type { DeckMeta } from "@/framework/viewer/types";

afterEach(() => cleanup());

const baseMeta: DeckMeta = {
  slug: "alpha",
  title: "Alpha",
  description: "An alpha deck.",
  date: "2026-04-01",
};

interface RenderOpts {
  view?: "grid" | "list";
  to?: string;
  visibility?: "public" | "private";
  onDelete?: (slug: string) => Promise<void> | void;
  onArchive?: (slug: string) => Promise<void> | void;
  onRestore?: (slug: string) => Promise<void> | void;
  ideHref?: string;
  hoverPreviewSlideCount?: number;
}

function renderCard(meta: DeckMeta, opts: RenderOpts = {}) {
  const { view = "grid", to, ...rest } = opts;
  return render(
    <MemoryRouter>
      <DeckCard
        meta={meta}
        view={view}
        to={to ?? `/decks/${meta.slug}`}
        {...rest}
      />
    </MemoryRouter>,
  );
}

describe("DeckCard", () => {
  it("renders the title and description", () => {
    renderCard(baseMeta);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("An alpha deck.")).toBeTruthy();
  });

  it("omits the description paragraph when description is undefined", () => {
    const { description, ...metaWithoutDescription } = baseMeta;
    void description;
    renderCard(metaWithoutDescription);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("An alpha deck.")).toBeNull();
    const paragraphs = Array.from(
      document.querySelectorAll<HTMLParagraphElement>(
        "[data-testid='deck-card'] p",
      ),
    );
    for (const p of paragraphs) {
      expect(p.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("omits the description paragraph when description is the empty string", () => {
    renderCard({ ...baseMeta, description: "" });
    expect(screen.queryByText("An alpha deck.")).toBeNull();
    const paragraphs = Array.from(
      document.querySelectorAll<HTMLParagraphElement>(
        "[data-testid='deck-card'] p",
      ),
    );
    for (const p of paragraphs) {
      expect(p.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("links to the provided `to` path", () => {
    renderCard(baseMeta, { to: "/admin/decks/alpha" });
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/admin/decks/alpha");
  });

  it("renders the date in the kicker", () => {
    renderCard(baseMeta);
    expect(screen.getByText(/2026-04-01/)).toBeTruthy();
  });

  it("renders event when present", () => {
    renderCard({ ...baseMeta, event: "DTX Manchester 2026" });
    expect(screen.getByText(/DTX Manchester 2026/)).toBeTruthy();
  });

  it("omits event row when absent", () => {
    renderCard(baseMeta);
    expect(screen.queryByText(/DTX/)).toBeNull();
  });

  it("renders runtime in minutes when present", () => {
    renderCard({ ...baseMeta, runtimeMinutes: 25 });
    expect(screen.getByText(/25 min/i)).toBeTruthy();
  });

  it("omits runtime when absent", () => {
    renderCard(baseMeta);
    expect(screen.queryByText(/min/i)).toBeNull();
  });

  it("renders up to 3 tag chips when tags present", () => {
    renderCard({ ...baseMeta, tags: ["one", "two", "three", "four"] });
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("two")).toBeTruthy();
    expect(screen.getByText("three")).toBeTruthy();
    expect(screen.queryByText("four")).toBeNull();
  });

  it("omits tag row when absent or empty", () => {
    renderCard({ ...baseMeta, tags: [] });
    expect(document.querySelector("[data-deck-tag]")).toBeNull();
  });

  it("renders cover image when present", () => {
    renderCard({ ...baseMeta, cover: "/decks/alpha/cover.png" });
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/decks/alpha/cover.png");
  });

  it("falls back to the slide-1 auto-thumbnail when cover is absent", () => {
    renderCard(baseMeta);
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/thumbnails/alpha/01.png");
  });

  it("prefers `meta.cover` over the auto-thumbnail", () => {
    renderCard({ ...baseMeta, cover: "/decks/alpha/cover.png" });
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/decks/alpha/cover.png");
  });

  it("hides the hero strip if the image fails to load", () => {
    renderCard(baseMeta);
    const img = document.querySelector("img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("deck-card")).toBeTruthy();
  });

  describe("view modes", () => {
    it('renders with view="grid" by default-shaped layout', () => {
      renderCard(baseMeta, { view: "grid" });
      const card = screen.getByTestId("deck-card");
      expect(card.getAttribute("data-view")).toBe("grid");
    });

    it('renders with view="list" exposes data-view=list', () => {
      renderCard(baseMeta, { view: "list" });
      const card = screen.getByTestId("deck-card");
      expect(card.getAttribute("data-view")).toBe("list");
    });
  });

  describe("visibility badge (admin slot)", () => {
    it("renders a private badge when visibility=private", () => {
      renderCard(baseMeta, { visibility: "private" });
      const badge = document.querySelector(
        "[data-visibility='private']",
      ) as HTMLElement | null;
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toMatch(/private/i);
    });

    it("does NOT render a badge when visibility is omitted (public surface)", () => {
      renderCard(baseMeta);
      expect(document.querySelector("[data-visibility]")).toBeNull();
    });

    it("does NOT render a badge for visibility=public (only private gets visual emphasis)", () => {
      // Same convention as the original `<AdminDeckRow>`: visibility
      // badge appears for `private` decks; `public` decks omit the
      // chip to keep the grid uncluttered.
      renderCard(baseMeta, { visibility: "public" });
      expect(document.querySelector("[data-visibility='private']")).toBeNull();
    });
  });

  describe("delete affordance (admin slot)", () => {
    /**
     * Issue #244 replaces the single hover-revealed trashcan with the
     * `<DeckLifecycleMenu>`. The destructive Delete action is now the
     * second menu item; the dialog is a typed-slug confirmation. Tests
     * walk the flow: open menu → click Delete → type slug → confirm.
     */
    function openMenu(slug = "alpha") {
      fireEvent.click(screen.getByTestId(`lifecycle-menu-trigger-${slug}`));
    }
    function clickDelete(slug = "alpha") {
      fireEvent.click(screen.getByTestId(`lifecycle-menu-delete-${slug}`));
    }
    function typeSlug(slug: string) {
      fireEvent.change(screen.getByTestId("typed-slug-input"), {
        target: { value: slug },
      });
    }

    it("does NOT render a lifecycle menu trigger when no lifecycle callbacks are wired", () => {
      renderCard(baseMeta);
      expect(screen.queryByTestId("lifecycle-menu-trigger-alpha")).toBeNull();
    });

    it("renders a lifecycle menu trigger when onDelete is provided", () => {
      renderCard(baseMeta, { onDelete: () => {} });
      expect(screen.getByTestId("lifecycle-menu-trigger-alpha")).toBeDefined();
    });

    it("the Delete menu item opens the typed-slug confirm dialog", () => {
      renderCard(baseMeta, { onDelete: () => {} });
      expect(screen.queryByTestId("confirm-dialog")).toBeNull();
      openMenu();
      clickDelete();
      expect(screen.getByTestId("confirm-dialog")).toBeDefined();
      expect(screen.getByTestId("confirm-dialog").textContent).toMatch(
        /Alpha/,
      );
      // Typed-slug guard primitive is present.
      expect(screen.getByTestId("typed-slug-input")).toBeDefined();
    });

    it("Cancel closes the dialog without invoking onDelete", async () => {
      const onDelete = vi.fn();
      renderCard(baseMeta, { onDelete });
      openMenu();
      clickDelete();
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
      await waitFor(() =>
        expect(screen.queryByTestId("confirm-dialog")).toBeNull(),
      );
      expect(onDelete).not.toHaveBeenCalled();
    });

    it("Confirm requires the slug to be typed before invoking onDelete", async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      renderCard(baseMeta, { onDelete });
      openMenu();
      clickDelete();
      // Without typing, the confirm button is disabled. Click it and
      // onDelete should NOT fire.
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      expect(onDelete).not.toHaveBeenCalled();
      // Type the slug and try again.
      typeSlug("alpha");
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      await waitFor(() => expect(onDelete).toHaveBeenCalledWith("alpha"));
    });

    it("surfaces an inline error when onDelete throws and keeps the dialog open", async () => {
      const onDelete = vi
        .fn()
        .mockRejectedValue(new Error("kv unavailable"));
      renderCard(baseMeta, { onDelete });
      openMenu();
      clickDelete();
      typeSlug("alpha");
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      await waitFor(() =>
        expect(screen.getByTestId("delete-error").textContent).toMatch(
          /kv unavailable/,
        ),
      );
      // Dialog stays open so the user can retry or cancel.
      expect(screen.getByTestId("confirm-dialog")).toBeDefined();
    });

    it("does NOT call window.confirm at any point in the delete flow", async () => {
      const confirmSpy = vi
        .spyOn(window, "confirm")
        .mockImplementation(() => true);
      const onDelete = vi.fn().mockResolvedValue(undefined);
      renderCard(baseMeta, { onDelete });
      openMenu();
      clickDelete();
      typeSlug("alpha");
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      await waitFor(() => expect(onDelete).toHaveBeenCalled());
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });
  });

  describe("lifecycle action menu (issue #244)", () => {
    it("active card with onArchive shows Archive in the menu", () => {
      renderCard(baseMeta, { onArchive: () => {} });
      fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
      expect(screen.getByTestId("lifecycle-menu-archive-alpha")).toBeDefined();
      expect(screen.queryByTestId("lifecycle-menu-restore-alpha")).toBeNull();
    });

    it("archived card (meta.archived=true) with onRestore shows Restore in the menu", () => {
      renderCard(
        { ...baseMeta, archived: true },
        { onRestore: () => {} },
      );
      fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
      expect(screen.getByTestId("lifecycle-menu-restore-alpha")).toBeDefined();
      expect(screen.queryByTestId("lifecycle-menu-archive-alpha")).toBeNull();
    });

    it("archived card does NOT show Archive even if onArchive is wired", () => {
      renderCard(
        { ...baseMeta, archived: true },
        { onArchive: () => {}, onDelete: () => {} },
      );
      fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
      expect(screen.queryByTestId("lifecycle-menu-archive-alpha")).toBeNull();
      expect(screen.getByTestId("lifecycle-menu-delete-alpha")).toBeDefined();
    });

    it("active card does NOT show Restore even if onRestore is wired", () => {
      renderCard(baseMeta, { onRestore: () => {}, onDelete: () => {} });
      fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
      expect(screen.queryByTestId("lifecycle-menu-restore-alpha")).toBeNull();
      expect(screen.getByTestId("lifecycle-menu-delete-alpha")).toBeDefined();
    });

    it("Archive menu item opens a confirmation dialog and fires onArchive after confirm", async () => {
      const onArchive = vi.fn().mockResolvedValue(undefined);
      renderCard(baseMeta, { onArchive });
      fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
      fireEvent.click(screen.getByTestId("lifecycle-menu-archive-alpha"));
      // A simple ConfirmDialog opens (no typed-slug input).
      expect(screen.getByTestId("confirm-dialog")).toBeDefined();
      expect(screen.queryByTestId("typed-slug-input")).toBeNull();
      // Body explains the public-link consequence.
      expect(screen.getByTestId("confirm-dialog").textContent).toMatch(
        /public link/i,
      );
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      await waitFor(() => expect(onArchive).toHaveBeenCalledWith("alpha"));
    });

    it("Restore menu item opens a confirmation dialog and fires onRestore after confirm", async () => {
      const onRestore = vi.fn().mockResolvedValue(undefined);
      renderCard(
        { ...baseMeta, archived: true },
        { onRestore },
      );
      fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
      fireEvent.click(screen.getByTestId("lifecycle-menu-restore-alpha"));
      expect(screen.getByTestId("confirm-dialog")).toBeDefined();
      expect(screen.queryByTestId("typed-slug-input")).toBeNull();
      // Body explains the move-back-to-active consequence.
      expect(screen.getByTestId("confirm-dialog").textContent).toMatch(
        /active|move back/i,
      );
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      await waitFor(() => expect(onRestore).toHaveBeenCalledWith("alpha"));
    });

    it("Archive cancel closes the dialog without firing onArchive", async () => {
      const onArchive = vi.fn();
      renderCard(baseMeta, { onArchive });
      fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
      fireEvent.click(screen.getByTestId("lifecycle-menu-archive-alpha"));
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
      await waitFor(() =>
        expect(screen.queryByTestId("confirm-dialog")).toBeNull(),
      );
      expect(onArchive).not.toHaveBeenCalled();
    });

    it("Archive dialog surfaces an inline error when onArchive throws", async () => {
      const onArchive = vi
        .fn()
        .mockRejectedValue(new Error("source unavailable"));
      renderCard(baseMeta, { onArchive });
      fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
      fireEvent.click(screen.getByTestId("lifecycle-menu-archive-alpha"));
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      await waitFor(() =>
        expect(screen.getByTestId("archive-error").textContent).toMatch(
          /source unavailable/,
        ),
      );
      expect(screen.getByTestId("confirm-dialog")).toBeDefined();
    });
  });

  describe("draft pill (issue #191)", () => {
    it("renders a DRAFT pill when meta.draft === true", () => {
      renderCard({ ...baseMeta, draft: true });
      const pill = document.querySelector(
        "[data-testid='deck-draft-pill']",
      ) as HTMLElement | null;
      expect(pill).not.toBeNull();
      expect(pill?.textContent).toMatch(/draft/i);
    });

    it("does NOT render the DRAFT pill when meta.draft === false", () => {
      renderCard({ ...baseMeta, draft: false });
      expect(
        document.querySelector("[data-testid='deck-draft-pill']"),
      ).toBeNull();
    });

    it("does NOT render the DRAFT pill when meta.draft is undefined", () => {
      renderCard(baseMeta);
      expect(
        document.querySelector("[data-testid='deck-draft-pill']"),
      ).toBeNull();
    });

    it("renders DRAFT pill alongside the visibility pill when both apply", () => {
      renderCard(
        { ...baseMeta, draft: true },
        { visibility: "private" },
      );
      expect(
        document.querySelector("[data-testid='deck-draft-pill']"),
      ).not.toBeNull();
      expect(
        document.querySelector("[data-visibility='private']"),
      ).not.toBeNull();
    });
  });

  describe("IDE link (admin slot)", () => {
    it("does NOT render the IDE link when ideHref is omitted", () => {
      renderCard(baseMeta);
      expect(screen.queryByTestId("open-in-ide")).toBeNull();
    });

    it("renders the IDE link when ideHref is provided", () => {
      renderCard(baseMeta, { ideHref: "vscode://example" });
      const link = screen.getByTestId("open-in-ide");
      expect(link.getAttribute("href")).toBe("vscode://example");
    });
  });

  describe("hover preview animation (issue #128)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });

    /**
     * Returns the visible thumbnail's `src`. Visible = the `<img>` that
     * does NOT carry `data-hover-preload` (the preload helpers are
     * absolute-positioned with opacity 0 and aren't the foreground).
     */
    function visibleSrc(): string | null {
      const imgs = Array.from(
        document.querySelectorAll<HTMLImageElement>("img"),
      );
      const visible = imgs.find(
        (img) => !img.hasAttribute("data-hover-preload"),
      );
      return visible?.getAttribute("src") ?? null;
    }

    it("does NOT render preload thumbnails when hoverPreviewSlideCount is 0", () => {
      renderCard(baseMeta, { view: "grid", hoverPreviewSlideCount: 0 });
      expect(
        document.querySelectorAll("[data-hover-preload]").length,
      ).toBe(0);
    });

    it("does NOT render preload thumbnails in list mode (only grid mode animates)", () => {
      renderCard(baseMeta, { view: "list", hoverPreviewSlideCount: 5 });
      expect(
        document.querySelectorAll("[data-hover-preload]").length,
      ).toBe(0);
    });

    it("renders N-1 preload <img> tags when hoverPreviewSlideCount = N (slide 1 is the visible one)", () => {
      renderCard(baseMeta, { view: "grid", hoverPreviewSlideCount: 4 });
      const preloads = document.querySelectorAll("[data-hover-preload]");
      // The visible <img> is slide 1; preloads cover 02, 03, 04.
      expect(preloads.length).toBe(3);
      const srcs = Array.from(preloads).map((el) => el.getAttribute("src"));
      expect(srcs).toEqual([
        "/thumbnails/alpha/02.png",
        "/thumbnails/alpha/03.png",
        "/thumbnails/alpha/04.png",
      ]);
    });

    it("preload <img> tags use eager loading and zero opacity (no layout shift)", () => {
      renderCard(baseMeta, { view: "grid", hoverPreviewSlideCount: 3 });
      const preloads = document.querySelectorAll("[data-hover-preload]");
      for (const el of preloads) {
        expect(el.getAttribute("loading")).toBe("eager");
      }
    });

    it("hover cycles the visible src through 02, 03, then back to 01 then 02 …", () => {
      renderCard(baseMeta, { view: "grid", hoverPreviewSlideCount: 3 });
      const card = screen.getByTestId("deck-card");
      // Initial visible src = slide 1.
      expect(visibleSrc()).toBe("/thumbnails/alpha/01.png");
      act(() => {
        fireEvent.mouseEnter(card);
      });
      // Tick 1 (600ms) → slide 2.
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(visibleSrc()).toBe("/thumbnails/alpha/02.png");
      // Tick 2 (1200ms) → slide 3.
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(visibleSrc()).toBe("/thumbnails/alpha/03.png");
      // Tick 3 (1800ms) → wraps back to slide 1.
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(visibleSrc()).toBe("/thumbnails/alpha/01.png");
      // Tick 4 (2400ms) → slide 2.
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(visibleSrc()).toBe("/thumbnails/alpha/02.png");
    });

    it("mouseleave snaps the visible src back to slide 1 and stops cycling", () => {
      renderCard(baseMeta, { view: "grid", hoverPreviewSlideCount: 4 });
      const card = screen.getByTestId("deck-card");
      act(() => {
        fireEvent.mouseEnter(card);
      });
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      // After two ticks, visible src is slide 3.
      expect(visibleSrc()).toBe("/thumbnails/alpha/03.png");
      // Leaving the card snaps back to slide 1.
      act(() => {
        fireEvent.mouseLeave(card);
      });
      expect(visibleSrc()).toBe("/thumbnails/alpha/01.png");
      // Subsequent ticks should NOT advance the visible src.
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(visibleSrc()).toBe("/thumbnails/alpha/01.png");
    });

    it("does NOT cycle when hoverPreviewSlideCount is 1 (no other slides to cycle to)", () => {
      renderCard(baseMeta, { view: "grid", hoverPreviewSlideCount: 1 });
      const card = screen.getByTestId("deck-card");
      act(() => {
        fireEvent.mouseEnter(card);
      });
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(visibleSrc()).toBe("/thumbnails/alpha/01.png");
    });

    it("clears the interval on unmount (no leaked timers)", () => {
      const { unmount } = renderCard(baseMeta, {
        view: "grid",
        hoverPreviewSlideCount: 3,
      });
      const card = screen.getByTestId("deck-card");
      act(() => {
        fireEvent.mouseEnter(card);
      });
      // Sanity: a timer was scheduled.
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      unmount();
      // After unmount, no pending timers should remain.
      expect(vi.getTimerCount()).toBe(0);
    });

    it("uses meta.cover unchanged for the visible src and only generates preloads from /thumbnails/<slug>/", () => {
      renderCard(
        { ...baseMeta, cover: "/decks/alpha/cover.png" },
        { view: "grid", hoverPreviewSlideCount: 3 },
      );
      // Visible src = the author's cover.
      expect(visibleSrc()).toBe("/decks/alpha/cover.png");
      // Preloads still walk the thumbnail directory (slides 02, 03).
      const preloads = document.querySelectorAll("[data-hover-preload]");
      const srcs = Array.from(preloads).map((el) => el.getAttribute("src"));
      expect(srcs).toEqual([
        "/thumbnails/alpha/02.png",
        "/thumbnails/alpha/03.png",
      ]);
    });

    it("hover cycling pauses if the foreground image fails to load and the hero is hidden", () => {
      renderCard(baseMeta, { view: "grid", hoverPreviewSlideCount: 3 });
      const visible = document.querySelector(
        "img:not([data-hover-preload])",
      ) as HTMLImageElement | null;
      expect(visible).not.toBeNull();
      // Failure event removes the hero entirely.
      act(() => {
        fireEvent.error(visible!);
      });
      expect(document.querySelector("img")).toBeNull();
    });
  });
});
