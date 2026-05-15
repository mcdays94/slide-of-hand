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
import type {
  PendingSourceAction,
  PendingSourceActionExpectedState,
} from "./pending-source-actions";
import { adminWriteHeaders } from "./admin-fetch";

export interface PendingSourceActionMap {
  [slug: string]: PendingSourceAction;
}

export interface ReconcileResult {
  /** True if the server cleared the pending record on this call. */
  reconciled: boolean;
  /** Action recorded by the pending marker (when reconciled). */
  action?: PendingSourceAction["action"];
  /** KV keys the server reports as cleaned up (delete reconcile only). */
  cleared?: string[];
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
  /**
   * Re-fetch the pending action list from the server. Useful after a
   * source-backed lifecycle action (#247-249) succeeds — the Worker
   * has just written a new record to KV and we want to project it
   * onto the admin UI without waiting for a full reload.
   *
   * Returns a Promise that resolves once the local map reflects the
   * server's current state (or stays unchanged on a transient
   * failure). Never throws — refetch is best-effort.
   */
  refetch: () => Promise<void>;
  /**
   * Reconcile the pending marker for `slug` against the deployed
   * source state the caller has observed (issue #250). Fires
   * `POST /api/admin/deck-source-actions/<slug>/reconcile` with
   * `{ sourceState }`; when the server reports `reconciled: true`,
   * the local map drops the entry so the admin projection stops
   * showing a pending pill.
   *
   * Best-effort — failures are swallowed and the local map stays as
   * it was. The next render that still finds the entry pending +
   * the source state matching will retry on its own.
   */
  reconcile: (
    slug: string,
    sourceState: PendingSourceActionExpectedState,
  ) => Promise<ReconcileResult>;
}

interface PendingSourceActionsResponse {
  actions: PendingSourceAction[];
}

export function usePendingSourceActions(): UsePendingSourceActionsResult {
  const [actions, setActions] = useState<PendingSourceActionMap>({});
  const [isLoading, setIsLoading] = useState(true);

  const fetchActions = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/admin/deck-source-actions", {
        cache: "no-store",
        headers: adminWriteHeaders(),
      });
      if (!res.ok) {
        setActions({});
        return;
      }
      const body = (await res.json()) as PendingSourceActionsResponse;
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
      // Best-effort — keep whatever was last seen if the network
      // blips. The initial-load path explicitly resets to {} above
      // when the response is non-OK; for refetch we prefer to keep
      // optimistic state rather than wipe it on a transient error.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchActions();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchActions]);

  const refetch = useCallback(async (): Promise<void> => {
    await fetchActions();
  }, [fetchActions]);

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

  /**
   * Issue #250 — reconcile a pending marker against deployed source
   * state. The Worker (re)validates the persisted `expectedState`
   * matches the asserted `sourceState`; on a server-side match the
   * pending record is cleared (plus source-delete side data for a
   * delete reconcile). The local map then drops the entry so the
   * admin projection stops surfacing a pill.
   *
   * Errors are swallowed: the next render still sees the entry and
   * (assuming the source state still matches) will retry. We avoid
   * throwing here because reconciliation is a background concern, not
   * a user-initiated action.
   */
  const reconcile = useCallback(
    async (
      slug: string,
      sourceState: PendingSourceActionExpectedState,
    ): Promise<ReconcileResult> => {
      try {
        const res = await fetch(
          `/api/admin/deck-source-actions/${encodeURIComponent(slug)}/reconcile`,
          {
            method: "POST",
            headers: {
              ...adminWriteHeaders(),
              "content-type": "application/json",
            },
            body: JSON.stringify({ sourceState }),
          },
        );
        if (!res.ok) return { reconciled: false };
        const body = (await res.json()) as ReconcileResult;
        if (body?.reconciled === true) {
          setActions((prev) => {
            if (!(slug in prev)) return prev;
            const next = { ...prev };
            delete next[slug];
            return next;
          });
        }
        return body ?? { reconciled: false };
      } catch {
        return { reconciled: false };
      }
    },
    [],
  );

  return { actions, isLoading, clearPending, refetch, reconcile };
}
