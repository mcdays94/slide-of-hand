/**
 * `useElementOverrides(slug)` — fetch the per-deck element overrides on
 * mount and expose draft / persistent / applied state for the inspector
 * (#14, slice 3) and the apply-to-DOM effect in `<Deck>`.
 *
 * Used by:
 *   - `<Deck>`: every render path. Public viewers fetch + apply silently
 *     so audience members see a saved override land. The applier walks
 *     each slide's DOM via `findBySelector` (#44) and `classList.replace`s
 *     the `from` class with the `to` class.
 *   - `<ElementInspector>` (admin only): reads `applied` to render the
 *     current state, calls `applyDraft()` to live-preview a class swap
 *     without persisting, and `save()` to commit.
 *
 * State machine mirrors `useDeckManifest`:
 *
 *      load → overrides[] → applied = overrides[]
 *      load → empty       → applied = []
 *
 *      applyDraft(d): applied = d (persistent untouched)
 *      clearDraft():  applied = persistent (or [] if none)
 *
 * No localStorage. KV is the source of truth; client-side state is
 * ephemeral and resets on a hard reload.
 *
 * ## Dev-mode auth header
 *
 * `wrangler dev` does NOT run Cloudflare Access locally, so the
 * `cf-access-authenticated-user-email` header is never set in dev — and
 * `requireAccessAuth` (defense-in-depth in the Worker) refuses POSTs
 * without it. To unblock save-flow probes locally, the hook detects
 * localhost (or `import.meta.env.DEV`) and injects a placeholder header
 * so the dev round-trip succeeds. In production the header is omitted;
 * Cloudflare Access at the edge populates it after auth, and
 * `requireAccessAuth` reads whatever Access put there. Forging this
 * header would NOT bypass production Access — the edge strips
 * client-set `cf-access-*` headers before the request reaches the
 * Worker.
 */

import { useCallback, useEffect, useState } from "react";

/**
 * Mirrors `worker/element-overrides.ts`'s `ElementOverride` shape. Inlined
 * here (rather than imported across the worker/src boundary) because the
 * `tsconfig.app.json` build only includes `src` + `tests`. The schema is
 * the public contract of the `/api/element-overrides/<slug>` endpoint —
 * if it changes here, change it in the Worker too (and vice versa).
 */
export interface ElementOverride {
  slideId: string;
  selector: string;
  fingerprint: { tag: string; text: string };
  classOverrides: Array<{ from: string; to: string }>;
}

interface ElementOverridesApiResponse {
  overrides: ElementOverride[];
}

export interface UseElementOverridesResult {
  /** The persisted overrides from KV. Empty array when none configured. */
  persistent: ElementOverride[];
  /** True until the first fetch resolves (success or failure). */
  isLoading: boolean;
  /** Apply a draft list of overrides (live preview while editing). */
  applyDraft: (overrides: ElementOverride[]) => void;
  /** Drop the draft so `applied` falls back to persistent. */
  clearDraft: () => void;
  /** POST + refetch. Returns `{ ok }`. */
  save: (overrides: ElementOverride[]) => Promise<{ ok: boolean; status?: number }>;
  /** Re-fetch from the read endpoint. */
  refetch: () => Promise<void>;
  /** The currently-applied overrides (draft if dirty, else persistent). */
  applied: ElementOverride[];
}

/**
 * Build the headers for an admin write. In dev (localhost) we inject a
 * placeholder Access email so the Worker's `requireAccessAuth` returns
 * null and the POST proceeds. In production the browser does not set
 * this header; Cloudflare Access at the edge populates it after auth.
 */
function adminWriteHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocalhost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".localhost");
    if (isLocalhost) {
      headers["cf-access-authenticated-user-email"] = "dev@local";
    }
  }
  return headers;
}

export function useElementOverrides(slug: string): UseElementOverridesResult {
  const [persistent, setPersistent] = useState<ElementOverride[]>([]);
  const [draft, setDraft] = useState<ElementOverride[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOverrides = useCallback(async () => {
    // Bypass the browser HTTP cache. The endpoint sets `private,
    // max-age=60` for per-browser caching, but the author flow expects
    // Save → reload to feel instant — so we always re-validate.
    const url = `/api/element-overrides/${encodeURIComponent(slug)}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setPersistent([]);
        return;
      }
      const body = (await res.json()) as ElementOverridesApiResponse;
      setPersistent(Array.isArray(body.overrides) ? body.overrides : []);
    } catch {
      // Network failure → empty list silently. The deck still works.
      setPersistent([]);
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setIsLoading(true);
    void fetchOverrides();
  }, [fetchOverrides]);

  const applyDraft = useCallback((next: ElementOverride[]) => {
    setDraft(next);
  }, []);

  const clearDraft = useCallback(() => {
    setDraft(null);
  }, []);

  const refetch = useCallback(async () => {
    await fetchOverrides();
    // Drop any stale draft so `applied` reflects the freshly-persisted state.
    setDraft(null);
  }, [fetchOverrides]);

  const save = useCallback(
    async (overrides: ElementOverride[]) => {
      try {
        const res = await fetch(
          `/api/admin/element-overrides/${encodeURIComponent(slug)}`,
          {
            method: "POST",
            headers: adminWriteHeaders(),
            body: JSON.stringify({ overrides }),
          },
        );
        if (!res.ok) {
          return { ok: false, status: res.status };
        }
        await refetch();
        return { ok: true, status: res.status };
      } catch {
        return { ok: false };
      }
    },
    [slug, refetch],
  );

  const applied = draft ?? persistent;

  return {
    persistent,
    isLoading,
    applyDraft,
    clearDraft,
    save,
    refetch,
    applied,
  };
}
