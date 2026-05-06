/**
 * Surface-level tests for `<SelectionOverlay>`.
 *
 * happy-dom returns zero-size rects from `getBoundingClientRect`, so we
 * spy on the DOM API to inject realistic rect values. Tests confirm:
 *   - mounts only when target is non-null
 *   - reads the target's bounding rect into inline `top/left/width/height`
 *   - paints the badge label
 *   - unmounts when target flips back to null
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SelectionOverlay } from "./SelectionOverlay";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeTarget(rect: { top: number; left: number; width: number; height: number }): Element {
  const el = document.createElement("h1");
  el.textContent = "Hello";
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

describe("<SelectionOverlay>", () => {
  it("does not render when target is null", () => {
    render(<SelectionOverlay target={null} label="" />);
    expect(screen.queryByTestId("selection-overlay")).toBeNull();
  });

  it("renders a positioned outline reflecting the target's rect", () => {
    const target = makeTarget({ top: 100, left: 200, width: 320, height: 80 });
    render(<SelectionOverlay target={target} label="H1.text-cf-orange" />);

    const overlay = screen.getByTestId("selection-overlay") as HTMLElement;
    expect(overlay.style.top).toBe("100px");
    expect(overlay.style.left).toBe("200px");
    expect(overlay.style.width).toBe("320px");
    expect(overlay.style.height).toBe("80px");
  });

  it("renders the badge label in the upper-left", () => {
    const target = makeTarget({ top: 0, left: 0, width: 100, height: 40 });
    render(<SelectionOverlay target={target} label="H1.text-cf-orange" />);

    const badge = screen.getByTestId("selection-overlay-badge");
    expect(badge.textContent).toBe("H1.text-cf-orange");
  });

  it("uses the brand orange dashed border", () => {
    const target = makeTarget({ top: 10, left: 20, width: 50, height: 30 });
    render(<SelectionOverlay target={target} label="P" />);

    const overlay = screen.getByTestId("selection-overlay") as HTMLElement;
    expect(overlay.className).toMatch(/border-dashed/);
    expect(overlay.className).toMatch(/border-cf-orange/);
  });

  it("re-renders with new rect when the target prop swaps", () => {
    const a = makeTarget({ top: 10, left: 10, width: 100, height: 50 });
    const b = makeTarget({ top: 200, left: 300, width: 400, height: 60 });

    const { rerender } = render(
      <SelectionOverlay target={a} label="A" />,
    );
    let overlay = screen.getByTestId("selection-overlay") as HTMLElement;
    expect(overlay.style.top).toBe("10px");

    rerender(<SelectionOverlay target={b} label="B" />);
    overlay = screen.getByTestId("selection-overlay") as HTMLElement;
    expect(overlay.style.top).toBe("200px");
    expect(overlay.style.left).toBe("300px");
    expect(screen.getByTestId("selection-overlay-badge").textContent).toBe(
      "B",
    );
  });

  it("unmounts when target flips back to null", () => {
    const target = makeTarget({ top: 1, left: 1, width: 1, height: 1 });
    const { rerender } = render(
      <SelectionOverlay target={target} label="A" />,
    );
    expect(screen.queryByTestId("selection-overlay")).not.toBeNull();

    rerender(<SelectionOverlay target={null} label="" />);
    expect(screen.queryByTestId("selection-overlay")).toBeNull();
  });

  it("is aria-hidden so it doesn't pollute the accessibility tree", () => {
    const target = makeTarget({ top: 1, left: 1, width: 1, height: 1 });
    render(<SelectionOverlay target={target} label="A" />);
    const overlay = screen.getByTestId("selection-overlay");
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
  });
});
