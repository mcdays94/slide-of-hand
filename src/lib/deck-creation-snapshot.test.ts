/**
 * Tests for the shared `DeckCreationSnapshot` / `DeckDraftToolResult`
 * wire types and their discriminating type guards.
 *
 * Most of the contract is structural (the worker orchestrators rely
 * on the shape compiling), but the guards
 * (`isDeckCreationSnapshot` / `isDeckDraftToolResult`) need real
 * runtime checks — they're how the canvas discriminates the
 * streaming union (`"ok" in value`) at every yield.
 *
 * Issue #271 added optional preview fields to BOTH the streaming
 * snapshot and the final lean tool-success branch. These tests pin
 * that:
 *
 *   - The discriminating guards still match on `"ok" in value` and
 *     not on the new preview fields (a snapshot that happens to
 *     carry `previewStatus` is STILL a snapshot — it has no `ok`).
 *   - The optional fields are accepted by the type system and
 *     round-trip through the guards correctly.
 */
import { describe, it, expect } from "vitest";

import {
  isDeckCreationSnapshot,
  isDeckDraftToolResult,
  type DeckCreationSnapshot,
  type DeckDraftToolError,
  type DeckDraftToolSuccess,
} from "./deck-creation-snapshot";

describe("isDeckCreationSnapshot", () => {
  it("accepts a snapshot with no preview fields (backwards compat)", () => {
    const snap: DeckCreationSnapshot = {
      phase: "ai_gen",
      files: [],
      draftId: "alice-my",
    };
    expect(isDeckCreationSnapshot(snap)).toBe(true);
  });

  it("accepts a snapshot carrying previewStatus: 'building'", () => {
    const snap: DeckCreationSnapshot = {
      phase: "done",
      files: [],
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
      draftId: "alice-my",
      previewStatus: "building",
    };
    expect(isDeckCreationSnapshot(snap)).toBe(true);
  });

  it("accepts a snapshot carrying previewStatus: 'ready' + previewUrl", () => {
    const snap: DeckCreationSnapshot = {
      phase: "done",
      files: [],
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
      draftId: "alice-my",
      previewStatus: "ready",
      previewUrl: "/preview/pv_0123456789abcdef/abc1234/index.html",
      previewUploadedFiles: 14,
    };
    expect(isDeckCreationSnapshot(snap)).toBe(true);
  });

  it("accepts a snapshot carrying previewStatus: 'error' + previewError", () => {
    const snap: DeckCreationSnapshot = {
      phase: "done",
      files: [],
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
      draftId: "alice-my",
      previewStatus: "error",
      previewError: "vite build failed (exit 1).",
    };
    expect(isDeckCreationSnapshot(snap)).toBe(true);
  });

  it("rejects a lean tool result (has `ok`)", () => {
    const lean: DeckDraftToolSuccess = {
      ok: true,
      draftId: "alice-my",
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
      branch: "main",
      fileCount: 3,
      commitMessage: "Initial",
    };
    expect(isDeckCreationSnapshot(lean)).toBe(false);
  });

  it("rejects a lean tool error (has `ok`)", () => {
    const lean: DeckDraftToolError = {
      ok: false,
      phase: "ai_generation",
      error: "model timed out",
    };
    expect(isDeckCreationSnapshot(lean)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isDeckCreationSnapshot(undefined)).toBe(false);
  });
});

describe("isDeckDraftToolResult", () => {
  it("accepts a lean success result with no preview fields (backwards compat)", () => {
    const lean: DeckDraftToolSuccess = {
      ok: true,
      draftId: "alice-my",
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
      branch: "main",
      fileCount: 3,
      commitMessage: "Initial",
    };
    expect(isDeckDraftToolResult(lean)).toBe(true);
  });

  it("accepts a lean success result with previewStatus: 'ready' + previewUrl", () => {
    const lean: DeckDraftToolSuccess = {
      ok: true,
      draftId: "alice-my",
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
      branch: "main",
      fileCount: 3,
      commitMessage: "Initial",
      previewStatus: "ready",
      previewUrl: "/preview/pv_0123456789abcdef/abc1234/index.html",
      previewUploadedFiles: 14,
    };
    expect(isDeckDraftToolResult(lean)).toBe(true);
  });

  it("accepts a lean success result with previewStatus: 'error' + previewError", () => {
    const lean: DeckDraftToolSuccess = {
      ok: true,
      draftId: "alice-my",
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
      branch: "main",
      fileCount: 3,
      commitMessage: "Initial",
      previewStatus: "error",
      previewError: "vite build failed (exit 1).",
    };
    expect(isDeckDraftToolResult(lean)).toBe(true);
  });

  it("rejects a snapshot (no `ok`)", () => {
    const snap: DeckCreationSnapshot = {
      phase: "done",
      files: [],
      previewStatus: "ready",
      previewUrl: "/preview/pv_x/abc/index.html",
    };
    expect(isDeckDraftToolResult(snap)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isDeckDraftToolResult(undefined)).toBe(false);
  });
});
