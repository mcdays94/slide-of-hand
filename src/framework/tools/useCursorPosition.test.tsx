/**
 * Tests for the global cursor-position tracker.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  __resetCursorPositionForTest,
  getCursorPosition,
  useCursorPosition,
} from "./useCursorPosition";

describe("useCursorPosition", () => {
  beforeEach(() => {
    __resetCursorPositionForTest();
  });
  afterEach(() => cleanup());

  it("returns null before any mousemove has been observed", () => {
    expect(getCursorPosition()).toBeNull();
    const { result } = renderHook(() => useCursorPosition());
    expect(result.current).toBeNull();
  });

  it("returns the latest cursor position after a mousemove", () => {
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 123, clientY: 456 }),
      );
    });
    expect(getCursorPosition()).toEqual({ x: 123, y: 456 });
  });

  it("re-renders subscribers on subsequent moves", () => {
    const { result } = renderHook(() => useCursorPosition());
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 10, clientY: 20 }),
      );
    });
    expect(result.current).toEqual({ x: 10, y: 20 });
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 30, clientY: 40 }),
      );
    });
    expect(result.current).toEqual({ x: 30, y: 40 });
  });

  it("synchronously seeds with the latest position at mount", () => {
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 1, clientY: 2 }),
      );
    });
    const { result } = renderHook(() => useCursorPosition());
    expect(result.current).toEqual({ x: 1, y: 2 });
  });
});
