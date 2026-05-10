/**
 * Tests for `src/lib/settings.ts` — localStorage-backed viewer settings.
 *
 * Covers:
 *   - `readSettings()` returns defaults when storage is empty.
 *   - `writeSettings(partial)` merges with current state + persists.
 *   - Invalid JSON in storage degrades to defaults (no throw).
 *   - A storage that throws on access degrades to defaults.
 *   - `resetSettings()` wipes the persisted blob.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  readSettings,
  resetSettings,
  writeSettings,
} from "./settings";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("readSettings()", () => {
  it("returns DEFAULT_SETTINGS when storage is empty", () => {
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("returns merged values when storage has a partial blob", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSlideIndicators: false }),
    );
    const result = readSettings();
    expect(result.showSlideIndicators).toBe(false);
  });

  it("returns DEFAULT_SETTINGS when storage holds invalid JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not-json");
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("returns DEFAULT_SETTINGS when stored value isn't an object", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores keys whose types don't match the default's type", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSlideIndicators: "yes-please" }),
    );
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults when localStorage.getItem throws", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error("denied");
    });
    try {
      expect(readSettings()).toEqual(DEFAULT_SETTINGS);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("writeSettings()", () => {
  it("persists the merged settings under STORAGE_KEY", () => {
    const merged = writeSettings({ showSlideIndicators: false });
    expect(merged.showSlideIndicators).toBe(false);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      showSlideIndicators: false,
      presenterNextSlideShowsFinalPhase: false,
      notesDefaultMode: "rich",
      deckCardHoverAnimation: { enabled: true, slideCount: 3 },
    });
  });

  it("merges with existing persisted settings (does not clobber other keys)", () => {
    // Seed storage with an extra (unknown) key — we expect future v2
    // settings to coexist; writeSettings merges via current Settings.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSlideIndicators: false }),
    );
    const result = writeSettings({});
    expect(result.showSlideIndicators).toBe(false);
  });

  it("returns merged settings even when storage.setItem throws", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    try {
      const merged = writeSettings({ showSlideIndicators: false });
      expect(merged.showSlideIndicators).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("resetSettings()", () => {
  it("wipes the persisted blob and returns DEFAULT_SETTINGS", () => {
    writeSettings({ showSlideIndicators: false });
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    const result = resetSettings();
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("deckCardHoverAnimation (issue #128)", () => {
  it("DEFAULT_SETTINGS.deckCardHoverAnimation defaults to enabled=true, slideCount=3", () => {
    expect(DEFAULT_SETTINGS.deckCardHoverAnimation).toEqual({
      enabled: true,
      slideCount: 3,
    });
  });

  it("readSettings returns the default deckCardHoverAnimation when storage is empty", () => {
    expect(readSettings().deckCardHoverAnimation).toEqual({
      enabled: true,
      slideCount: 3,
    });
  });

  it("readSettings restores a persisted partial deckCardHoverAnimation", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        deckCardHoverAnimation: { enabled: false, slideCount: 5 },
      }),
    );
    expect(readSettings().deckCardHoverAnimation).toEqual({
      enabled: false,
      slideCount: 5,
    });
  });

  it("falls back to defaults when deckCardHoverAnimation is not an object", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ deckCardHoverAnimation: 42 }),
    );
    expect(readSettings().deckCardHoverAnimation).toEqual({
      enabled: true,
      slideCount: 3,
    });
  });

  it("falls back to default when deckCardHoverAnimation is null", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ deckCardHoverAnimation: null }),
    );
    expect(readSettings().deckCardHoverAnimation).toEqual({
      enabled: true,
      slideCount: 3,
    });
  });

  it("uses default `enabled` when missing", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ deckCardHoverAnimation: { slideCount: 5 } }),
    );
    expect(readSettings().deckCardHoverAnimation).toEqual({
      enabled: true,
      slideCount: 5,
    });
  });

  it("uses default `enabled` when type mismatch (not boolean)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        deckCardHoverAnimation: { enabled: "yes", slideCount: 2 },
      }),
    );
    expect(readSettings().deckCardHoverAnimation).toEqual({
      enabled: true,
      slideCount: 2,
    });
  });

  it("uses default `slideCount` when missing", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ deckCardHoverAnimation: { enabled: false } }),
    );
    expect(readSettings().deckCardHoverAnimation).toEqual({
      enabled: false,
      slideCount: 3,
    });
  });

  it("uses default `slideCount` when type mismatch (not number)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        deckCardHoverAnimation: { enabled: true, slideCount: "five" },
      }),
    );
    expect(readSettings().deckCardHoverAnimation).toEqual({
      enabled: true,
      slideCount: 3,
    });
  });

  it("clamps slideCount to 1 when below the allowed range", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        deckCardHoverAnimation: { enabled: true, slideCount: 0 },
      }),
    );
    expect(readSettings().deckCardHoverAnimation.slideCount).toBe(1);
  });

  it("clamps slideCount to 8 when above the allowed range", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        deckCardHoverAnimation: { enabled: true, slideCount: 99 },
      }),
    );
    expect(readSettings().deckCardHoverAnimation.slideCount).toBe(8);
  });

  it("rounds non-integer slideCount values", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        deckCardHoverAnimation: { enabled: true, slideCount: 4.7 },
      }),
    );
    expect(readSettings().deckCardHoverAnimation.slideCount).toBe(5);
  });

  it("writeSettings persists deckCardHoverAnimation", () => {
    const merged = writeSettings({
      deckCardHoverAnimation: { enabled: false, slideCount: 6 },
    });
    expect(merged.deckCardHoverAnimation).toEqual({
      enabled: false,
      slideCount: 6,
    });
    const persisted = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY)!,
    ) as { deckCardHoverAnimation: { enabled: boolean; slideCount: number } };
    expect(persisted.deckCardHoverAnimation).toEqual({
      enabled: false,
      slideCount: 6,
    });
  });
});
