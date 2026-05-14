/**
 * Tests for `useToCEdgeHover` — proximity detection for the ToC sidebar's
 * left/right floating edge handles (#210).
 *
 * The hook mirrors the pattern of `useNearViewportEdge` but watches
 * BOTH horizontal edges in a single listener and honours four
 * suppression flags so callers can centralise the "is the chrome free
 * to show?" decision.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useToCEdgeHover } from "./useToCEdgeHover";

function fireMove(clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));
}

describe("useToCEdgeHover", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      value: 1920,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 1080,
      configurable: true,
    });
  });

  it("returns { leftHover: false, rightHover: false } initially", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    expect(result.current).toEqual({ leftHover: false, rightHover: false });
  });

  it("flips leftHover true when cursor enters the left edge zone", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    act(() => fireMove(5, 540));
    expect(result.current.leftHover).toBe(true);
    expect(result.current.rightHover).toBe(false);
  });

  it("flips rightHover true when cursor enters the right edge zone", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    // innerWidth 1920, threshold 12, so x >= 1908 is the zone.
    act(() => fireMove(1915, 540));
    expect(result.current.rightHover).toBe(true);
    expect(result.current.leftHover).toBe(false);
  });

  it("flips back to false when cursor leaves the zone", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    act(() => fireMove(5, 540));
    expect(result.current.leftHover).toBe(true);

    act(() => fireMove(500, 540));
    expect(result.current.leftHover).toBe(false);
  });

  it("respects the 12px proximity threshold for left", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    act(() => fireMove(11, 540));
    expect(result.current.leftHover).toBe(true);
    act(() => fireMove(13, 540));
    expect(result.current.leftHover).toBe(false);
  });

  it("respects the 12px proximity threshold for right", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    // innerWidth 1920, x > 1908 is the zone.
    act(() => fireMove(1909, 540));
    expect(result.current.rightHover).toBe(true);
    act(() => fireMove(1907, 540));
    expect(result.current.rightHover).toBe(false);
  });

  it("suppresses both hovers when toolActive is true", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: true,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    act(() => fireMove(5, 540));
    expect(result.current).toEqual({ leftHover: false, rightHover: false });
    act(() => fireMove(1915, 540));
    expect(result.current).toEqual({ leftHover: false, rightHover: false });
  });

  it("suppresses both hovers when modalOpen is true", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: true,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    act(() => fireMove(5, 540));
    expect(result.current).toEqual({ leftHover: false, rightHover: false });
    act(() => fireMove(1915, 540));
    expect(result.current).toEqual({ leftHover: false, rightHover: false });
  });

  it("suppresses both hovers when sidebarOpen is true", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: true,
        fullscreen: false,
      }),
    );
    act(() => fireMove(5, 540));
    expect(result.current).toEqual({ leftHover: false, rightHover: false });
    act(() => fireMove(1915, 540));
    expect(result.current).toEqual({ leftHover: false, rightHover: false });
  });

  it("in fullscreen, suppresses hover unless cursor is literally at the edge", () => {
    // In fullscreen the threshold collapses to 0 — only clientX === 0
    // or clientX === innerWidth - 1 qualifies. This catches sub-pixel
    // proximity browser quirks that flicker the handle during a
    // fullscreen talk.
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: true,
      }),
    );
    // 5px in — within the normal 12px zone, but suppressed in fullscreen.
    act(() => fireMove(5, 540));
    expect(result.current.leftHover).toBe(false);
    // Literally at the edge — allowed.
    act(() => fireMove(0, 540));
    expect(result.current.leftHover).toBe(true);
    // Other edge.
    act(() => fireMove(1915, 540));
    expect(result.current.rightHover).toBe(false);
    act(() => fireMove(1919, 540));
    expect(result.current.rightHover).toBe(true);
  });

  it("clears hover when a suppression flag flips on while in zone", () => {
    const { result, rerender } = renderHook(
      ({ toolActive }: { toolActive: boolean }) =>
        useToCEdgeHover({
          toolActive,
          modalOpen: false,
          sidebarOpen: false,
          fullscreen: false,
        }),
      { initialProps: { toolActive: false } },
    );
    act(() => fireMove(5, 540));
    expect(result.current.leftHover).toBe(true);
    // Tool activates while cursor stays at the edge — both should clear.
    rerender({ toolActive: true });
    expect(result.current).toEqual({ leftHover: false, rightHover: false });
  });

  it("only one side is true at a time (cursor can't be at both edges)", () => {
    const { result } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    act(() => fireMove(5, 540));
    expect(result.current).toEqual({ leftHover: true, rightHover: false });
    act(() => fireMove(1915, 540));
    expect(result.current).toEqual({ leftHover: false, rightHover: true });
  });

  it("cleans up the mousemove listener on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() =>
      useToCEdgeHover({
        toolActive: false,
        modalOpen: false,
        sidebarOpen: false,
        fullscreen: false,
      }),
    );
    const moveCalls = addSpy.mock.calls.filter((c) => c[0] === "mousemove");
    expect(moveCalls.length).toBeGreaterThan(0);
    unmount();
    const removeCalls = removeSpy.mock.calls.filter(
      (c) => c[0] === "mousemove",
    );
    expect(removeCalls.length).toBeGreaterThan(0);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
