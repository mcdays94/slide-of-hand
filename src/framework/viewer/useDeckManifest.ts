/**
 * `useDeckManifest(slug)` — fetch the per-deck slide manifest on mount
 * and expose draft / persisted / applied state for downstream merging.
 *
 * Used by:
 *   - `<Deck>`: every render path. Public viewers fetch + apply silently
 *     so a saved manifest visibly reorders / hides slides for visitors.
 *   - `<SlideManager>` (admin only): reads `applyDraft()` / `clearDraft()`
 *     to live-preview the deck while the author edits, and `refetch()`
 *     after a Save / Reset flushes KV.
 *
 * Unlike `useDeckTheme`, this hook does NOT mutate the DOM — manifests
 * change the slide list, not CSS. The `applied` field is what `<Deck>`
 * feeds through `mergeSlides()` to compute `effectiveSlides`.
 *
 *      load → manifest != null → applied = manifest
 *      load → manifest === null → applied = null  (source defaults)
 *
 *      applyDraft(d): applied = d (persisted untouched)
 *      clearDraft():  applied = persisted (or null if none)
 *
 * No localStorage. KV is the source of truth; client-side state is
 * ephemeral and resets on a hard reload.
 */

import { useCallback, useEffect, useState } from "react";
import type { Manifest } from "@/lib/manifest";

interface ManifestApiResponse {
  manifest: Manifest | null;
}

export interface UseDeckManifestResult {
  /** The persisted manifest from KV, or null when none is configured. */
  manifest: Manifest | null;
  /** ISO timestamp of the last persisted save. */
  updatedAt: string | null;
  /** True until the first fetch resolves (success or failure). */
  isLoading: boolean;
  /** Apply a draft manifest (live preview while editing). */
  applyDraft: (manifest: Manifest) => void;
  /** Revert to either the persisted manifest or no override (source). */
  clearDraft: () => void;
  /** Re-fetch from `/api/manifests/<slug>`. Call after Save / Reset. */
  refetch: () => Promise<void>;
  /** The currently-applied manifest (draft if dirty, else persisted, else null). */
  applied: Manifest | null;
}

export function useDeckManifest(slug: string): UseDeckManifestResult {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [draft, setDraft] = useState<Manifest | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchManifest = useCallback(async () => {
    // Bypass the browser HTTP cache — the response carries
    // `cache-control: public, max-age=60` for *edge* caching but the
    // browser-side cache would make Save → reload appear stale to the
    // author.
    const url = `/api/manifests/${encodeURIComponent(slug)}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setManifest(null);
        return;
      }
      const body = (await res.json()) as ManifestApiResponse;
      setManifest(body.manifest ?? null);
    } catch {
      // Network failure → fall back to source defaults silently.
      setManifest(null);
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setIsLoading(true);
    void fetchManifest();
  }, [fetchManifest]);

  const applyDraft = useCallback((next: Manifest) => {
    setDraft(next);
  }, []);

  const clearDraft = useCallback(() => {
    setDraft(null);
  }, []);

  const refetch = useCallback(async () => {
    await fetchManifest();
    // After a successful re-fetch, drop any stale draft so `applied`
    // reflects the freshly-persisted state.
    setDraft(null);
  }, [fetchManifest]);

  const applied = draft ?? manifest;

  return {
    manifest,
    updatedAt: manifest?.updatedAt ?? null,
    isLoading,
    applyDraft,
    clearDraft,
    refetch,
    applied,
  };
}
