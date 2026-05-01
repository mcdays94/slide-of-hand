/**
 * Tests for the pure magnifier-placement math.
 *
 * The math has two responsibilities:
 *  1. Position the overlay so its center sits at the cursor.
 *  2. Offset the inner clone so the slide-relative point under the cursor
 *     lands at the overlay's center after `transform: scale(zoom)`.
 */

import { describe, expect, it } from "vitest";
import {
  MAGNIFIER_SIZE,
  MAGNIFIER_ZOOM,
  computeMagnifierPlacement,
  type SlideRect,
} from "./magnifierMath";

const slide: SlideRect = { left: 100, top: 50, width: 1920, height: 1080 };

describe("computeMagnifierPlacement", () => {
  it("centers the overlay on the cursor", () => {
    const result = computeMagnifierPlacement(500, 400, slide);
    expect(result.left).toBe(500 - MAGNIFIER_SIZE / 2);
    expect(result.top).toBe(400 - MAGNIFIER_SIZE / 2);
  });

  it("places the cursor's slide point at the overlay center after scaling", () => {
    // Cursor at slide-local (400, 350). After scaling by 2, that point is at
    // (800, 700) within the scaled clone. To put it at overlay center
    // (125, 125), the clone offset must be (125-800, 125-700) = (-675, -575).
    const result = computeMagnifierPlacement(500, 400, slide);
    const localX = 500 - slide.left; // 400
    const localY = 400 - slide.top; // 350
    expect(result.cloneOriginX).toBe(MAGNIFIER_SIZE / 2 - localX * MAGNIFIER_ZOOM);
    expect(result.cloneOriginY).toBe(MAGNIFIER_SIZE / 2 - localY * MAGNIFIER_ZOOM);
  });

  it("respects custom zoom + size parameters", () => {
    const result = computeMagnifierPlacement(200, 150, slide, 3, 100);
    expect(result.left).toBe(200 - 50);
    expect(result.top).toBe(150 - 50);
    // localX = 100, localY = 100; scaled by 3 → (300,300); offset to (50,50)
    expect(result.cloneOriginX).toBe(50 - 100 * 3);
    expect(result.cloneOriginY).toBe(50 - 100 * 3);
  });

  it("produces same overlay-center mapping when cursor is at slide origin", () => {
    const result = computeMagnifierPlacement(slide.left, slide.top, slide);
    // localX=0, localY=0 → clone offset is exactly half size both axes.
    expect(result.cloneOriginX).toBe(MAGNIFIER_SIZE / 2);
    expect(result.cloneOriginY).toBe(MAGNIFIER_SIZE / 2);
  });
});
