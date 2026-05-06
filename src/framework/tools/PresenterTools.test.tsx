/**
 * Tests for PresenterTools composition gating.
 *
 * - Returns null when presenter mode is off and no URL override
 * - Mounts the toolset when presenter mode is on
 * - Detects the `?presenter-mode=1` URL override
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import {
  PresenterTools,
  readPresenterModeOverride,
} from "./PresenterTools";
import { __resetCursorPositionForTest } from "./useCursorPosition";

describe("PresenterTools", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div data-deck-slug="test-deck" id="root"></div>';
  });
  afterEach(() => cleanup());

  it("renders nothing when presenter mode is disabled", () => {
    const { container } = render(
      <PresenterModeProvider enabled={false}>
        <PresenterTools />
      </PresenterModeProvider>,
    );
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("mounts the toolset when presenter mode is enabled", () => {
    render(
      <PresenterModeProvider enabled={true}>
        <PresenterTools />
      </PresenterModeProvider>,
    );
    // AutoHideChrome should set the idle attribute on the root.
    const root = document.querySelector("[data-deck-slug]");
    expect(root?.getAttribute("data-presenter-idle")).toBe("false");
  });

  it("mirrors the active tool to data-tool-active and renders the pill", () => {
    __resetCursorPositionForTest();
    // Provide a slide-shell so Magnifier can resolve a clone target if
    // engaged (not exercised here but makes the harness symmetric with
    // production).
    const slide = document.createElement("section");
    slide.setAttribute("data-testid", "slide-shell");
    slide.setAttribute("data-slide-index", "0");
    slide.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        right: 1920,
        bottom: 1080,
        x: 0,
        y: 0,
        toJSON: () => "",
      }) as DOMRect;
    document.body.appendChild(slide);

    const { queryByTestId } = render(
      <PresenterModeProvider enabled={true}>
        <PresenterTools />
      </PresenterModeProvider>,
    );

    const root = document.querySelector("[data-deck-slug]");
    // No tool engaged → no attribute, no pill.
    expect(root?.getAttribute("data-tool-active")).toBeNull();
    expect(queryByTestId("tool-active-pill")).toBeNull();

    // Engage the laser via Q.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    });
    expect(root?.getAttribute("data-tool-active")).toBe("laser");
    const pill = queryByTestId("tool-active-pill");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toMatch(/LASER/);

    // Release laser.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "q" }));
    });
    expect(root?.getAttribute("data-tool-active")).toBeNull();
    expect(queryByTestId("tool-active-pill")).toBeNull();
  });

  it("mirrors marker mode to data-tool-active=marker while E is held, clears on key-up", () => {
    const slide = document.createElement("section");
    slide.setAttribute("data-testid", "slide-shell");
    slide.setAttribute("data-slide-index", "0");
    slide.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        right: 1920,
        bottom: 1080,
        x: 0,
        y: 0,
        toJSON: () => "",
      }) as DOMRect;
    document.body.appendChild(slide);

    const { queryByTestId } = render(
      <PresenterModeProvider enabled={true}>
        <PresenterTools />
      </PresenterModeProvider>,
    );

    const root = document.querySelector("[data-deck-slug]");
    // Press E (hold).
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    expect(root?.getAttribute("data-tool-active")).toBe("marker");
    expect(root?.getAttribute("data-marker-active")).toBe("true");
    expect(queryByTestId("tool-active-pill")?.textContent).toMatch(/MARKER/);

    // Release E (hold-to-draw model).
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "e" }));
    });
    expect(root?.getAttribute("data-tool-active")).toBeNull();
    expect(root?.getAttribute("data-marker-active")).toBeNull();
  });
});

describe("readPresenterModeOverride", () => {
  const originalLocation = window.location;

  function setSearch(search: string) {
    // happy-dom permits replacing location.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, search },
    });
  }

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("returns false when no query string is present", () => {
    setSearch("");
    expect(readPresenterModeOverride()).toBe(false);
  });

  it("returns true for ?presenter-mode=1", () => {
    setSearch("?presenter-mode=1");
    expect(readPresenterModeOverride()).toBe(true);
  });

  it("returns true for ?presenter (bare flag)", () => {
    setSearch("?presenter");
    expect(readPresenterModeOverride()).toBe(true);
  });

  it("returns false for ?presenter-mode=0", () => {
    setSearch("?presenter-mode=0");
    expect(readPresenterModeOverride()).toBe(false);
  });
});
