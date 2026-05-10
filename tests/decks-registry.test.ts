import { describe, expect, it } from "vitest";
import { buildLoaderMap, buildRegistry } from "@/lib/decks-registry";
import type { Deck, DeckMeta } from "@/framework/viewer/types";

/**
 * Synthetic meta factories — produce minimally-valid `DeckMeta` objects
 * whose `slug` matches the provided folder name. The registry's
 * slug-mismatch assertion would throw otherwise.
 *
 * Issue #105: `buildRegistry` now operates on the eagerly-loaded `meta.ts`
 * glob, not the lazy `index.tsx` glob. The `slides` array is irrelevant
 * here — it'll be loaded later by `loadDeckBySlug(slug)`.
 */
function metaFor(slug: string, date = "2026-05-01"): DeckMeta {
  return {
    slug,
    title: `Deck ${slug}`,
    description: `A test deck for ${slug}.`,
    date,
  };
}

function modulesFor(spec: Record<string, DeckMeta>) {
  // Mirrors the shape of `import.meta.glob('@/decks/*/meta.ts', { eager: true })`.
  const out: Record<string, { meta: DeckMeta }> = {};
  for (const [path, meta] of Object.entries(spec)) {
    out[path] = { meta };
  }
  return out;
}

describe("decks-registry — buildRegistry", () => {
  describe("dev mode (prod=false)", () => {
    it("returns BOTH public and private decks", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/meta.ts": metaFor("hello"),
        "/src/decks/private/secret/meta.ts": metaFor("secret"),
      });
      const entries = buildRegistry(modules, false);

      expect(entries).toHaveLength(2);
      const visibilities = entries.map((e) => e.visibility).sort();
      expect(visibilities).toEqual(["private", "public"]);
    });

    it("preserves visibility metadata per entry", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/meta.ts": metaFor("hello"),
        "/src/decks/private/secret/meta.ts": metaFor("secret"),
      });
      const entries = buildRegistry(modules, false);

      const hello = entries.find((e) => e.meta.slug === "hello");
      const secret = entries.find((e) => e.meta.slug === "secret");

      expect(hello?.visibility).toBe("public");
      expect(secret?.visibility).toBe("private");
    });
  });

  describe("prod mode (prod=true)", () => {
    it("excludes private decks entirely", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/meta.ts": metaFor("hello"),
        "/src/decks/private/secret/meta.ts": metaFor("secret"),
        "/src/decks/private/customer-x/meta.ts": metaFor("customer-x"),
      });
      const entries = buildRegistry(modules, true);

      expect(entries).toHaveLength(1);
      expect(entries[0].meta.slug).toBe("hello");
      expect(entries[0].visibility).toBe("public");
    });

    it("returns the empty list when every deck is private", () => {
      const modules = modulesFor({
        "/src/decks/private/secret/meta.ts": metaFor("secret"),
      });
      const entries = buildRegistry(modules, true);
      expect(entries).toEqual([]);
    });
  });

  describe("validation", () => {
    it("throws when meta.slug does not match the folder name", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/meta.ts": metaFor("not-hello"),
      });
      expect(() => buildRegistry(modules, false)).toThrow(/Slug mismatch/);
    });

    it("throws when a module does not export a valid meta", () => {
      // Bypass the type system — simulate a malformed module shape.
      const modules = {
        "/src/decks/public/hello/meta.ts": { meta: {} },
      } as unknown as Record<string, { meta: DeckMeta }>;
      expect(() => buildRegistry(modules, false)).toThrow(
        /does not export a valid `meta`/,
      );
    });

    it("ignores paths that don't match the decks pattern", () => {
      const modules = modulesFor({
        "/src/decks/public/hello/meta.ts": metaFor("hello"),
        "/src/decks/public/hello/01-title.tsx": metaFor("hello"), // not a meta file
        "/some/other/path.ts": metaFor("nope"),
      });
      const entries = buildRegistry(modules, false);
      expect(entries).toHaveLength(1);
      expect(entries[0].meta.slug).toBe("hello");
    });
  });

  describe("ordering", () => {
    it("sorts by date descending then by slug", () => {
      const modules = modulesFor({
        "/src/decks/public/older/meta.ts": metaFor("older", "2026-01-01"),
        "/src/decks/public/newer/meta.ts": metaFor("newer", "2026-05-01"),
        "/src/decks/public/aaa-same/meta.ts": metaFor(
          "aaa-same",
          "2026-05-01",
        ),
      });
      const entries = buildRegistry(modules, false);
      expect(entries.map((e) => e.meta.slug)).toEqual([
        "aaa-same",
        "newer",
        "older",
      ]);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildLoaderMap — pure helper that turns Vite's lazy-glob result into a
// slug → loader map. Crucial for issue #105: this is what proves the
// registry never materialises the index.tsx files eagerly.
// ──────────────────────────────────────────────────────────────────────────

describe("decks-registry — buildLoaderMap (issue #105)", () => {
  it("indexes loaders by folder slug", () => {
    const loaders: Record<string, () => Promise<{ default: Deck }>> = {
      "/src/decks/public/hello/index.tsx": () =>
        Promise.resolve({
          default: {
            meta: metaFor("hello"),
            slides: [{ id: "x", render: () => null }],
          },
        }),
      "/src/decks/private/secret/index.tsx": () =>
        Promise.resolve({
          default: {
            meta: metaFor("secret"),
            slides: [{ id: "x", render: () => null }],
          },
        }),
    };
    const map = buildLoaderMap(loaders, false);
    expect(map.has("hello")).toBe(true);
    expect(map.has("secret")).toBe(true);
    expect(map.size).toBe(2);
  });

  it("excludes private loaders in prod mode", () => {
    const loaders: Record<string, () => Promise<{ default: Deck }>> = {
      "/src/decks/public/hello/index.tsx": () =>
        Promise.resolve({
          default: { meta: metaFor("hello"), slides: [] },
        }),
      "/src/decks/private/secret/index.tsx": () =>
        Promise.resolve({
          default: { meta: metaFor("secret"), slides: [] },
        }),
    };
    const map = buildLoaderMap(loaders, true);
    expect(map.has("hello")).toBe(true);
    expect(map.has("secret")).toBe(false);
  });

  it("loaders are NOT invoked at registry-build time (lazy contract)", () => {
    // The whole point of issue #105 is that the index.tsx files — which
    // pull in Three.js, react-three-fiber, topojson, etc. — are NEVER
    // eagerly loaded. We assert that by counting invocations of the
    // loader function: zero before someone calls `loadDeckBySlug`.
    let invocationCount = 0;
    const loaders: Record<string, () => Promise<{ default: Deck }>> = {
      "/src/decks/public/hello/index.tsx": () => {
        invocationCount += 1;
        return Promise.resolve({
          default: { meta: metaFor("hello"), slides: [] },
        });
      },
    };
    const map = buildLoaderMap(loaders, false);
    expect(invocationCount).toBe(0);
    expect(map.has("hello")).toBe(true);
    // Calling the loader explicitly still works — this is what
    // `loadDeckBySlug` does internally.
    const loader = map.get("hello");
    expect(loader).toBeDefined();
    void loader?.();
    expect(invocationCount).toBe(1);
  });

  it("ignores paths that don't match the index pattern", () => {
    const loaders: Record<string, () => Promise<{ default: Deck }>> = {
      "/src/decks/public/hello/01-title.tsx": () =>
        Promise.resolve({
          default: { meta: metaFor("hello"), slides: [] },
        }),
      "/src/decks/public/hello/index.tsx": () =>
        Promise.resolve({
          default: { meta: metaFor("hello"), slides: [] },
        }),
    };
    const map = buildLoaderMap(loaders, false);
    expect(map.size).toBe(1);
    expect(map.has("hello")).toBe(true);
  });
});
