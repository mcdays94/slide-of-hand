/**
 * Tests for the Laser pointer overlay.
 *
 * - Hidden by default
 * - Renders on `q` keydown and follows the mouse
 * - Hides on `q` keyup
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Laser } from "./Laser";

describe("Laser", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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
