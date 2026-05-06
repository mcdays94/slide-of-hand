/**
 * Tests for the Magnifier overlay (cf-slides liquid-glass port).
 *
 * - Hidden by default
 * - Renders on `w` keydown without requiring a subsequent mousemove
 * - Hides on `w` keyup
 * - Calls onActiveChange
 * - Modifier keys + interactive-element targets do NOT activate
 * - Scroll wheel while active resizes the lens within MIN/MAX bounds
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

function pressW() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
  });
}

function releaseW() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
  });
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
    expect(queryByTestId("magnifier-lens")).toBeNull();
    expect(queryByTestId("magnifier-handle")).toBeNull();
  });

  it("renders the lens + handle IMMEDIATELY on W keydown (no mousemove required)", () => {
    mountSlideShell();
    // Pre-seed the global cursor tracker so we know the lens lands at a
    // real position; the fallback path is exercised separately.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 800, clientY: 600 }),
      );
    });
    const { queryByTestId } = render(<Magnifier />);
    pressW();
    expect(queryByTestId("magnifier-lens")).not.toBeNull();
    expect(queryByTestId("magnifier-handle")).not.toBeNull();
  });

  it("renders the DOM-clone zoom layer when a slide-shell is mounted", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    pressW();
    expect(queryByTestId("magnifier-zoom-layer")).not.toBeNull();
  });

  it("falls back to viewport centre when no cursor has been observed", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    pressW();
    expect(queryByTestId("magnifier-lens")).not.toBeNull();
  });

  it("hides on W keyup", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    pressW();
    expect(queryByTestId("magnifier-lens")).not.toBeNull();
    releaseW();
    expect(queryByTestId("magnifier-lens")).toBeNull();
  });

  it("does not activate on W with metaKey/ctrlKey modifiers", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", metaKey: true }),
      );
    });
    expect(queryByTestId("magnifier-lens")).toBeNull();
  });

  it("calls onActiveChange when toggled", () => {
    mountSlideShell();
    const cb = vi.fn();
    render(<Magnifier onActiveChange={cb} />);
    expect(cb).toHaveBeenLastCalledWith(false);
    pressW();
    expect(cb).toHaveBeenLastCalledWith(true);
    releaseW();
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it("scroll wheel up while active increases lens radius", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    pressW();
    const lens = queryByTestId("magnifier-lens") as HTMLElement;
    const initialWidth = parseInt(lens.style.width, 10);
    // Wheel up = deltaY < 0 = bigger.
    act(() => {
      window.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -100, cancelable: true }),
      );
    });
    const lensAfter = queryByTestId("magnifier-lens") as HTMLElement;
    const afterWidth = parseInt(lensAfter.style.width, 10);
    expect(afterWidth).toBeGreaterThan(initialWidth);
  });

  it("scroll wheel down while active decreases lens radius", () => {
    mountSlideShell();
    const { queryByTestId } = render(<Magnifier />);
    pressW();
    const lens = queryByTestId("magnifier-lens") as HTMLElement;
    const initialWidth = parseInt(lens.style.width, 10);
    act(() => {
      window.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
      );
    });
    const lensAfter = queryByTestId("magnifier-lens") as HTMLElement;
    const afterWidth = parseInt(lensAfter.style.width, 10);
    expect(afterWidth).toBeLessThan(initialWidth);
  });

  it("scroll wheel does not resize when not active", () => {
    mountSlideShell();
    render(<Magnifier />);
    // No press; should be no-op.
    let prevented = false;
    const wheelEvent = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    Object.defineProperty(wheelEvent, "preventDefault", {
      value: () => {
        prevented = true;
      },
    });
    act(() => {
      window.dispatchEvent(wheelEvent);
    });
    expect(prevented).toBe(false);
  });

  it("does not activate when typing in an input (data-interactive opt-out)", () => {
    mountSlideShell();
    const input = document.createElement("input");
    input.setAttribute("data-interactive", "");
    document.body.appendChild(input);
    const { queryByTestId } = render(<Magnifier />);
    input.focus();
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", bubbles: true }),
      );
    });
    expect(queryByTestId("magnifier-lens")).toBeNull();
  });
});
