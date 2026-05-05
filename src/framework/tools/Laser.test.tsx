/**
 * Tests for the Laser pointer overlay.
 *
 * - Hidden by default
 * - Renders on `q` keydown and follows the mouse
 * - Hides on `q` keyup
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Laser } from "./Laser";
import { __resetCursorPositionForTest } from "./useCursorPosition";

describe("Laser", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    __resetCursorPositionForTest();
  });
  afterEach(() => cleanup());

  it("renders nothing when not active", () => {
    const { queryByTestId } = render(<Laser />);
    expect(queryByTestId("laser-dot")).toBeNull();
  });

  it("renders the dot when Q is held and follows mousemove", () => {
    const { queryByTestId } = render(<Laser />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    });
    // After active flips on, the mousemove listener is attached by an
    // effect; dispatch the move in a separate act so the new listener is
    // already wired.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 200, clientY: 300 }),
      );
    });
    const dot = queryByTestId("laser-dot");
    expect(dot).not.toBeNull();
    // 12px size — center at 200,300 → top-left at 194,294
    expect((dot as HTMLElement).style.left).toBe("194px");
    expect((dot as HTMLElement).style.top).toBe("294px");
  });

  it("hides when Q is released", () => {
    const { queryByTestId } = render(<Laser />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    });
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 100, clientY: 100 }),
      );
    });
    expect(queryByTestId("laser-dot")).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "q" }));
    });
    expect(queryByTestId("laser-dot")).toBeNull();
  });

  it("renders the dot IMMEDIATELY on activation if a previous mousemove was observed", () => {
    // Pre-seed the global tracker with a cursor position.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 500, clientY: 500 }),
      );
    });
    const { queryByTestId } = render(<Laser />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    });
    // No additional mousemove — but the dot should already be visible.
    const dot = queryByTestId("laser-dot");
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).style.left).toBe("494px");
    expect((dot as HTMLElement).style.top).toBe("494px");
  });

  it("falls back to viewport centre when no cursor has been observed", () => {
    // Override innerWidth/innerHeight so the centre is deterministic.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    const { queryByTestId } = render(<Laser />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    });
    const dot = queryByTestId("laser-dot");
    expect(dot).not.toBeNull();
    // Centre is (500, 400); 12px size → top-left at (494, 394).
    expect((dot as HTMLElement).style.left).toBe("494px");
    expect((dot as HTMLElement).style.top).toBe("394px");
  });

  it("calls onActiveChange when activated and deactivated", () => {
    const cb = vi.fn();
    render(<Laser onActiveChange={cb} />);
    expect(cb).toHaveBeenLastCalledWith(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    });
    expect(cb).toHaveBeenLastCalledWith(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "q" }));
    });
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it("does not activate on Q with metaKey/ctrlKey modifiers", () => {
    const { queryByTestId } = render(<Laser />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "q", metaKey: true }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 100, clientY: 100 }),
      );
    });
    expect(queryByTestId("laser-dot")).toBeNull();
  });
});
