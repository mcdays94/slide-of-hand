import { describe, expect, it } from "vitest";
import { buildRegistry } from "@/lib/decks-registry";
import type { Deck } from "@/framework/viewer/types";

/**
 * Synthetic deck factories — produce minimally-valid `Deck` objects whose
 * `meta.slug` matches the provided folder name. The registry's slug-mismatch
 * assertion would throw otherwise.
 */
function deckFor(slug: string, date = "2026-05-01"): Deck {
  return {
    meta: {
      slug,
      title: `Deck ${slug}`,
      description: `A test deck for ${slug}.`,
      date,
    },
    slides: [
      {
        id: "title",
        render: () => null,
      },
    ],
  };
}

function modulesFor(spec: Record<string, Deck>) {
  // Mirrors the shape of `import.meta.glob({ eager: true })`.
  const out: Record<string, { default: Deck }> = {};
  for (const [path, deck] of Object.entries(spec)) {
    out[path] = { default: deck };
  }
  return out;
}

describe("decks-registry — buildRegistry", () => {
  describe("dev mode (prod=false)", () => {
    it("returns BOTH public and private decks", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/index.tsx": deckFor("hello"),
        "/src/decks/private/secret/index.tsx": deckFor("secret"),
      });
      const entries = buildRegistry(modules, false);

      expect(entries).toHaveLength(2);
      const visibilities = entries.map((e) => e.visibility).sort();
      expect(visibilities).toEqual(["private", "public"]);
    });

    it("preserves visibility metadata per entry", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/index.tsx": deckFor("hello"),
        "/src/decks/private/secret/index.tsx": deckFor("secret"),
      });
      const entries = buildRegistry(modules, false);

      const hello = entries.find((e) => e.deck.meta.slug === "hello");
      const secret = entries.find((e) => e.deck.meta.slug === "secret");

      expect(hello?.visibility).toBe("public");
      expect(secret?.visibility).toBe("private");
    });
  });

  describe("prod mode (prod=true)", () => {
    it("excludes private decks entirely", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/index.tsx": deckFor("hello"),
        "/src/decks/private/secret/index.tsx": deckFor("secret"),
        "/src/decks/private/customer-x/index.tsx": deckFor("customer-x"),
      });
      const entries = buildRegistry(modules, true);

      expect(entries).toHaveLength(1);
      expect(entries[0].deck.meta.slug).toBe("hello");
      expect(entries[0].visibility).toBe("public");
    });

    it("returns the empty list when every deck is private", () => {
      const modules = modulesFor({
        "/src/decks/private/secret/index.tsx": deckFor("secret"),
      });
      const entries = buildRegistry(modules, true);
      expect(entries).toEqual([]);
    });
  });

  describe("validation", () => {
    it("throws when meta.slug does not match the folder name", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/index.tsx": deckFor("not-hello"),
      });
      expect(() => buildRegistry(modules, false)).toThrow(/Slug mismatch/);
    });

    it("throws when a module does not default-export a Deck", () => {
      // Bypass the type system — simulate a malformed module shape.
      const modules = {
        "/src/decks/public/hello/index.tsx": { default: {} },
      } as unknown as Record<string, { default: Deck }>;
      expect(() => buildRegistry(modules, false)).toThrow(/does not default-export a Deck/);
    });

    it("ignores paths that don't match the decks pattern", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/index.tsx": deckFor("hello"),
        "/src/decks/public/hello/01-title.tsx": deckFor("hello"), // not an index file
        "/some/other/path.tsx": deckFor("nope"),
      });
      const entries = buildRegistry(modules, false);
      expect(entries).toHaveLength(1);
      expect(entries[0].deck.meta.slug).toBe("hello");
    });
  });

  describe("ordering", () => {
    it("sorts by date descending then by slug", () => {
      const modules = modulesFor({
        "/src/decks/public/older/index.tsx": deckFor("older", "2026-01-01"),
        "/src/decks/public/newer/index.tsx": deckFor("newer", "2026-05-01"),
        "/src/decks/public/aaa-same/index.tsx": deckFor("aaa-same", "2026-05-01"),
      });
      const entries = buildRegistry(modules, false);
      expect(entries.map((e) => e.deck.meta.slug)).toEqual([
        "aaa-same",
        "newer",
        "older",
      ]);
    });
  });
});
