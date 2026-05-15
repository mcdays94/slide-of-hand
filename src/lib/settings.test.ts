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
  AI_ASSISTANT_MODELS,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  readSettings,
  resetSettings,
  writeSettings,
  type AiAssistantModel,
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
      aiAssistantModel: "kimi-k2.6",
      showAssistantReasoning: false,
      tocSidebarEdge: "right",
      showDrafts: true,
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

// ─── aiAssistantModel (issue #131 item A — Workers AI model picker) ──
//
// The in-Studio AI agent's model is selectable from a closed set of
// friendly keys (e.g. "kimi-k2.6"). Friendly keys keep the user-facing
// labels stable across catalog churn — Workers AI model IDs drift
// (kimi-k2.5 deprecation, llama-4-scout addition, etc.) but the
// `<SettingsSegmentedRow>` and any persisted state should keep
// working. The server is the single source of truth for which
// friendly key maps to which catalog ID — see `worker/agent.ts`.
//
// The setting is persisted in localStorage like every other setting.
// Unknown / malformed values fall back to the default so a stale
// localStorage from a future build (with an extra option) or a past
// build (without this option) both degrade gracefully.

describe("aiAssistantModel (issue #131 item A)", () => {
  it("DEFAULT_SETTINGS.aiAssistantModel defaults to 'kimi-k2.6'", () => {
    expect(DEFAULT_SETTINGS.aiAssistantModel).toBe("kimi-k2.6");
  });

  it("exposes AI_ASSISTANT_MODELS with exactly four friendly keys", () => {
    // The set is `kimi-k2.6` (default) + 3 swap-ins. Adding/removing
    // one is a deliberate design change, so this test is here to make
    // that explicit. `gemma-4` was added 2026-05-14 after the e2e
    // marathon confirmed reasoning-class models matter for the
    // deck-files schema.
    expect(AI_ASSISTANT_MODELS).toEqual([
      "kimi-k2.6",
      "llama-4-scout",
      "gpt-oss-120b",
      "gemma-4",
    ]);
  });

  it("readSettings returns the default model when storage is empty", () => {
    expect(readSettings().aiAssistantModel).toBe("kimi-k2.6");
  });

  it("readSettings preserves a persisted valid model key", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ aiAssistantModel: "llama-4-scout" }),
    );
    expect(readSettings().aiAssistantModel).toBe("llama-4-scout");
  });

  it("readSettings preserves each of the AI_ASSISTANT_MODELS keys", () => {
    for (const model of AI_ASSISTANT_MODELS) {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ aiAssistantModel: model }),
      );
      expect(readSettings().aiAssistantModel).toBe(model);
    }
  });

  it("falls back to default when aiAssistantModel is an unknown string", () => {
    // Could happen when a stale localStorage from a future build has
    // an option this build doesn't recognise, or when a user manually
    // edits localStorage.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ aiAssistantModel: "claude-3-opus" }),
    );
    expect(readSettings().aiAssistantModel).toBe("kimi-k2.6");
  });

  it("falls back to default when aiAssistantModel is not a string", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ aiAssistantModel: 42 }),
    );
    expect(readSettings().aiAssistantModel).toBe("kimi-k2.6");
  });

  it("falls back to default when aiAssistantModel is missing entirely", () => {
    // Mirrors a localStorage written by an older build that didn't
    // have this setting. Forward-compat with our own past selves.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSlideIndicators: false }),
    );
    expect(readSettings().aiAssistantModel).toBe("kimi-k2.6");
  });

  it("writeSettings persists aiAssistantModel", () => {
    const merged = writeSettings({
      aiAssistantModel: "gpt-oss-120b" satisfies AiAssistantModel,
    });
    expect(merged.aiAssistantModel).toBe("gpt-oss-120b");
    const persisted = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY)!,
    ) as { aiAssistantModel?: string };
    expect(persisted.aiAssistantModel).toBe("gpt-oss-120b");
  });
});

// ─── showAssistantReasoning (show model thinking in chat) ──────────
// Off-by-default opt-in toggle for rendering the assistant's
// chain-of-thought reasoning parts in the chat panel. Power-user
// reveal; the toggle is invisible in the output of non-reasoning
// models (Kimi K2.6, Llama 4 Scout) since they don't emit reasoning
// parts. Tests mirror the aiAssistantModel block above.
describe("showAssistantReasoning", () => {
  it("DEFAULT_SETTINGS.showAssistantReasoning defaults to false", () => {
    expect(DEFAULT_SETTINGS.showAssistantReasoning).toBe(false);
  });

  it("readSettings returns false when nothing is persisted", () => {
    expect(readSettings().showAssistantReasoning).toBe(false);
  });

  it("readSettings respects a persisted boolean (true)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showAssistantReasoning: true }),
    );
    expect(readSettings().showAssistantReasoning).toBe(true);
  });

  it("readSettings respects a persisted boolean (false)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showAssistantReasoning: false }),
    );
    expect(readSettings().showAssistantReasoning).toBe(false);
  });

  it("falls back to default when showAssistantReasoning is a non-boolean", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showAssistantReasoning: "yes" }),
    );
    expect(readSettings().showAssistantReasoning).toBe(false);
  });

  it("falls back to default when showAssistantReasoning is missing entirely", () => {
    // Forward-compat with older bundles that pre-date this setting.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSlideIndicators: true }),
    );
    expect(readSettings().showAssistantReasoning).toBe(false);
  });

  it("writeSettings persists showAssistantReasoning", () => {
    const merged = writeSettings({ showAssistantReasoning: true });
    expect(merged.showAssistantReasoning).toBe(true);
    const persisted = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY)!,
    ) as { showAssistantReasoning?: boolean };
    expect(persisted.showAssistantReasoning).toBe(true);
  });
});

// ─── tocSidebarEdge (issue #211 — ToC sidebar default edge) ──────────
// Which edge the ToC sidebar opens from when invoked via M-key (or
// any programmatic open that doesn't specify a side). Edge-handle
// clicks always honour the clicked side regardless of this setting —
// `<Deck>`'s `openSidebarFromSide` is the gate. Default `"right"`
// matches the prior single-side behaviour for unchanged users.
describe("tocSidebarEdge (issue #211)", () => {
  it("DEFAULT_SETTINGS.tocSidebarEdge defaults to 'right'", () => {
    expect(DEFAULT_SETTINGS.tocSidebarEdge).toBe("right");
  });

  it("readSettings returns the default tocSidebarEdge when storage is empty", () => {
    expect(readSettings().tocSidebarEdge).toBe("right");
  });

  it("readSettings preserves a persisted 'left' value", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tocSidebarEdge: "left" }),
    );
    expect(readSettings().tocSidebarEdge).toBe("left");
  });

  it("readSettings preserves a persisted 'right' value", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tocSidebarEdge: "right" }),
    );
    expect(readSettings().tocSidebarEdge).toBe("right");
  });

  it("falls back to default when tocSidebarEdge is an unknown string", () => {
    // Mirrors a stale localStorage from a future build with an
    // option this build doesn't recognise.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tocSidebarEdge: "top" }),
    );
    expect(readSettings().tocSidebarEdge).toBe("right");
  });

  it("falls back to default when tocSidebarEdge is not a string", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tocSidebarEdge: 42 }),
    );
    expect(readSettings().tocSidebarEdge).toBe("right");
  });

  it("falls back to default when tocSidebarEdge is missing entirely", () => {
    // Forward-compat with older bundles that pre-date this setting.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSlideIndicators: true }),
    );
    expect(readSettings().tocSidebarEdge).toBe("right");
  });

  it("writeSettings persists tocSidebarEdge", () => {
    const merged = writeSettings({ tocSidebarEdge: "left" });
    expect(merged.tocSidebarEdge).toBe("left");
    const persisted = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY)!,
    ) as { tocSidebarEdge?: string };
    expect(persisted.tocSidebarEdge).toBe("left");
  });

  it("round-trips through writeSettings + readSettings", () => {
    writeSettings({ tocSidebarEdge: "left" });
    expect(readSettings().tocSidebarEdge).toBe("left");
    writeSettings({ tocSidebarEdge: "right" });
    expect(readSettings().tocSidebarEdge).toBe("right");
  });
});

// ─── showDrafts (issue #191 — admin draft filter) ──────────────────
// Toggles whether draft decks (`meta.draft === true`) appear in the
// `/admin` deck grid. Default `true` — admin sees everything by
// default. The setting only governs the admin index; the public
// homepage filter is enforced at the registry layer regardless of
// this preference.
describe("showDrafts (issue #191)", () => {
  it("DEFAULT_SETTINGS.showDrafts defaults to true", () => {
    expect(DEFAULT_SETTINGS.showDrafts).toBe(true);
  });

  it("readSettings returns the default showDrafts when storage is empty", () => {
    expect(readSettings().showDrafts).toBe(true);
  });

  it("readSettings preserves a persisted `false` value", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showDrafts: false }),
    );
    expect(readSettings().showDrafts).toBe(false);
  });

  it("readSettings preserves a persisted `true` value", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showDrafts: true }),
    );
    expect(readSettings().showDrafts).toBe(true);
  });

  it("falls back to default when showDrafts is not a boolean", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showDrafts: "yes" }),
    );
    expect(readSettings().showDrafts).toBe(true);
  });

  it("falls back to default when showDrafts is missing entirely", () => {
    // Forward-compat with older bundles that pre-date this setting.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSlideIndicators: false }),
    );
    expect(readSettings().showDrafts).toBe(true);
  });

  it("writeSettings persists showDrafts", () => {
    const merged = writeSettings({ showDrafts: false });
    expect(merged.showDrafts).toBe(false);
    const persisted = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY)!,
    ) as { showDrafts?: boolean };
    expect(persisted.showDrafts).toBe(false);
  });

  it("round-trips through writeSettings + readSettings", () => {
    writeSettings({ showDrafts: false });
    expect(readSettings().showDrafts).toBe(false);
    writeSettings({ showDrafts: true });
    expect(readSettings().showDrafts).toBe(true);
  });
});
