/**
 * Tests for the Marker overlay.
 *
 * - Pressing `E` toggles the canvas in / out
 * - Pressing `Esc` exits when active
 * - Strokes are cleared when the slide-shell's `data-slide-index` changes
 * - Marker host is wrapped in `data-no-advance` to suppress click-to-advance
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Marker } from "./Marker";

function mountSlideShell(index: number) {
  const slide = document.createElement("section");
  slide.setAttribute("data-testid", "slide-shell");
  slide.setAttribute("data-slide-index", String(index));
  // Stub a deterministic getBoundingClientRect (happy-dom returns zeros).
  slide.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
  document.body.appendChild(slide);
  return slide;
}

describe("Marker", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => cleanup());

  it("does not render canvas initially", () => {
    const { queryByTestId } = render(<Marker />);
    expect(queryByTestId("marker-canvas")).toBeNull();
  });

  it("renders canvas after pressing E and removes it on second press", () => {
    mountSlideShell(0);
    const { queryByTestId } = render(<Marker />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    expect(queryByTestId("marker-canvas")).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    expect(queryByTestId("marker-canvas")).toBeNull();
  });

  it("exits marker mode on Escape", () => {
    mountSlideShell(0);
    const { queryByTestId } = render(<Marker />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    expect(queryByTestId("marker-canvas")).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(queryByTestId("marker-canvas")).toBeNull();
  });

  it("wraps the canvas in data-no-advance to suppress click-to-advance", () => {
    mountSlideShell(0);
    const { queryByTestId } = render(<Marker />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    const host = queryByTestId("marker-host");
    expect(host).not.toBeNull();
    expect(host?.hasAttribute("data-no-advance")).toBe(true);
    // Canvas itself should still be a child of the no-advance wrapper.
    expect(host?.querySelector("[data-testid='marker-canvas']")).not.toBeNull();
  });

  it("calls onActiveChange when toggled", () => {
    mountSlideShell(0);
    const onActive = vi.fn();
    render(<Marker onActiveChange={onActive} />);
    expect(onActive).toHaveBeenCalledWith(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    expect(onActive).toHaveBeenLastCalledWith(true);
  });

  it("clears canvas pixels when the slide-shell data-slide-index changes", async () => {
    // happy-dom doesn't implement HTMLCanvasElement.getContext("2d") fully,
    // so we stub it with a recording fake. We assert that the Marker calls
    // clearRect on the recorded fake when the slide index mutates.
    const clearRect = vi.fn();
    const fakeCtx = {
      lineCap: "round",
      lineJoin: "round",
      lineWidth: 0,
      strokeStyle: "",
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clearRect,
    };
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (function () {
      return fakeCtx as unknown as CanvasRenderingContext2D;
    } as unknown) as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const slide = mountSlideShell(0);
      render(<Marker />);
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
      });

      // Trigger a slide-index mutation (the MutationObserver inside Marker
      // listens for attribute changes anywhere under document.body).
      // happy-dom batches MutationObserver callbacks on a microtask queue;
      // we flush by awaiting twice and yielding to the task queue.
      await act(async () => {
        slide.setAttribute("data-slide-index", "1");
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(clearRect).toHaveBeenCalled();
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });
});
