/**
 * Tests for tool-scope helpers (issue #111 items E + F).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  denormalizeCursorFromScope,
  getToolScope,
  hasExplicitToolScope,
  isCursorInScope,
  normalizeCursorToScope,
} from "./useToolScope";

describe("useToolScope helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getToolScope returns the explicit scope element when present", () => {
    const el = document.createElement("div");
    el.setAttribute("data-presenter-tools-scope", "true");
    document.body.appendChild(el);
    expect(getToolScope()).toBe(el);
    expect(hasExplicitToolScope()).toBe(true);
  });

  it("getToolScope falls back to slide-shell when no explicit scope", () => {
    const slide = document.createElement("div");
    slide.setAttribute("data-testid", "slide-shell");
    document.body.appendChild(slide);
    expect(getToolScope()).toBe(slide);
    expect(hasExplicitToolScope()).toBe(false);
  });

  it("getToolScope returns null when nothing is present", () => {
    expect(getToolScope()).toBeNull();
    expect(hasExplicitToolScope()).toBe(false);
  });

  it("isCursorInScope is permissive when scope is null", () => {
    expect(isCursorInScope({ x: 100, y: 200 }, null)).toBe(true);
  });

  it("isCursorInScope returns true when inside the scope's bounding rect", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      right: 500,
      bottom: 400,
      width: 400,
      height: 300,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    expect(isCursorInScope({ x: 200, y: 200 }, el)).toBe(true);
    expect(isCursorInScope({ x: 50, y: 200 }, el)).toBe(false);
    expect(isCursorInScope({ x: 200, y: 500 }, el)).toBe(false);
  });

  it("normalizeCursorToScope returns 0..1 coords inside the scope", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      right: 500,
      bottom: 400,
      width: 400,
      height: 300,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    const norm = normalizeCursorToScope({ x: 300, y: 250 }, el);
    expect(norm).not.toBeNull();
    expect(norm!.x).toBeCloseTo(0.5, 5);
    expect(norm!.y).toBeCloseTo(0.5, 5);
  });

  it("normalizeCursorToScope returns null when cursor is outside scope", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      right: 500,
      bottom: 400,
      width: 400,
      height: 300,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    expect(normalizeCursorToScope({ x: 50, y: 50 }, el)).toBeNull();
    expect(normalizeCursorToScope(null, el)).toBeNull();
    expect(normalizeCursorToScope({ x: 100, y: 100 }, null)).toBeNull();
  });

  it("denormalize is the inverse of normalize", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      right: 500,
      bottom: 500,
      width: 400,
      height: 300,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    } as DOMRect);
    const orig = { x: 0.25, y: 0.75 };
    const screen = denormalizeCursorFromScope(orig, el);
    expect(screen).not.toBeNull();
    // 0.25 * 400 = 100 px from left=100 → x = 200
    // 0.75 * 300 = 225 px from top=200 → y = 425
    expect(screen!.x).toBeCloseTo(200, 5);
    expect(screen!.y).toBeCloseTo(425, 5);
  });
});
