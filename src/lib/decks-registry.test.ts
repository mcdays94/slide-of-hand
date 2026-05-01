/**
 * Tests for the deck registry's pure transformation step.
 *
 * The real registry calls `import.meta.glob` at module import time; rather
 * than mock that, we expose `buildRegistry()` which takes the same shape and
 * apply our assertions on it directly.
 */

import { describe, expect, it } from "vitest";
import { buildRegistry } from "./decks-registry";
import type { Deck } from "@/framework/viewer/types";

const stubSlide = {
  id: "stub",
  render: () => null,
};

const makeDeck = (slug: string, date: string): Deck => ({
  meta: { slug, title: slug, description: "x", date },
  slides: [stubSlide],
});

describe("buildRegistry", () => {
  it("discovers decks from public + private paths", () => {
    const result = buildRegistry({
      "/src/decks/public/alpha/index.tsx": { default: makeDeck("alpha", "2026-01-01") },
      "/src/decks/private/secret/index.tsx": { default: makeDeck("secret", "2026-02-01") },
    });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.deck.meta.slug).sort()).toEqual([
      "alpha",
      "secret",
    ]);
    expect(
      result.find((e) => e.folder === "secret")?.visibility,
    ).toBe("private");
  });

  it("sorts by date descending", () => {
    const result = buildRegistry({
      "/src/decks/public/older/index.tsx": { default: makeDeck("older", "2025-06-01") },
      "/src/decks/public/newer/index.tsx": { default: makeDeck("newer", "2026-06-01") },
    });
    expect(result.map((e) => e.deck.meta.slug)).toEqual(["newer", "older"]);
  });

  it("throws when meta.slug does not match the folder name", () => {
    expect(() =>
      buildRegistry({
        "/src/decks/public/foo/index.tsx": { default: makeDeck("bar", "2026-01-01") },
      }),
    ).toThrow(/Slug mismatch/);
  });

  it("throws when default export is not a Deck", () => {
    expect(() =>
      buildRegistry({
        "/src/decks/public/foo/index.tsx": { default: {} as Deck },
      }),
    ).toThrow(/does not default-export a Deck/);
  });

  it("ignores paths that don't match the registry pattern", () => {
    const result = buildRegistry({
      "/src/decks/public/foo/helper.tsx": { default: makeDeck("foo", "2026-01-01") },
    });
    expect(result).toHaveLength(0);
  });
});
