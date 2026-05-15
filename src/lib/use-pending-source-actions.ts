/**
 * `usePendingSourceActions` — client-side hook for the pending source
 * action store (issue #246 / PRD #242).
 *
 * Fetches `/api/admin/deck-source-actions` on mount and exposes:
 *
 *   - `actions`: a map from deck slug → `PendingSourceAction`. The map
 *     shape is the natural lookup the admin projection wants — given
 *     a deck slug, is there a pending record?
 *   - `isLoading`: true until the first fetch resolves (success OR
 *     failure).
 *   - `clearPending(slug)`: fires `DELETE /api/admin/deck-source-actions/<slug>`
 *     and removes the entry from local state on success. Throws on
 *     failure so the caller can surface an inline error.
 *
 * Network failures during the initial fetch fall back silently to an
 * empty map. Same pattern as `useDataDeckList` — the page still
 * renders, the admin author just won't see pending overlays. The
 * console gets the error for debugging.
 *
 * Auth: writes go through `adminWriteHeaders()` so the dev placeholder
 * Access email is injected under `wrangler dev`. Reads piggyback on
 * the same helper so the dev env works end-to-end.
 */

import { useCallback, useEffect, useState } from "react";
import type { PendingSourceAction } from "./pending-source-actions";
import { adminWriteHeaders } from "./admin-fetch";

export interface PendingSourceActionMap {
  [slug: string]: PendingSourceAction;
}

export interface UsePendingSourceActionsResult {
  actions: PendingSourceActionMap;
  isLoading: boolean;
  /**
   * Clear the pending marker for `slug`. Fires
   * `DELETE /api/admin/deck-source-actions/<slug>` and updates local
   * state on success. Throws an Error on non-OK responses so the
   * caller can surface the message inline.
   */
  clearPending: (slug: string) => Promise<void>;
}

interface PendingSourceActionsResponse {
  actions: PendingSourceAction[];
}

export function usePendingSourceActions(): UsePendingSourceActionsResult {
  const [actions, setActions] = useState<PendingSourceActionMap>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/deck-source-actions", {
          cache: "no-store",
          headers: adminWriteHeaders(),
        });
        if (!res.ok) {
          if (!cancelled) {
            setActions({});
            setIsLoading(false);
          }
          return;
        }
        const body = (await res.json()) as PendingSourceActionsResponse;
        if (cancelled) return;
        const map: PendingSourceActionMap = {};
        if (Array.isArray(body.actions)) {
          for (const entry of body.actions) {
            if (entry && typeof entry.slug === "string") {
              map[entry.slug] = entry;
            }
          }
        }
        setActions(map);
      } catch {
        if (!cancelled) setActions({});
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearPending = useCallback(async (slug: string) => {
    const res = await fetch(
      `/api/admin/deck-source-actions/${encodeURIComponent(slug)}`,
      { method: "DELETE", headers: adminWriteHeaders() },
    );
    if (!res.ok) {
      let message = `Failed to clear pending action (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* not JSON — keep generic message */
      }
      throw new Error(message);
    }
    setActions((prev) => {
      if (!(slug in prev)) return prev;
      const next = { ...prev };
      delete next[slug];
      return next;
    });
  }, []);

  return { actions, isLoading, clearPending };
}
