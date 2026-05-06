/**
 * Tests for `useNearViewportTop` and `useNearViewportBottom`.
 *
 * happy-dom doesn't drive a real `mousemove` event flow but it does fire
 * synthetic ones via `window.dispatchEvent(new MouseEvent("mousemove",
 * {...}))`. We use that to simulate cursor movement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useNearViewportBottom,
  useNearViewportTop,
} from "./useNearViewportEdge";

function fireMove(clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));
}

describe("useNearViewportTop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerHeight", {
      value: 1080,
      configurable: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false initially (no mousemove yet)", () => {
    const { result } = renderHook(() => useNearViewportTop());
    expect(result.current).toBe(false);
  });

  it("flips to true when cursor enters the top zone", () => {
    const { result } = renderHook(() => useNearViewportTop({ threshold: 80 }));
    act(() => fireMove(500, 40));
    expect(result.current).toBe(true);
  });

  it("stays false when cursor is below the threshold", () => {
    const { result } = renderHook(() => useNearViewportTop({ threshold: 80 }));
    act(() => fireMove(500, 200));
    expect(result.current).toBe(false);
  });

  it("flips back to false after the hide delay when cursor leaves the zone", () => {
    const { result } = renderHook(() =>
      useNearViewportTop({ threshold: 80, hideAfterMs: 500 }),
    );
    act(() => fireMove(500, 40));
    expect(result.current).toBe(true);

    // Cursor leaves the zone — schedule hide, but isNear still true.
    act(() => fireMove(500, 500));
    expect(result.current).toBe(true);

    // Advance just shy of the delay — still true.
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe(true);

    // Cross the delay — now false.
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe(false);
  });

  it("cancels the pending hide when cursor re-enters the zone", () => {
    const { result } = renderHook(() =>
      useNearViewportTop({ threshold: 80, hideAfterMs: 500 }),
    );
    act(() => fireMove(500, 40));
    act(() => fireMove(500, 500)); // leave zone
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => fireMove(500, 40)); // re-enter
    expect(result.current).toBe(true);

    // Even past the original timer's expiry, we should still be true.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(true);
  });

  it("uses the threshold default of 80 when not specified", () => {
    const { result } = renderHook(() => useNearViewportTop());
    act(() => fireMove(500, 79));
    expect(result.current).toBe(true);
    act(() => fireMove(500, 81));
    // Still true (in hide-delay window).
    expect(result.current).toBe(true);
  });
});

describe("useNearViewportBottom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerHeight", {
      value: 1080,
      configurable: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flips to true when cursor enters the bottom zone", () => {
    const { result } = renderHook(() =>
      useNearViewportBottom({ threshold: 80 }),
    );
    // Bottom of 1080 viewport, threshold 80, so 1000+ counts.
    act(() => fireMove(500, 1010));
    expect(result.current).toBe(true);
  });

  it("stays false in the middle", () => {
    const { result } = renderHook(() =>
      useNearViewportBottom({ threshold: 80 }),
    );
    act(() => fireMove(500, 540));
    expect(result.current).toBe(false);
  });
});
