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
 * Lazy-loading split (issue #105):
 *   The registry does TWO globs per visibility:
 *
 *     - `meta.ts` is loaded **eagerly**. The deck index card grid + admin
 *       list need slug/title/date/cover synchronously on app boot.
 *     - `index.tsx` is loaded **lazily**. The full `Deck` (with slides)
 *       is only fetched when someone visits `/decks/<slug>`. Heavy
 *       per-deck dependencies (Three.js, topojson, react-three-fiber,
 *       …) end up in their own chunks and never enter the main bundle.
 *
 *   `loadDeckBySlug(slug)` returns a `Promise<Deck | undefined>` mirroring
 *   the runtime ergonomics of `useDataDeck` for KV-backed decks. The route
 *   wraps the resolution in a `<Suspense>` boundary.
 *
 * Public vs private:
 *   - Public source decks ship in the deployed bundle and appear at `/`.
 *   - Private source decks are gitignored and only present in dev. The
 *     admin viewer resolves both via `getAllDeckMetas()` /
 *     `getAllDeckEntries()`; the public index page uses `getPublicDeckMetas()`.
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
import { adminWriteHeaders } from "./admin-fetch";

type MetaModule = { meta: DeckMeta };
type MetaGlobResult = Record<string, MetaModule>;
type DeckLoader = () => Promise<{ default: Deck }>;
type LoaderGlobResult = Record<string, DeckLoader>;

const META_PATH_RE = /\/decks\/(public|private)\/([^/]+)\/meta\.ts$/;
const INDEX_PATH_RE = /\/decks\/(public|private)\/([^/]+)\/index\.tsx?$/;

export interface RegistryEntry {
  visibility: "public" | "private";
  folder: string;
  /**
   * Eagerly-loaded deck metadata. Used by the index card grid + admin list.
   * Slides are NOT in this object — they're loaded lazily on demand via
   * `loadDeckBySlug(slug)`.
   */
  meta: DeckMeta;
  /**
   * Where the deck came from. Build-time / source decks ("source") live
   * under `src/decks/<visibility>/<slug>/index.tsx`; KV-backed decks
   * created via the admin editor ("kv") are loaded at runtime from
   * `/api/admin/decks`. Defaults to `"source"` for entries produced by
   * `buildRegistry()` so existing call sites stay unchanged.
   */
  source?: "source" | "kv";
}

/**
 * Pure transformation from a meta-glob result into a sorted, validated
 * entry list.
 *
 * Exported so tests can pass synthetic glob results without spinning up Vite.
 *
 * When `prod` is true, private entries are filtered out — this mirrors what
 * the deployed bundle sees. (In dev, both visibilities are returned so the
 * admin route can list every locally-available deck.)
 */
export function buildRegistry(
  modules: MetaGlobResult,
  prod = false,
): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const match = META_PATH_RE.exec(path);
    if (!match) continue;
    const [, visibility, folder] = match;
    if (prod && visibility === "private") continue;
    const meta = mod.meta;
    if (!meta || typeof meta.slug !== "string" || typeof meta.title !== "string") {
      throw new Error(
        `[decks-registry] ${path} does not export a valid \`meta\` (expected DeckMeta with slug + title).`,
      );
    }
    if (meta.slug !== folder) {
      throw new Error(
        `[decks-registry] Slug mismatch in ${path}: meta.slug="${meta.slug}" but folder is "${folder}". They MUST match.`,
      );
    }
    entries.push({
      visibility: visibility as "public" | "private",
      folder,
      meta,
    });
  }
  // Sort by date descending (newest first); fall back to slug for stable order.
  entries.sort((a, b) => {
    const da = a.meta.date;
    const db = b.meta.date;
    if (da === db) return a.meta.slug.localeCompare(b.meta.slug);
    return db.localeCompare(da);
  });
  return entries;
}

/**
 * Pure helper that builds a slug → loader map from a lazy-glob result.
 * Exported so tests can assert the loader map's shape (and confirm the
 * registry isn't accidentally pulling in the heavy index files eagerly).
 */
export function buildLoaderMap(
  modules: LoaderGlobResult,
  prod = false,
): Map<string, DeckLoader> {
  const map = new Map<string, DeckLoader>();
  for (const [path, loader] of Object.entries(modules)) {
    const match = INDEX_PATH_RE.exec(path);
    if (!match) continue;
    const [, visibility, folder] = match;
    if (prod && visibility === "private") continue;
    map.set(folder, loader);
  }
  return map;
}

/**
 * Eager globs hit ONLY each deck's `meta.ts` — a tiny TypeScript file
 * exporting the `DeckMeta` literal. The cost on app boot is therefore
 * ~4 × O(string-literal) per deck, regardless of how heavy the slides are.
 *
 * Lazy globs hit each deck's `index.tsx`. Vite turns these into separate
 * chunks (one per deck), each containing the deck's slides + components +
 * any heavy libraries that live under the deck folder. The chunks are
 * fetched only when `loadDeckBySlug(slug)` is called — i.e. when a
 * visitor actually navigates to `/decks/<slug>`.
 *
 * The private globs are gated behind `import.meta.env.PROD`, which Vite
 * replaces with the literal `true` / `false` at build time. With `true`
 * (production), the ternary statically resolves to `{}` and Vite's
 * dead-code elimination drops every `@/decks/private/*` import from the
 * bundle.
 *
 * (`import.meta.env.PROD` is `true` only inside `vite build`, never under
 * `vite` / `vitest`.)
 */
const publicMetaModules = import.meta.glob<MetaModule>(
  "@/decks/public/*/meta.ts",
  { eager: true },
);

const privateMetaModules = import.meta.env.PROD
  ? ({} as MetaGlobResult)
  : (import.meta.glob<MetaModule>("@/decks/private/*/meta.ts", {
      eager: true,
    }) as MetaGlobResult);

const publicDeckLoaders = import.meta.glob<{ default: Deck }>(
  "@/decks/public/*/index.tsx",
);

const privateDeckLoaders = import.meta.env.PROD
  ? ({} as LoaderGlobResult)
  : (import.meta.glob<{ default: Deck }>(
      "@/decks/private/*/index.tsx",
    ) as LoaderGlobResult);

const metaModules: MetaGlobResult = {
  ...publicMetaModules,
  ...privateMetaModules,
};

const deckLoaders: LoaderGlobResult = {
  ...publicDeckLoaders,
  ...privateDeckLoaders,
};

const registry = buildRegistry(metaModules, import.meta.env.PROD);
const loaderMap = buildLoaderMap(deckLoaders, import.meta.env.PROD);

// ──────────────────────────────────────────────────────────────────────────
// Eager API — `DeckMeta`-only views over the registry. These are the
// only build-time-deck APIs that consumers should reach for at app boot.
// ──────────────────────────────────────────────────────────────────────────

/** Every discovered deck's meta — public + private in dev; public only in prod. */
export function getAllDeckMetas(): DeckMeta[] {
  return registry.map((e) => e.meta);
}

/**
 * Every discovered registry entry (with visibility + meta). Use for the
 * admin deck list, which renders a visibility badge per row.
 */
export function getAllDeckEntries(): RegistryEntry[] {
  return registry;
}

/**
 * Public deck metas only. Use for the public index page.
 *
 * Filters on two dimensions:
 *   1. `visibility === "public"` — never leak private decks to the
 *      public surface.
 *   2. `meta.draft !== true` — hide work-in-progress decks (issue
 *      #191). `undefined` / `false` both pass; only the explicit
 *      `true` is dropped. Admin consumers use `getAllDeckMetas()` /
 *      `getAllDeckEntries()` to see the full set including drafts.
 */
export function getPublicDeckMetas(): DeckMeta[] {
  return registry
    .filter((e) => e.visibility === "public" && e.meta.draft !== true)
    .map((e) => e.meta);
}

/** Resolve a single deck's meta by slug (public or private in dev; public only in prod). */
export function getDeckMetaBySlug(slug: string): DeckMeta | undefined {
  return registry.find((e) => e.meta.slug === slug)?.meta;
}

/**
 * Returns true iff the build-time registry has a deck with this slug.
 * Use this on the deck route to decide whether to lazy-load via
 * `loadDeckBySlug(slug)` or fall through to the KV fetch.
 */
export function hasBuildTimeDeck(slug: string): boolean {
  return registry.some((e) => e.meta.slug === slug);
}

// ──────────────────────────────────────────────────────────────────────────
// Lazy API — `Promise<Deck>`. The deck route awaits this; everything else
// should stick to the meta APIs above.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Lazy-load a build-time deck by slug. Returns `undefined` (synchronously
 * resolved) when the slug isn't in the build-time registry; otherwise
 * returns a Promise that resolves with the full `Deck` (slides + meta)
 * once the deck's chunk has been fetched.
 *
 * Pair with `useDeckResource(slug)` + a `<Suspense>` boundary at the call
 * site — this keeps the TTFP fast and means the visitor only pays for the
 * deck they're actually viewing.
 *
 * If the loader fails (network error, missing chunk, etc.) the promise
 * rejects. The caller is responsible for handling the error — typically
 * by showing the same 404 page used for unknown slugs.
 */
export async function loadDeckBySlug(slug: string): Promise<Deck | undefined> {
  const loader = loaderMap.get(slug);
  if (!loader) return undefined;
  const mod = await loader();
  const deck = mod.default;
  if (!deck || !deck.meta || !Array.isArray(deck.slides)) {
    throw new Error(
      `[decks-registry] Deck "${slug}" loaded but did not default-export a Deck (expected { meta, slides }).`,
    );
  }
  return deck;
}

/**
 * Suspense-compatible resource. Throws the in-flight promise on the first
 * `read()` so a `<Suspense>` boundary unwinds; resolves synchronously on
 * subsequent reads.
 */
export type SuspenseResource<T> = { read(): T };

function wrapPromise<T>(promise: Promise<T>): SuspenseResource<T> {
  let status: "pending" | "success" | "error" = "pending";
  let result: T;
  let error: unknown;
  const suspender = promise.then(
    (value) => {
      status = "success";
      result = value;
    },
    (err) => {
      status = "error";
      error = err;
    },
  );
  return {
    read() {
      if (status === "pending") throw suspender;
      if (status === "error") throw error;
      return result;
    },
  };
}

/**
 * Per-slug Suspense resource cache. Build-time decks rarely change in a
 * single browsing session, so reusing the same resource means navigating
 * away and back to a deck doesn't re-trigger the loading splash. Lazy
 * chunks are themselves cached by the browser, so "refetching" a resolved
 * deck is effectively free anyway.
 *
 * Exported only so tests can clear it between cases.
 */
const deckResources = new Map<string, SuspenseResource<Deck | undefined>>();

/**
 * Get a Suspense-compatible resource for the build-time deck at `slug`.
 * Call `resource.read()` inside a component wrapped in `<Suspense>`; the
 * first call throws the in-flight promise, subsequent calls return the
 * resolved `Deck` (or `undefined` if no build-time deck has that slug).
 *
 * Resources are memoised per-slug for the lifetime of the module — a
 * single browsing session never re-fetches the same deck.
 */
export function getDeckResource(
  slug: string,
): SuspenseResource<Deck | undefined> {
  let resource = deckResources.get(slug);
  if (!resource) {
    resource = wrapPromise(loadDeckBySlug(slug));
    deckResources.set(slug, resource);
  }
  return resource;
}

/** Test-only: clear the per-slug Suspense cache. */
export function __resetDeckResourceCache(): void {
  deckResources.clear();
}

// ──────────────────────────────────────────────────────────────────────────
// Backwards-compatibility shims.
//
// Older call sites — `getPublicDecks()`, `getAllDecks()`, `getDeckBySlug()` —
// returned `Deck[]` / `Deck`. Slides are now lazy, so a fully synchronous
// `Deck` is no longer available. These shims return shaped objects whose
// `meta` is real but `slides` is an empty array, so any consumer that only
// reads `.meta.X` keeps working.
//
// Any consumer that still touches `.slides` on a build-time deck must
// migrate to `loadDeckBySlug(slug)` and a `<Suspense>` boundary.
// ──────────────────────────────────────────────────────────────────────────

/** @deprecated use `getAllDeckMetas()`; slides are no longer eagerly available. */
export function getAllDecks(): Deck[] {
  return registry.map((e) => ({ meta: e.meta, slides: [] }));
}

/** @deprecated use `getPublicDeckMetas()`; slides are no longer eagerly available. */
export function getPublicDecks(): Deck[] {
  return registry
    .filter((e) => e.visibility === "public")
    .map((e) => ({ meta: e.meta, slides: [] }));
}

/** @deprecated use `getDeckMetaBySlug()`; slides are no longer eagerly available. */
export function getDeckBySlug(slug: string): Deck | undefined {
  const meta = getDeckMetaBySlug(slug);
  if (!meta) return undefined;
  return { meta, slides: [] };
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
  /**
   * Work-in-progress flag (issue #191). The Worker filters drafts out of
   * the public list, but we keep the field on the wire shape so admin
   * consumers (`useAdminDataDeckList`) can render a "Draft" pill — and
   * so `mergeDeckLists` can defensively re-filter on the client side.
   */
  draft?: boolean;
}

interface DecksListResponse {
  decks: DataDeckSummary[];
}

/**
 * Convert a KV deck summary into a `DeckMeta` so the public index can
 * render it through the same `<DeckCard>` as build-time decks. Both
 * `DataDeckSummary.description` and `DeckMeta.description` are optional
 * — when absent the card simply omits the description paragraph.
 */
function summaryToDeckMeta(summary: DataDeckSummary): DeckMeta {
  const meta: DeckMeta = {
    slug: summary.slug,
    title: summary.title,
    date: summary.date,
  };
  if (summary.description !== undefined) meta.description = summary.description;
  if (summary.cover !== undefined) meta.cover = summary.cover;
  if (summary.runtimeMinutes !== undefined) {
    meta.runtimeMinutes = summary.runtimeMinutes;
  }
  // Issue #191 — propagate `draft` so admin UI (which surfaces the field
  // as a pill) can render correctly off the merged list. The public
  // `mergeDeckLists` drops drafts BEFORE calling this helper, so a draft
  // entry never reaches the public index even if it's preserved here.
  if (summary.draft === true) meta.draft = true;
  return meta;
}

/**
 * Convert a full KV deck record's meta into a `DeckMeta`. Optional fields
 * (including `description`) are only assigned when present on the source.
 */
function dataDeckMetaToDeckMeta(m: DataDeckMeta): DeckMeta {
  const meta: DeckMeta = {
    slug: m.slug,
    title: m.title,
    date: m.date,
  };
  if (m.description !== undefined) meta.description = m.description;
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
 * Filtering: applied to BOTH halves.
 *   - KV summaries with `visibility !== "public"` are dropped. The
 *     Worker should never return them on the public listing endpoint,
 *     but we defensively re-filter on the client.
 *   - Entries with `draft === true` (issue #191) are dropped from both
 *     the build-time list AND the KV list. The public index never shows
 *     work-in-progress decks. The build-time half normally arrives
 *     pre-filtered via `getPublicDeckMetas()`, but we re-apply here so
 *     callers using the helper directly (tests, future call sites)
 *     don't have to remember the rule.
 *
 * Sort order: `date` descending, then `slug` ascending (stable
 * tie-breaker so the order doesn't drift across renders).
 */
export function mergeDeckLists(
  buildTime: DeckMeta[],
  kv: DataDeckSummary[],
): DeckMeta[] {
  const filteredBuildTime = buildTime.filter((m) => m.draft !== true);
  const buildTimeSlugs = new Set(filteredBuildTime.map((d) => d.slug));
  const kvAsMeta = kv
    .filter((s) => s.visibility === "public" && s.draft !== true)
    .filter((s) => !buildTimeSlugs.has(s.slug))
    .map(summaryToDeckMeta);

  const combined = [...filteredBuildTime, ...kvAsMeta];
  combined.sort((a, b) => {
    if (a.date === b.date) return a.slug.localeCompare(b.slug);
    return b.date.localeCompare(a.date);
  });
  return combined;
}

/**
 * Admin variant of `mergeDeckLists` — combines build-time registry entries
 * with KV summaries into a single sorted list of `RegistryEntry`-shaped
 * rows ready for the admin deck index.
 *
 * Two key differences vs. `mergeDeckLists`:
 *
 *   1. Returns full entries (with `visibility` + `source`), not bare
 *      `DeckMeta`. The admin index renders a visibility badge per row
 *      and may want to fork rendering on `source` (e.g. show the
 *      "Open in IDE" button only for source decks).
 *
 *   2. Does NOT filter on visibility. The admin author needs to see
 *      both public AND private decks. (The Worker's admin list endpoint
 *      already returns the full set; we never want to hide rows here.)
 *
 * Precedence: build-time wins on slug collision. The KV row is dropped
 * silently — same rationale as `mergeDeckLists`. Build-time visibility
 * is the source of truth on collision (e.g. a source/public deck always
 * wins over a KV/private "stub" with the same slug).
 *
 * Sort order: `meta.date` descending, then `meta.slug` ascending —
 * matches `mergeDeckLists` so admin and public lists feel consistent.
 *
 * Both inputs may be empty arrays; the function never throws.
 */
export function mergeAdminDeckLists(
  buildTime: RegistryEntry[],
  kv: DataDeckSummary[],
): RegistryEntry[] {
  const buildTimeSlugs = new Set(buildTime.map((e) => e.meta.slug));
  // Tag every build-time entry with `source: "source"` so consumers can
  // distinguish KV rows even when the entry survived a no-op merge.
  const sourceEntries: RegistryEntry[] = buildTime.map((e) => ({
    ...e,
    source: "source" as const,
  }));
  const kvEntries: RegistryEntry[] = kv
    .filter((s) => !buildTimeSlugs.has(s.slug))
    .map((s) => ({
      visibility: s.visibility,
      folder: s.slug,
      meta: summaryToDeckMeta(s),
      source: "kv" as const,
    }));

  const combined = [...sourceEntries, ...kvEntries];
  combined.sort((a, b) => {
    const da = a.meta.date;
    const db = b.meta.date;
    if (da === db) return a.meta.slug.localeCompare(b.meta.slug);
    return db.localeCompare(da);
  });
  return combined;
}

export interface UseDataDeckListResult {
  /** Merged build-time + KV decks, sorted by date desc. */
  decks: DeckMeta[];
  /** True until the first fetch resolves (success or failure). */
  isLoading: boolean;
}

export interface UseAdminDataDeckListResult {
  /**
   * Merged build-time + KV entries, sorted by `meta.date` descending. Each
   * entry carries `visibility` (so the admin row can render a badge) and
   * `source` ("source" vs "kv", so the row can fork rendering).
   */
  entries: RegistryEntry[];
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
  // `getPublicDeckMetas()` can be re-mocked in tests without a remount.
  const buildTimeMetas = getPublicDeckMetas();
  const decks = mergeDeckLists(buildTimeMetas, kv);

  return { decks, isLoading };
}

/**
 * Admin variant of `useDataDeckList`. Hits the Access-gated
 * `/api/admin/decks` endpoint (which returns BOTH public and private
 * decks — see `worker/decks.ts`'s `handleAdminList`) and merges with
 * the build-time registry into a single sorted entry list.
 *
 * Used by the `/admin` deck index so authors can find KV decks they
 * created via the New Deck modal (issue #80). Without this hook, the
 * admin index showed only build-time decks — KV decks were invisible
 * after creation, which broke the author flow.
 *
 * Network failures fall back silently to the build-time list (same
 * pattern as `useDataDeckList`). The page still renders.
 *
 * In dev (localhost) the hook injects a placeholder Access email via
 * `adminWriteHeaders()` so `wrangler dev` (which doesn't run Access)
 * accepts the request. In production the browser does NOT set this
 * header; Access at the edge populates it after auth.
 */
export function useAdminDataDeckList(): UseAdminDataDeckListResult {
  const [kv, setKv] = useState<DataDeckSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/decks", {
          cache: "no-store",
          headers: adminWriteHeaders(),
        });
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

  // Read build-time entries on every render so tests can re-mock
  // `getAllDeckEntries()` without remounting the hook.
  const buildTime = getAllDeckEntries();
  const entries = mergeAdminDeckLists(buildTime, kv);

  return { entries, isLoading };
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

/**
 * Admin variant of `useDataDeck` — reads from `/api/admin/decks/<slug>`.
 *
 * Shape and semantics mirror `useDataDeck` exactly, with two changes:
 *
 *   1. Hits the admin endpoint, which is Access-gated AND does NOT
 *      filter on visibility. Private decks are visible to authenticated
 *      authors; the public hook would 404 them.
 *   2. Sends the admin-write auth header. In dev (localhost) this is
 *      the placeholder Access email; in production the browser does
 *      not set it, and Access at the edge populates the real header.
 *
 * Used by the admin deck route (Slice 6 / #62) so the read-only viewer
 * for KV decks can show private content. The public route (`/decks/<slug>`)
 * keeps using `useDataDeck`, which preserves the visibility filter.
 */
export function useAdminDataDeck(slug: string): UseDataDeckResult {
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
    const url = `/api/admin/decks/${encodeURIComponent(slug)}`;
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: adminWriteHeaders(),
      });
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
