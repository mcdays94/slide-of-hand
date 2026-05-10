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
