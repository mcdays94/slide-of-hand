/**
 * Tests for the Magnifier overlay.
 *
 * - Hidden by default
 * - Renders on `w` keydown without requiring a subsequent mousemove
 * - Hides on `w` keyup
 * - Calls onActiveChange
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Magnifier } from "./Magnifier";
import { __resetCursorPositionForTest } from "./useCursorPosition";

function mountSlideShell() {
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
  return slide;
}

describe("Magnifier", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    __resetCursorPositionForTest();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1080,
    });
  });
  afterEach(() => cleanup());

  it("renders nothing when not active", () => {
    const { queryByTestId } = render(<Magnifier />);
    expect(queryByTestId("magnifier")).toBeNull();
  });

  it("renders IMMEDIATELY on W keydown using last-known cursor position", () => {
    mountSlideShell();
    // Pre-seed the global cursor tracker.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 800, clientY: 600 }),
      );
    });
    const { queryByTestId } = render(<Magnifier />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    });
    // No additional mousemove — should already be on screen.
    expect(queryByTestId("magnifier")).not.toBeNull();
  });

  it("falls back to viewport centre when no cursor has been observed", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    });
    expect(queryByTestId("magnifier")).not.toBeNull();
  });

  it("hides on W keyup", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    });
    expect(queryByTestId("magnifier")).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
    });
    expect(queryByTestId("magnifier")).toBeNull();
  });

  it("does not activate on W with metaKey/ctrlKey modifiers", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", metaKey: true }),
      );
    });
    expect(queryByTestId("magnifier")).toBeNull();
  });

  it("calls onActiveChange when toggled", () => {
    mountSlideShell();
    const cb = vi.fn();
    render(<Magnifier onActiveChange={cb} />);
    expect(cb).toHaveBeenLastCalledWith(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    });
    expect(cb).toHaveBeenLastCalledWith(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
    });
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it("renders a chromatic-aberration overlay when effects are enabled (default)", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    });
    expect(queryByTestId("magnifier-aberration")).not.toBeNull();
  });

  it("omits the aberration overlay when effects=false", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier effects={false} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    });
    expect(queryByTestId("magnifier")).not.toBeNull();
    expect(queryByTestId("magnifier-aberration")).toBeNull();
  });
});
