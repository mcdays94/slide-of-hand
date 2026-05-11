/**
 * Tests for `<PresenterTools>` — the laser / magnifier / marker /
 * auto-hide composition.
 *
 * After 2026-05-11 these tools are audience-side aids — always
 * available on every deck viewer, regardless of authentication or
 * presenter-mode context. They live OUTSIDE `<PresenterAffordances>`
 * (which is auth-gated and now hosts only the P-key presenter window
 * trigger). Tests pin the always-on behavior + the per-tool key
 * handlers + the `data-tool-active` attribute mirror.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { PresenterTools } from "./PresenterTools";
import { __resetCursorPositionForTest } from "./useCursorPosition";

describe("PresenterTools", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div data-deck-slug="test-deck" id="root"></div>';
  });
  afterEach(() => cleanup());

  it("mounts the toolset even when presenter mode is DISABLED (audience-side aid)", () => {
    // Before 2026-05-11 this returned null. The new contract: the
    // tools are audience-side and always mount, so a presenter on
    // the public `/decks/<slug>` route (no auth) can still use
    // Q/W/E. The auth gate now sits only on author-only surfaces
    // (P-key presenter window trigger, TopToolbar admin buttons,
    // admin Settings rows, admin routes).
    render(
      <PresenterModeProvider enabled={false}>
        <PresenterTools />
      </PresenterModeProvider>,
    );
    // AutoHideChrome sets the idle attribute on the deck root, which
    // confirms the toolset mounted.
    const root = document.querySelector("[data-deck-slug]");
    expect(root?.getAttribute("data-presenter-idle")).toBe("false");
  });

  it("mounts the toolset when presenter mode is enabled (admin viewer)", () => {
    render(
      <PresenterModeProvider enabled={true}>
        <PresenterTools />
      </PresenterModeProvider>,
    );
    const root = document.querySelector("[data-deck-slug]");
    expect(root?.getAttribute("data-presenter-idle")).toBe("false");
  });

  it("mounts the toolset with no PresenterModeProvider at all (the public-viewer-unauth case)", () => {
    // The public deck route now wraps in `<PresenterModeProvider
    // enabled={authStatus === 'authenticated'}>`. For unauthenticated
    // visitors the provider exists with enabled=false. For tests, we
    // can also render with NO provider at all — same outcome: the
    // tools must mount.
    render(<PresenterTools />);
    const root = document.querySelector("[data-deck-slug]");
    expect(root?.getAttribute("data-presenter-idle")).toBe("false");
  });

  it("mirrors the active tool to data-tool-active and renders the pill (Q = laser)", () => {
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

    const { queryByTestId } = render(<PresenterTools />);

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

    const { queryByTestId } = render(<PresenterTools />);

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

  it("Q/W/E keys all work on the public unauthenticated viewer (no PresenterModeProvider)", () => {
    // Belt + braces: the audience-side use case explicitly pins
    // that all three keyboard shortcuts engage their respective
    // tools without any provider context. If a future refactor
    // reintroduces an accidental gate, this catches it.
    __resetCursorPositionForTest();
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

    const { queryByTestId } = render(<PresenterTools />);
    const root = document.querySelector("[data-deck-slug]");

    // Laser (Q).
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    });
    expect(root?.getAttribute("data-tool-active")).toBe("laser");
    expect(queryByTestId("tool-active-pill")?.textContent).toMatch(/LASER/);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "q" }));
    });

    // Marker (E).
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    expect(root?.getAttribute("data-tool-active")).toBe("marker");
    expect(queryByTestId("tool-active-pill")?.textContent).toMatch(/MARKER/);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "e" }));
    });

    // Magnifier (W) — needs a held key + cursor in viewport. The
    // tool sets up the data-tool-active="magnifier" attribute on
    // keydown.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    });
    expect(root?.getAttribute("data-tool-active")).toBe("magnifier");
    expect(queryByTestId("tool-active-pill")?.textContent).toMatch(
      /MAGNIFY/,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
    });
  });
});
