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
 * ## Slice 5 additions (#47)
 *
 * - `getOverrideStatus(override)` — synchronous DOM lookup that returns
 *   `"matched" | "orphaned" | "missing"` for an override against the
 *   currently-mounted slide root (`[data-slide-id="<id>"]`). When the
 *   target slide is NOT mounted (audience is on a different slide),
 *   returns `"matched"` — we have no information, so we default to the
 *   non-warning state. The status flips to its real value as soon as
 *   the user navigates to that slide and the shell mounts.
 * - `appliedWithStatus` — a render-time projection of `applied` paired
 *   with the per-entry status. Recomputed on every hook call (cheap;
 *   four `querySelector` lookups per override max).
 * - `removeOne(override)` — direct write that POSTs the persistent list
 *   minus a single entry (matched on `slideId + selector`). Skips the
 *   draft state entirely; the deletion lands in KV immediately.
 * - `clearOrphaned()` — direct write that POSTs the persistent list
 *   filtered to ONLY entries whose status is `matched` against the
 *   currently-mounted slide. Entries whose slide isn't mounted are
 *   conservatively kept (no information → no deletion).
 *
 * ## Dev-mode auth header
 *
 * Header construction is delegated to `adminWriteHeaders()` from
 * `src/lib/admin-fetch.ts` (Slice 6 / #62) — the canonical localhost-
 * bound dev injection helper. The hook used to carry its own copy of
 * the helper; that has now been collapsed onto the shared one.
 *
 * `wrangler dev` does NOT run Cloudflare Access locally, so the
 * `cf-access-authenticated-user-email` header is never set in dev — and
 * `requireAccessAuth` (defense-in-depth in the Worker) refuses POSTs
 * without it. The shared helper detects localhost (and `*.localhost`,
 * `127.0.0.1`) and injects `cf-access-authenticated-user-email:
 * dev@local` so the dev round-trip succeeds. In production the header
 * is omitted; Cloudflare Access at the edge populates it after auth,
 * and `requireAccessAuth` reads whatever Access put there. Forging this
 * header would NOT bypass production Access — the edge strips
 * client-set `cf-access-*` headers before the request reaches the
 * Worker.
 */

import { useCallback, useEffect, useState } from "react";
import { findBySelector } from "@/lib/element-selector";
import { adminWriteHeaders } from "@/lib/admin-fetch";

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

/**
 * Per-entry status from `findBySelector` — paired with the override
 * itself for the inspector's list view. `"matched"` is the optimistic
 * default when the target slide isn't currently mounted (we don't have
 * enough information to call it orphaned, so we don't).
 */
export type OverrideStatus = "matched" | "orphaned" | "missing";

export interface AppliedOverride {
  override: ElementOverride;
  status: OverrideStatus;
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
  /** `applied` paired with each entry's per-render `findBySelector` status. */
  appliedWithStatus: AppliedOverride[];
  /**
   * Resolve a single override's status against the currently-mounted DOM.
   * Returns `"matched"` if the override's slide isn't currently in the
   * DOM (we have no information).
   */
  getOverrideStatus: (override: ElementOverride) => OverrideStatus;
  /**
   * Direct write — POST the persistent list minus this single entry,
   * matched on `(slideId, selector)`. No draft state involved.
   */
  removeOne: (override: ElementOverride) => Promise<{ ok: boolean; status?: number }>;
  /**
   * Direct write — POST the persistent list filtered to entries whose
   * current status is `matched`. Entries whose slide isn't currently
   * mounted are KEPT (their status is unknown).
   */
  clearOrphaned: () => Promise<{ ok: boolean; status?: number }>;
}

/**
 * CSS-escape a slideId for use in an attribute selector. Slide IDs are
 * kebab-case by convention so `CSS.escape` rarely mutates them, but
 * defensive escaping is cheap and avoids the rare quotes-or-spaces
 * footgun on invalid input.
 */
function escapeAttrValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  // Fallback: replace double-quotes which would break the selector.
  return value.replace(/"/g, '\\"');
}

/**
 * Synchronously look up the status of a single override against the
 * currently-mounted DOM. Used both directly (the inspector calls it
 * during render) and indirectly (`appliedWithStatus`, `clearOrphaned`).
 *
 * Returns `"matched"` when the target slide isn't currently mounted —
 * we have no DOM to interrogate, so we default to the non-warning
 * state. The status flips to "orphaned" / "missing" the moment the
 * user navigates to the offending slide and the shell mounts.
 */
function computeOverrideStatus(
  override: ElementOverride,
): OverrideStatus {
  if (typeof document === "undefined") return "matched";
  const slideRoot = document.querySelector(
    `[data-slide-id="${escapeAttrValue(override.slideId)}"]`,
  );
  if (!slideRoot) return "matched";
  return findBySelector(
    slideRoot,
    override.selector,
    override.fingerprint,
  ).status;
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

  /**
   * Direct delete — match by `(slideId, selector)`, POST the filtered
   * persistent list, then refetch. We deliberately skip the draft so
   * the deletion is irreversible at the inspector layer (the row's
   * tooltip warns the user). After the round-trip the local state
   * mirrors KV.
   *
   * Operates on `persistent` (not `applied`) because a per-row × in
   * the override-list view is fundamentally a "remove from KV" action
   * — there's no concept of a "draft delete" that gets saved later.
   */
  const removeOne = useCallback(
    async (override: ElementOverride) => {
      const next = persistent.filter(
        (o) =>
          !(
            o.slideId === override.slideId && o.selector === override.selector
          ),
      );
      return save(next);
    },
    [persistent, save],
  );

  /**
   * Direct bulk delete — POST the persistent list filtered to entries
   * whose `findBySelector` status is currently `matched`. Entries
   * whose slide isn't currently mounted (status defaults to `matched`)
   * are KEPT — we don't have the information to call them orphaned, so
   * we err on the side of preservation. The user can navigate to each
   * slide to surface its real status before clicking again.
   */
  const clearOrphaned = useCallback(async () => {
    const next = persistent.filter(
      (o) => computeOverrideStatus(o) === "matched",
    );
    return save(next);
  }, [persistent, save]);

  const applied = draft ?? persistent;
  // `appliedWithStatus` is computed anew on every render — cheap (one
  // `querySelector` per override; the deck typically has < 20). Done
  // here rather than via `useMemo` because the result depends on the
  // live DOM, not on React state, and there's no clean dependency
  // signal to memoize against.
  const appliedWithStatus: AppliedOverride[] = applied.map((o) => ({
    override: o,
    status: computeOverrideStatus(o),
  }));

  const getOverrideStatus = useCallback(
    (o: ElementOverride): OverrideStatus => computeOverrideStatus(o),
    [],
  );

  return {
    persistent,
    isLoading,
    applyDraft,
    clearDraft,
    save,
    refetch,
    applied,
    appliedWithStatus,
    getOverrideStatus,
    removeOne,
    clearOrphaned,
  };
}
