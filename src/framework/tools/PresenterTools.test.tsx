/**
 * Tests for PresenterTools composition gating.
 *
 * - Returns null when presenter mode is off and no URL override
 * - Mounts the toolset when presenter mode is on
 * - Detects the `?presenter-mode=1` URL override
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import {
  PresenterTools,
  readPresenterModeOverride,
} from "./PresenterTools";

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
