/**
 * Idle timer behavior for the auto-hide chrome controller.
 *
 * Asserts that after `IDLE_TIMEOUT_MS` of inactivity the deck root receives
 * `data-presenter-idle="true"` and that mousemove / keydown reset it back
 * to `"false"` (and re-arm the timer).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AutoHideChrome, IDLE_TIMEOUT_MS } from "./AutoHideChrome";

describe("AutoHideChrome", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<div data-deck-slug="test-deck" id="root"></div>';
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("flips data-presenter-idle to true after the idle timeout", () => {
    render(<AutoHideChrome />);
    const root = document.querySelector<HTMLElement>("[data-deck-slug]");
    expect(root?.getAttribute("data-presenter-idle")).toBe("false");

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 10);
    expect(root?.getAttribute("data-presenter-idle")).toBe("true");
  });

  it("resets idle attr on mousemove and re-arms the timer", () => {
    render(<AutoHideChrome />);
    const root = document.querySelector<HTMLElement>("[data-deck-slug]");

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 10);
    expect(root?.getAttribute("data-presenter-idle")).toBe("true");

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, clientY: 1 }));
    expect(root?.getAttribute("data-presenter-idle")).toBe("false");

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 100);
    expect(root?.getAttribute("data-presenter-idle")).toBe("false");

    vi.advanceTimersByTime(200);
    expect(root?.getAttribute("data-presenter-idle")).toBe("true");
  });

  it("resets on keydown (typing keyboard shortcuts counts as activity)", () => {
    render(<AutoHideChrome />);
    const root = document.querySelector<HTMLElement>("[data-deck-slug]");

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 10);
    expect(root?.getAttribute("data-presenter-idle")).toBe("true");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(root?.getAttribute("data-presenter-idle")).toBe("false");
  });

  it("removes the attribute on unmount so chrome reappears", () => {
    const { unmount } = render(<AutoHideChrome />);
    const root = document.querySelector<HTMLElement>("[data-deck-slug]");
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 10);
    expect(root?.getAttribute("data-presenter-idle")).toBe("true");
    unmount();
    expect(root?.hasAttribute("data-presenter-idle")).toBe(false);
  });

  it("respects a custom timeoutMs prop", () => {
    render(<AutoHideChrome timeoutMs={500} />);
    const root = document.querySelector<HTMLElement>("[data-deck-slug]");
    vi.advanceTimersByTime(400);
    expect(root?.getAttribute("data-presenter-idle")).toBe("false");
    vi.advanceTimersByTime(200);
    expect(root?.getAttribute("data-presenter-idle")).toBe("true");
  });
});
