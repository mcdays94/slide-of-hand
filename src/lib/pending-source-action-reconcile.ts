/**
 * Pure reconciliation helpers for pending source actions (issue #250 /
 * PRD #242).
 *
 * A *pending source action* (issue #246) is an app-side KV marker for
 * a GitHub draft PR that opens an Archive / Restore / Delete against a
 * source-backed deck. The marker carries `expectedState` (active /
 * archived / deleted) — the state the deployed source repo will reach
 * once the PR is merged + deployed.
 *
 * Reconciliation is the act of clearing the marker once the deployed
 * source catches up. Until then the admin UI projects the expected
 * state onto the card (issue #246). The "source of truth" for
 * reconciliation is the deployed source itself:
 *
 *   - Active source decks live under `src/decks/public/<slug>/` →
 *     surfaced in the admin registry as a `source` entry with
 *     `meta.archived !== true`.
 *   - Archived source decks live under `src/decks/archive/<slug>/` →
 *     surfaced as a `source` entry with `meta.archived === true`.
 *   - Deleted source decks are absent from both folders → not in the
 *     admin registry as a `source` entry at all.
 *
 * KV-backed entries (`source === "kv"`) are NEVER source decks — they
 * cannot satisfy or invalidate a pending source action. The helper
 * treats a slug whose only registry entry is KV as "deleted" from the
 * source perspective. The admin projection layer already gates pending
 * records on `source === "source"`, so this is a defensive parallel
 * — never reached in practice.
 *
 * These helpers are pure functions over a list of `RegistryEntry`-like
 * shapes; they take no I/O dependency and are trivial to test.
 */
import type { PendingSourceAction } from "./pending-source-actions";

/**
 * Minimal shape of a registry entry the reconciler consumes. Defined
 * locally (rather than re-importing `RegistryEntry`) so the helper has
 * no transitive dependency on `decks-registry.ts` (which pulls in
 * React + import.meta.glob and would inflate the test surface).
 */
export interface ReconcileRegistryEntry {
  meta: {
    slug: string;
    archived?: boolean;
  };
  source?: "source" | "kv";
}

/**
 * Compute the current deployed source state for `slug`, given the full
 * merged admin entry list. Mirrors the three lifecycle states a
 * source-backed deck can occupy.
 *
 * Rules:
 *   - If the entry is missing entirely → `"deleted"`.
 *   - If the entry exists with `source !== "source"` (i.e. KV) → also
 *     `"deleted"`. A KV entry cannot satisfy a pending SOURCE action.
 *   - If the entry exists with `meta.archived === true` → `"archived"`.
 *   - Otherwise → `"active"`.
 */
export function sourceStateForSlug(
  slug: string,
  entries: readonly ReconcileRegistryEntry[],
): "active" | "archived" | "deleted" {
  const entry = entries.find((e) => e.meta.slug === slug);
  if (!entry) return "deleted";
  // A KV-only entry means the source repo has no deck folder for this
  // slug; from the source perspective it is deleted.
  if ((entry.source ?? "source") !== "source") return "deleted";
  return entry.meta.archived === true ? "archived" : "active";
}

/**
 * Should the pending action be reconciled (cleared) given the current
 * deployed source state? True iff the source state matches the
 * action's `expectedState`.
 *
 * This is the only reconciliation check the admin UI performs. The
 * worker endpoint re-validates server-side before clearing — see
 * `worker/pending-source-actions.ts` `handleReconcile`.
 */
export function shouldReconcile(
  pending: Pick<PendingSourceAction, "expectedState">,
  sourceState: "active" | "archived" | "deleted",
): boolean {
  return pending.expectedState === sourceState;
}
