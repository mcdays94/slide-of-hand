/**
 * Deck registry — `import.meta.glob`-driven auto-discovery PLUS KV-backed
 * data decks (Slice 5 / #61).
 *
 * Two sources of truth:
 *
 *   1. Build-time decks. Every `src/decks/{public,private}/<slug>/index.tsx`
 *      that default-exports a `Deck` is picked up. There is no central
 *      registration list; just drop a folder in and the index page sees it
 *      on next reload. `meta.slug` MUST match the folder name.
 *
 *   2. KV-backed data decks. The Worker exposes `GET /api/decks` (public
 *      summaries) and `GET /api/decks/<slug>` (full record). The hooks in
 *      this module fetch them at runtime. KV decks created via the Slice
 *      6+ editor land here without any redeploy.
 *
 * Public vs private:
 *   - Public source decks ship in the deployed bundle and appear at `/`.
 *   - Private source decks are gitignored and only present in dev. The
 *     admin viewer resolves both via `getAllDecks()` / `getAllDeckEntries()`;
 *     the public index page uses `getPublicDecks()`.
 *   - KV decks carry their own `visibility` flag. The `/api/decks` listing
 *     only ever returns `public` summaries (the Worker filters on the
 *     server side); this module also defensively re-filters on the client
 *     (defense-in-depth in case the Worker's logic ever changes).
 *
 * Production exclusion (build-time):
 *   - When `import.meta.env.PROD` is true (i.e. `npm run build`), private
 *     entries are dropped from the registry at module-load time.
 *
 * Precedence (Slice 5):
 *   - On slug collision, BUILD-TIME wins. The KV entry is silently dropped
 *     from the merged list. This is the only sane policy: a code-defined
 *     deck has stronger ownership semantics (someone consciously wrote a
 *     module file vs. a one-off KV write that may have been accidental).
 */

import { useCallback, useEffect, useState } from "react";
import type { Deck, DeckMeta } from "@/framework/viewer/types";
import type { DataDeck, DataDeckMeta, Visibility } from "./deck-record";

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

// ──────────────────────────────────────────────────────────────────────────
// KV-backed deck list (Slice 5 / #61)
//
// `useDataDeckList` and `useDataDeck` hit `/api/decks` and
// `/api/decks/<slug>` respectively. Both bypass the browser HTTP cache
// (the endpoints set `private, max-age=60` for per-browser caching, but
// the author flow expects Save → reload to feel instant — same
// rationale as `useDeckTheme` and `useElementOverrides`).
// ──────────────────────────────────────────────────────────────────────────

/**
 * Public-summary shape returned by `GET /api/decks`. Mirrors
 * `worker/decks.ts`'s `DeckSummary`. Inlined here (rather than imported
 * across the worker boundary) because `tsconfig.app.json` doesn't include
 * `worker/`. The schema is the public wire contract for the endpoint —
 * if it changes here, change it in the Worker too.
 */
export interface DataDeckSummary {
  slug: string;
  title: string;
  description?: string;
  date: string;
  cover?: string;
  visibility: Visibility;
  runtimeMinutes?: number;
}

interface DecksListResponse {
  decks: DataDeckSummary[];
}

/**
 * Convert a KV deck summary into a `DeckMeta` so the public index can
 * render it through the same `<DeckCard>` as build-time decks. KV
 * summaries don't carry a `description`; we default to an empty string
 * (the card still renders cleanly with no description).
 */
function summaryToDeckMeta(summary: DataDeckSummary): DeckMeta {
  const meta: DeckMeta = {
    slug: summary.slug,
    title: summary.title,
    description: summary.description ?? "",
    date: summary.date,
  };
  if (summary.cover !== undefined) meta.cover = summary.cover;
  if (summary.runtimeMinutes !== undefined) {
    meta.runtimeMinutes = summary.runtimeMinutes;
  }
  return meta;
}

/**
 * Convert a full KV deck record's meta into a `DeckMeta`. Same defaulting
 * as `summaryToDeckMeta` — `description` falls back to an empty string.
 */
function dataDeckMetaToDeckMeta(m: DataDeckMeta): DeckMeta {
  const meta: DeckMeta = {
    slug: m.slug,
    title: m.title,
    description: m.description ?? "",
    date: m.date,
  };
  if (m.author !== undefined) meta.author = m.author;
  if (m.event !== undefined) meta.event = m.event;
  if (m.cover !== undefined) meta.cover = m.cover;
  if (m.runtimeMinutes !== undefined) meta.runtimeMinutes = m.runtimeMinutes;
  return meta;
}

/**
 * Pure helper — combine a list of build-time `DeckMeta` with a list of
 * KV summaries into a single sorted `DeckMeta[]` ready for the public
 * index card grid.
 *
 * Precedence: a slug present in BOTH lists keeps the build-time entry.
 * The KV entry is silently dropped — see the top-of-file comment for
 * why this is the only sane default.
 *
 * Filtering: KV summaries with `visibility !== "public"` are dropped.
 * The Worker should never return them on the public listing endpoint,
 * but we defensively re-filter on the client.
 *
 * Sort order: `date` descending, then `slug` ascending (stable
 * tie-breaker so the order doesn't drift across renders).
 */
export function mergeDeckLists(
  buildTime: DeckMeta[],
  kv: DataDeckSummary[],
): DeckMeta[] {
  const buildTimeSlugs = new Set(buildTime.map((d) => d.slug));
  const kvAsMeta = kv
    .filter((s) => s.visibility === "public")
    .filter((s) => !buildTimeSlugs.has(s.slug))
    .map(summaryToDeckMeta);

  const combined = [...buildTime, ...kvAsMeta];
  combined.sort((a, b) => {
    if (a.date === b.date) return a.slug.localeCompare(b.slug);
    return b.date.localeCompare(a.date);
  });
  return combined;
}

export interface UseDataDeckListResult {
  /** Merged build-time + KV decks, sorted by date desc. */
  decks: DeckMeta[];
  /** True until the first fetch resolves (success or failure). */
  isLoading: boolean;
}

/**
 * Hook for the public index page. Fetches `/api/decks` on mount and
 * merges the response with the build-time list (build-time wins on
 * slug collision). Network failures fall back to the build-time list
 * silently — the page still renders.
 */
export function useDataDeckList(): UseDataDeckListResult {
  const [kv, setKv] = useState<DataDeckSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/decks", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setKv([]);
            setIsLoading(false);
          }
          return;
        }
        const body = (await res.json()) as DecksListResponse;
        if (cancelled) return;
        setKv(Array.isArray(body.decks) ? body.decks : []);
      } catch {
        if (!cancelled) setKv([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build-time list is module-load-stable; we read it on every render so
  // `getPublicDecks()` can be re-mocked in tests without a remount.
  const buildTimeMetas = getPublicDecks().map((d) => d.meta);
  const decks = mergeDeckLists(buildTimeMetas, kv);

  return { decks, isLoading };
}

export interface UseDataDeckResult {
  /** The fetched DataDeck record, or null while loading / on failure. */
  deck: DataDeck | null;
  /** True until the fetch resolves (success or failure). */
  isLoading: boolean;
  /** True iff the fetch resolved with a 4xx/5xx OR network error. */
  notFound: boolean;
  /** Re-fetch from `/api/decks/<slug>`. */
  refetch: () => Promise<void>;
}

/**
 * Hook for the public deck route's KV fallback. Fetches
 * `/api/decks/<slug>` on mount (and whenever `slug` changes); flags
 * `notFound` on 4xx/5xx OR network failure so the route can show a 404
 * page. An empty `slug` short-circuits — never fires a request.
 *
 * The Worker treats private decks as 404 on the public read endpoint,
 * so a private deck reaches this hook as `notFound=true` (the desired
 * behaviour: the public viewer never reveals private decks even by ID).
 */
export function useDataDeck(slug: string): UseDataDeckResult {
  const [deck, setDeck] = useState<DataDeck | null>(null);
  const [isLoading, setIsLoading] = useState(slug.length > 0);
  const [notFound, setNotFound] = useState(false);

  const fetchDeck = useCallback(async () => {
    if (!slug) {
      setDeck(null);
      setNotFound(false);
      setIsLoading(false);
      return;
    }
    const url = `/api/decks/${encodeURIComponent(slug)}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setDeck(null);
        setNotFound(true);
        return;
      }
      const body = (await res.json()) as DataDeck;
      setDeck(body);
      setNotFound(false);
    } catch {
      setDeck(null);
      setNotFound(true);
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setIsLoading(slug.length > 0);
    setNotFound(false);
    void fetchDeck();
  }, [fetchDeck, slug]);

  return { deck, isLoading, notFound, refetch: fetchDeck };
}

// Internal helper for the deck route — converts a `DataDeckMeta` into the
// public `DeckMeta` shape so the route can hand it to UI components that
// expect the framework-level type. Exported for tests.
export { dataDeckMetaToDeckMeta };
