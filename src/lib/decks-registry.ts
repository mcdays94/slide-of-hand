/**
 * Deck registry — `import.meta.glob`-driven auto-discovery.
 *
 * Every `src/decks/{public,private}/<slug>/index.tsx` that default-exports a
 * `Deck` is picked up. There is no central registration list; just drop a
 * folder in and the index page sees it on next reload.
 *
 * Build-time integrity:
 *   - `meta.slug` MUST match the folder name. We assert this loudly so a
 *     stale rename can't silently break URLs.
 *
 * Public vs private:
 *   - Public decks ship in the deployed bundle and appear at `/`.
 *   - Private decks are gitignored and only present in dev. The viewer route
 *     resolves both via `getAllDecks()`; the index page uses `getPublicDecks()`.
 */

import type { Deck } from "@/framework/viewer/types";

type GlobModule = { default: Deck };
type GlobResult = Record<string, GlobModule>;

const PATH_RE = /\/decks\/(public|private)\/([^/]+)\/index\.tsx?$/;

export interface RegistryEntry {
  visibility: "public" | "private";
  folder: string;
  deck: Deck;
}

/**
 * Pure transformation from a glob result into a sorted, validated entry list.
 *
 * Exported so tests can pass synthetic glob results without spinning up Vite.
 */
export function buildRegistry(modules: GlobResult): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const match = PATH_RE.exec(path);
    if (!match) continue;
    const [, visibility, folder] = match;
    const deck = mod.default;
    if (!deck || !deck.meta || !Array.isArray(deck.slides)) {
      throw new Error(
        `[decks-registry] ${path} does not default-export a Deck (expected { meta, slides }).`,
      );
    }
    if (deck.meta.slug !== folder) {
      throw new Error(
        `[decks-registry] Slug mismatch in ${path}: meta.slug="${deck.meta.slug}" but folder is "${folder}". They MUST match.`,
      );
    }
    entries.push({
      visibility: visibility as "public" | "private",
      folder,
      deck,
    });
  }
  // Sort by date descending (newest first); fall back to slug for stable order.
  entries.sort((a, b) => {
    const da = a.deck.meta.date;
    const db = b.deck.meta.date;
    if (da === db) return a.deck.meta.slug.localeCompare(b.deck.meta.slug);
    return db.localeCompare(da);
  });
  return entries;
}

const modules = import.meta.glob("@/decks/{public,private}/*/index.tsx", {
  eager: true,
}) as GlobResult;

const registry = buildRegistry(modules);

/** Every discovered deck — public + private. Use for the viewer route. */
export function getAllDecks(): Deck[] {
  return registry.map((e) => e.deck);
}

/** Public decks only. Use for the index page. */
export function getPublicDecks(): Deck[] {
  return registry.filter((e) => e.visibility === "public").map((e) => e.deck);
}

/** Resolve a single deck by slug (public or private). Returns undefined when missing. */
export function getDeckBySlug(slug: string): Deck | undefined {
  return registry.find((e) => e.deck.meta.slug === slug)?.deck;
}
