/**
 * Pending source deck action — shared types + validator (issue #246 /
 * PRD #242).
 *
 * A *pending source action* is a deck lifecycle action (Archive,
 * Restore, Delete) that was initiated against a **source-backed** deck
 * via the GitHub PR flow (slices #247–#249) and has not yet been merged
 * + deployed. The PR exists in GitHub as a draft; the codebase has not
 * yet caught up. Slide of Hand persists a lightweight marker in KV so:
 *
 *   - The admin UI can project the *expected* state onto the deck
 *     card — a pending archive shows the card in the Archived section
 *     with a Pending pill, even though the source still places it in
 *     Active.
 *   - The pending pill links the author back to the open PR.
 *   - Clearing a pending action removes only the KV marker. It does
 *     NOT close the GitHub PR. The author can re-open / re-fire the
 *     action by re-running the flow.
 *
 * KV-backed decks (created via the New Deck flow) are NEVER subject to
 * pending source actions — their lifecycle is immediate via PR #245's
 * archive / restore / delete endpoints. The admin UI gates projection
 * on `source === "source"` so a stray pending record against a KV deck
 * is ignored on the wire.
 *
 * Wire shape:
 *
 *   {
 *     slug: "hello",
 *     action: "archive" | "restore" | "delete",
 *     prUrl: "https://github.com/<owner>/<repo>/pull/<n>",
 *     expectedState: "active" | "archived" | "deleted",
 *     createdAt: "2026-05-15T11:23:45.000Z"
 *   }
 *
 * Notes on `expectedState`:
 *
 *   - `archive` → `archived`
 *   - `restore` → `active`
 *   - `delete`  → `deleted`
 *
 * The action name and expected state are stored separately rather than
 * derived because future slices may want to record a different expected
 * state for an action that landed on top of a stale base (e.g. a delete
 * that reverts to archived rather than removing).
 */

/** The three lifecycle actions a source-backed deck supports. */
export type PendingSourceActionType = "archive" | "restore" | "delete";

/** The state the source repo will be in once the PR is merged + deployed. */
export type PendingSourceActionExpectedState =
  | "active"
  | "archived"
  | "deleted";

export interface PendingSourceAction {
  slug: string;
  action: PendingSourceActionType;
  /**
   * Full GitHub PR URL (e.g.
   * `https://github.com/mcdays94/slide-of-hand/pull/123`). Stored as
   * the canonical URL so the admin pill can link straight to it. The
   * validator only requires "looks like an http(s) URL" — we trust
   * the slice that creates the record (slices #247-249) to pass a
   * well-formed GitHub PR URL.
   */
  prUrl: string;
  expectedState: PendingSourceActionExpectedState;
  /** ISO 8601 timestamp when the record was created. */
  createdAt: string;
}

const ACTIONS: ReadonlySet<PendingSourceActionType> = new Set([
  "archive",
  "restore",
  "delete",
]);

const EXPECTED_STATES: ReadonlySet<PendingSourceActionExpectedState> = new Set([
  "active",
  "archived",
  "deleted",
]);

/**
 * Light URL validator. Accepts http: / https: only — anything else
 * (data:, javascript:, ftp:, ...) is rejected so a malformed record
 * can't surface a dangerous link in the admin chrome.
 */
function isLikelyHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate the shape of a `PendingSourceAction` for the wire. The slug
 * is checked separately by the route handler (against the URL slug)
 * because slug validity is a routing concern, not a record-shape
 * concern. The validator here only checks that `slug` is a non-empty
 * string.
 *
 * Returns the parsed record on success or a string error message on
 * failure. The error message is human-readable and surfaced as the
 * 400 body so future callers (the source slice handlers) can debug.
 */
export function validatePendingSourceAction(
  raw: unknown,
): { ok: true; value: PendingSourceAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.slug !== "string" || r.slug.trim() === "") {
    return { ok: false, error: "slug must be a non-empty string" };
  }
  if (typeof r.action !== "string" || !ACTIONS.has(r.action as PendingSourceActionType)) {
    return {
      ok: false,
      error: "action must be one of: archive, restore, delete",
    };
  }
  if (typeof r.prUrl !== "string" || !isLikelyHttpUrl(r.prUrl)) {
    return { ok: false, error: "prUrl must be a valid http(s) URL" };
  }
  if (
    typeof r.expectedState !== "string" ||
    !EXPECTED_STATES.has(r.expectedState as PendingSourceActionExpectedState)
  ) {
    return {
      ok: false,
      error: "expectedState must be one of: active, archived, deleted",
    };
  }
  // `createdAt` is optional on the wire — callers that omit it get the
  // server timestamp. When present, it must parse as a Date.
  let createdAt: string;
  if (r.createdAt === undefined) {
    createdAt = new Date().toISOString();
  } else if (typeof r.createdAt === "string") {
    const parsed = Date.parse(r.createdAt);
    if (Number.isNaN(parsed)) {
      return { ok: false, error: "createdAt must be an ISO 8601 timestamp" };
    }
    createdAt = r.createdAt;
  } else {
    return { ok: false, error: "createdAt must be a string when present" };
  }
  return {
    ok: true,
    value: {
      slug: r.slug,
      action: r.action as PendingSourceActionType,
      prUrl: r.prUrl,
      expectedState: r.expectedState as PendingSourceActionExpectedState,
      createdAt,
    },
  };
}

/**
 * Derive the expected end-state from an action. Surfaced as a helper
 * so future slice code (PR creation in #247-249) can call it instead
 * of reimplementing the small mapping. The admin projection layer
 * trusts the persisted `expectedState` field directly rather than
 * re-deriving — see the top-of-file note on why.
 */
export function expectedStateFor(
  action: PendingSourceActionType,
): PendingSourceActionExpectedState {
  switch (action) {
    case "archive":
      return "archived";
    case "restore":
      return "active";
    case "delete":
      return "deleted";
  }
}
