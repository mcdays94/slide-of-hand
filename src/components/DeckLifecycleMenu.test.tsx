/**
 * Tests for `<DeckLifecycleMenu>` — the quiet, hover-revealed action
 * menu that exposes deck lifecycle actions on each admin card (issue
 * #244).
 *
 * Active decks expose Archive + Delete. Archived decks expose Restore +
 * Delete. Menu items render only when a callback is wired; in this
 * slice some backends are still under construction so an item with no
 * callback should be omitted (or rendered disabled).
 *
 * The menu trigger is keyboard-focusable. Pressing it (click or Enter)
 * opens the menu, and items are real `<button>` elements so they get
 * usable labels via accessible name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DeckLifecycleMenu } from "./DeckLifecycleMenu";

afterEach(() => cleanup());

describe("<DeckLifecycleMenu>", () => {
  it("renders nothing when no callbacks are provided", () => {
    const { container } = render(
      <DeckLifecycleMenu slug="alpha" title="Alpha" lifecycle="active" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("active deck renders Archive + Delete menu items when callbacks exist", () => {
    render(
      <DeckLifecycleMenu
        slug="alpha"
        title="Alpha"
        lifecycle="active"
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
    expect(screen.getByTestId("lifecycle-menu-archive-alpha")).toBeDefined();
    expect(screen.getByTestId("lifecycle-menu-delete-alpha")).toBeDefined();
    expect(screen.queryByTestId("lifecycle-menu-restore-alpha")).toBeNull();
  });

  it("archived deck renders Restore + Delete menu items when callbacks exist", () => {
    render(
      <DeckLifecycleMenu
        slug="alpha"
        title="Alpha"
        lifecycle="archived"
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
    expect(screen.getByTestId("lifecycle-menu-restore-alpha")).toBeDefined();
    expect(screen.getByTestId("lifecycle-menu-delete-alpha")).toBeDefined();
    expect(screen.queryByTestId("lifecycle-menu-archive-alpha")).toBeNull();
  });

  it("omits an item when its callback is undefined", () => {
    render(
      <DeckLifecycleMenu
        slug="alpha"
        title="Alpha"
        lifecycle="active"
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
    // Only delete is wired — archive should NOT be in the menu.
    expect(screen.getByTestId("lifecycle-menu-delete-alpha")).toBeDefined();
    expect(screen.queryByTestId("lifecycle-menu-archive-alpha")).toBeNull();
  });

  it("does not render the menu items until trigger is clicked", () => {
    render(
      <DeckLifecycleMenu
        slug="alpha"
        title="Alpha"
        lifecycle="active"
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // Trigger should be present.
    expect(screen.getByTestId("lifecycle-menu-trigger-alpha")).toBeDefined();
    // But the menu items shouldn't be rendered yet.
    expect(screen.queryByTestId("lifecycle-menu-archive-alpha")).toBeNull();
    expect(screen.queryByTestId("lifecycle-menu-delete-alpha")).toBeNull();
  });

  it("clicking the trigger toggles the menu open and closed", () => {
    render(
      <DeckLifecycleMenu
        slug="alpha"
        title="Alpha"
        lifecycle="active"
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
    expect(screen.getByTestId("lifecycle-menu-delete-alpha")).toBeDefined();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
    expect(screen.queryByTestId("lifecycle-menu-delete-alpha")).toBeNull();
  });

  it("clicking an item fires its callback (string slug) and closes the menu", () => {
    const onArchive = vi.fn();
    render(
      <DeckLifecycleMenu
        slug="alpha"
        title="Alpha"
        lifecycle="active"
        onArchive={onArchive}
      />,
    );
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-alpha"));
    expect(onArchive).toHaveBeenCalledTimes(1);
    // Menu closes after action.
    expect(screen.queryByTestId("lifecycle-menu-archive-alpha")).toBeNull();
  });

  it("menu items are <button> elements with usable accessible names", () => {
    render(
      <DeckLifecycleMenu
        slug="alpha"
        title="Alpha"
        lifecycle="active"
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
    const archive = screen.getByTestId("lifecycle-menu-archive-alpha");
    const del = screen.getByTestId("lifecycle-menu-delete-alpha");
    expect(archive.tagName).toBe("BUTTON");
    expect(del.tagName).toBe("BUTTON");
    // Accessible name = text content for plain <button>s.
    expect(archive.textContent?.toLowerCase()).toMatch(/archive/);
    expect(del.textContent?.toLowerCase()).toMatch(/delete/);
  });

  it("trigger is a focusable button with an aria-label that references the deck", () => {
    render(
      <DeckLifecycleMenu
        slug="alpha"
        title="My Deck"
        lifecycle="active"
        onArchive={vi.fn()}
      />,
    );
    const trigger = screen.getByTestId(
      "lifecycle-menu-trigger-alpha",
    ) as HTMLButtonElement;
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-label")?.toLowerCase()).toContain(
      "my deck",
    );
    // Reachable from keyboard.
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape closes the menu", () => {
    render(
      <DeckLifecycleMenu
        slug="alpha"
        title="Alpha"
        lifecycle="active"
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-alpha"));
    expect(screen.getByTestId("lifecycle-menu-delete-alpha")).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("lifecycle-menu-delete-alpha")).toBeNull();
  });
});
