/**
 * Tests for the notes localStorage helpers (issue #111 item G).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearNotesOverride,
  notesStorageKey,
  readNotesOverride,
  writeNotesOverride,
} from "./notes-storage";

describe("notes-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("notesStorageKey produces the documented shape", () => {
    expect(notesStorageKey("hello", 0)).toBe("slide-of-hand-notes:hello:0");
    expect(notesStorageKey("cf-zt-ai", 7)).toBe(
      "slide-of-hand-notes:cf-zt-ai:7",
    );
  });

  it("returns null when nothing is stored", () => {
    expect(readNotesOverride("hello", 0)).toBeNull();
  });

  it("write + read round-trips", () => {
    writeNotesOverride("hello", 0, "**Bold**");
    expect(readNotesOverride("hello", 0)).toBe("**Bold**");
  });

  it("write empty string clears the entry", () => {
    writeNotesOverride("hello", 0, "first");
    writeNotesOverride("hello", 0, "");
    expect(readNotesOverride("hello", 0)).toBeNull();
  });

  it("clearNotesOverride removes the entry", () => {
    writeNotesOverride("hello", 0, "x");
    clearNotesOverride("hello", 0);
    expect(readNotesOverride("hello", 0)).toBeNull();
  });

  it("scopes by slug + slide index", () => {
    writeNotesOverride("a", 0, "alpha");
    writeNotesOverride("a", 1, "beta");
    writeNotesOverride("b", 0, "gamma");
    expect(readNotesOverride("a", 0)).toBe("alpha");
    expect(readNotesOverride("a", 1)).toBe("beta");
    expect(readNotesOverride("b", 0)).toBe("gamma");
  });
});
