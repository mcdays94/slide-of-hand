/**
 * Tests for `useViewPreference` (issue #127).
 *
 * The hook persists per-surface (`public` vs `admin`) Grid/List choice in
 * localStorage. Both surfaces share the same key namespace prefix
 * (`slide-of-hand:view-preference:`) but each gets its own slot so the
 * homepage and the Studio remember independently.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useViewPreference } from "./use-view-preference";

const PUBLIC_KEY = "slide-of-hand:view-preference:public";
const ADMIN_KEY = "slide-of-hand:view-preference:admin";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useViewPreference", () => {
  it('defaults to "grid" when nothing is stored', () => {
    const { result } = renderHook(() => useViewPreference("public"));
    expect(result.current.mode).toBe("grid");
  });

  it("reads the stored value on mount", () => {
    window.localStorage.setItem(PUBLIC_KEY, "list");
    const { result } = renderHook(() => useViewPreference("public"));
    expect(result.current.mode).toBe("list");
  });

  it("persists the chosen mode to localStorage on setMode", () => {
    const { result } = renderHook(() => useViewPreference("public"));
    act(() => result.current.setMode("list"));
    expect(result.current.mode).toBe("list");
    expect(window.localStorage.getItem(PUBLIC_KEY)).toBe("list");
  });

  it("namespaces public and admin separately", () => {
    window.localStorage.setItem(PUBLIC_KEY, "list");
    window.localStorage.setItem(ADMIN_KEY, "grid");
    const pub = renderHook(() => useViewPreference("public"));
    const adm = renderHook(() => useViewPreference("admin"));
    expect(pub.result.current.mode).toBe("list");
    expect(adm.result.current.mode).toBe("grid");
  });

  it("ignores unknown stored values and falls back to grid", () => {
    window.localStorage.setItem(PUBLIC_KEY, "scribble");
    const { result } = renderHook(() => useViewPreference("public"));
    expect(result.current.mode).toBe("grid");
  });

  it("setMode round-trips both ways", () => {
    const { result } = renderHook(() => useViewPreference("admin"));
    act(() => result.current.setMode("list"));
    expect(result.current.mode).toBe("list");
    act(() => result.current.setMode("grid"));
    expect(result.current.mode).toBe("grid");
    expect(window.localStorage.getItem(ADMIN_KEY)).toBe("grid");
  });
});
