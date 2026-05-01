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
 *   - Private decks are gitignored and only present in dev. The admin viewer
 *     resolves both via `getAllDecks()` / `getAllDeckEntries()`; the public
 *     index page uses `getPublicDecks()`.
 *
 * Production exclusion:
 *   - When `import.meta.env.PROD` is true (i.e. `npm run build`), private
 *     entries are dropped from the registry at module-load time. This means
 *     the deployed bundle has no path that references a private deck, even
 *     under `/admin/decks/<slug>` — they're effectively non-existent in
 *     production. The Cloudflare Access gate on `/admin/*` (slice #8) is
 *     defence-in-depth on top of this.
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
 *
 * When `prod` is true, private entries are filtered out — this mirrors what
 * the deployed bundle sees. (In dev, both visibilities are returned so the
 * admin route can list every locally-available deck.)
 */
export function buildRegistry(
  modules: GlobResult,
  prod = false,
): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const match = PATH_RE.exec(path);
    if (!match) continue;
    const [, visibility, folder] = match;
    if (prod && visibility === "private") continue;
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

/**
 * Two separate globs — each is a literal-string call (Vite's static analyser
 * requires that). The private glob is gated behind `import.meta.env.PROD`,
 * which Vite replaces with the literal `true` / `false` at build time. With
 * `false` (production), the ternary statically resolves to `{}` and Vite's
 * dead-code elimination drops every `@/decks/private/*` import from the
 * bundle. In dev mode `false` is the value, so `import.meta.env.PROD` is
 * `false`, both globs run, and the registry sees public + private decks.
 *
 * (`import.meta.env.PROD` is `true` only inside `vite build`, never under
 * `vite` / `vitest`.)
 */
const publicModules = import.meta.glob(
  "@/decks/public/*/index.tsx",
  { eager: true },
) as GlobResult;

const privateModules = import.meta.env.PROD
  ? ({} as GlobResult)
  : (import.meta.glob("@/decks/private/*/index.tsx", {
      eager: true,
    }) as GlobResult);

const modules: GlobResult = { ...publicModules, ...privateModules };

const registry = buildRegistry(modules, import.meta.env.PROD);

/** Every discovered deck — public + private in dev; public only in prod. */
export function getAllDecks(): Deck[] {
  return registry.map((e) => e.deck);
}

/**
 * Every discovered registry entry (with visibility info). Use for the admin
 * deck list, which renders a visibility badge per row.
 */
export function getAllDeckEntries(): RegistryEntry[] {
  return registry;
}

/** Public decks only. Use for the public index page. */
export function getPublicDecks(): Deck[] {
  return registry.filter((e) => e.visibility === "public").map((e) => e.deck);
}

/** Resolve a single deck by slug (public or private in dev; public only in prod). */
export function getDeckBySlug(slug: string): Deck | undefined {
  return registry.find((e) => e.deck.meta.slug === slug)?.deck;
}
