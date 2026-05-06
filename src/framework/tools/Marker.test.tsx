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
import {
  computeStrokeOpacity,
  Marker,
  MARKER_FADE_DURATION_MS,
  MARKER_FADE_HOLD_MS,
} from "./Marker";

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

  it("renders canvas while E is held and removes it after the fade window completes", () => {
    vi.useFakeTimers();
    mountSlideShell(0);
    const { queryByTestId } = render(<Marker />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    expect(queryByTestId("marker-canvas")).not.toBeNull();
    // Release E — canvas stays mounted while the fade plays out.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "e" }));
    });
    expect(queryByTestId("marker-canvas")).not.toBeNull();
    // Advance past the unmount timer (hold + fade + 100ms safety buffer).
    act(() => {
      vi.advanceTimersByTime(MARKER_FADE_HOLD_MS + MARKER_FADE_DURATION_MS + 200);
    });
    expect(queryByTestId("marker-canvas")).toBeNull();
    vi.useRealTimers();
  });

  it("exits marker mode on Escape", () => {
    vi.useFakeTimers();
    mountSlideShell(0);
    const { queryByTestId } = render(<Marker />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    expect(queryByTestId("marker-canvas")).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // Esc deactivates and schedules the unmount timer; canvas stays
    // mounted until the fade completes (same as a normal E-up).
    act(() => {
      vi.advanceTimersByTime(MARKER_FADE_HOLD_MS + MARKER_FADE_DURATION_MS + 200);
    });
    expect(queryByTestId("marker-canvas")).toBeNull();
    vi.useRealTimers();
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

  describe("computeStrokeOpacity", () => {
    it("returns 1 while the stroke is still being drawn (releasedAt = null)", () => {
      expect(computeStrokeOpacity(1000, null)).toBe(1);
    });

    it("returns 1 during the hold window after release", () => {
      const released = 1000;
      // Halfway through the hold (hold = MARKER_FADE_HOLD_MS) — still
      // fully opaque. Computed relative to the constant so the test
      // tracks any future timing tweak without manual updates.
      const halfwayThroughHold = released + Math.floor(MARKER_FADE_HOLD_MS / 2);
      expect(computeStrokeOpacity(halfwayThroughHold, released)).toBe(1);
    });

    it("starts fading after the hold window expires", () => {
      const released = 1000;
      // 10% of the way into the fade — opacity should be near 1, well
      // above 0.5.
      const tenPercentIntoFade =
        released + MARKER_FADE_HOLD_MS + Math.floor(MARKER_FADE_DURATION_MS / 10);
      const opacity = computeStrokeOpacity(tenPercentIntoFade, released);
      expect(opacity).toBeGreaterThan(0.85);
      expect(opacity).toBeLessThan(0.95);
    });

    it("returns 0 after the fade window completes", () => {
      const released = 1000;
      const past =
        released + MARKER_FADE_HOLD_MS + MARKER_FADE_DURATION_MS + 1;
      expect(computeStrokeOpacity(past, released)).toBe(0);
    });

    it("uses custom hold and fade durations when provided", () => {
      const released = 1000;
      // hold=100, fade=200; at t = released + 200 we're 100ms into fade,
      // so opacity = 1 - 100/200 = 0.5
      expect(computeStrokeOpacity(released + 200, released, 100, 200)).toBe(
        0.5,
      );
    });
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
