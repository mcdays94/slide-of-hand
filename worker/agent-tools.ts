/**
 * Tool definitions for the in-Studio AI agent — phase 2 (issue #131).
 *
 * Exposes two tools to the model via the AI SDK's `tool()` helper:
 *
 *   - `readDeck()` — fetches the current data-deck JSON from the
 *     `DECKS` KV namespace, keyed by the agent instance name (the
 *     deck slug). Returns `{ found: false }` for build-time JSX decks
 *     (which don't live in KV) so the model can explain its scope
 *     limitation honestly.
 *
 *   - `proposePatch({ patch })` — shallow-merges a partial-deck patch
 *     into the current KV record, validates the result against the
 *     shared `validateDataDeck` schema, and returns a **dry-run** of
 *     the merged deck. Crucially does NOT write to KV — persistence
 *     is gated behind explicit user confirmation in phase 3.
 *
 * Both tools close over `env` + `slug` from `buildTools(env, slug)`,
 * which is exported separately from `worker/agent.ts` so it can be
 * tested in isolation (the model invocation path is hard to exercise
 * without burning real Workers AI calls — see `worker/agent.test.ts`
 * for the same rationale).
 *
 * ## Why shallow merge on `meta`?
 *
 * Partial edits ("update the description", "change the visibility")
 * are the dominant case. Replacing `meta` wholesale would force the
 * model to re-emit every existing field on every edit, which is both
 * fragile (it can hallucinate fields that weren't there) and wasteful
 * of tokens. Slides, by contrast, are replaced wholesale — the model
 * has to re-emit the entire `slides` array to mutate it. That's a
 * conscious trade-off: shallow-array-merge is a tarpit (insert? move?
 * delete by index?) and we'd rather force the model to express full
 * intent than try to infer it. The dry-run result is the source of
 * truth either way; the user sees exactly what they're confirming.
 *
 * ## Validation
 *
 * We delegate to `validateDataDeck` from `src/lib/deck-record.ts` —
 * the same validator the public/admin write endpoints use, so the
 * agent can never propose a deck that would be rejected by the write
 * endpoint. That's by design: the user's confirm-flow in phase 3 will
 * post the dry-run to `POST /api/admin/decks/<slug>` verbatim.
 */

import { tool } from "ai";
import { z } from "zod";
import {
  validateDataDeck,
  type DataDeck,
} from "../src/lib/deck-record";

/** Subset of the Worker env the tools need. */
export interface AgentToolsEnv {
  DECKS: KVNamespace;
}

const KV_DECK = (slug: string) => `deck:${slug}`;

/**
 * Result shape of `readDeck`. Returned as plain JSON so it serialises
 * cleanly across the AI SDK's tool-result wire format.
 */
export type ReadDeckResult =
  | { found: true; deck: DataDeck }
  | { found: false; reason: string }
  | { found: false; error: string };

/**
 * Result shape of `proposePatch`. `dryRun` is the deck the user would
 * see if they confirmed; we never persist it from this tool.
 */
export type ProposePatchResult =
  | { ok: true; dryRun: DataDeck }
  | { ok: false; errors: string[] }
  | { ok: false; error: string };

/**
 * Build the tool record the agent passes to `streamText({ tools })`.
 *
 * Defined as a free function (rather than inside the class) so it's
 * straightforward to unit-test: pass a mock KV namespace + a slug,
 * call `tools.readDeck.execute({}, opts)` directly.
 *
 * The `execute` callbacks close over `env` + `slug` — they cannot be
 * defined at module scope because each agent instance binds to a
 * different deck.
 */
export function buildTools(env: AgentToolsEnv, slug: string) {
  return {
    readDeck: tool({
      description:
        "Read the current deck JSON for the deck the user is editing. " +
        "Returns the full DataDeck (meta + slides) when the deck is " +
        "stored in KV. Returns `{ found: false }` for build-time JSX " +
        "decks — those live as React source files and cannot be read " +
        "from here. Always call this BEFORE proposing a patch so you " +
        "know the current state.",
      // AI SDK v6 uses `inputSchema` (renamed from `parameters` in
      // v5). A `z.object({})` with no fields is the canonical
      // zero-argument schema.
      inputSchema: z.object({}),
      execute: async (): Promise<ReadDeckResult> => {
        try {
          const stored = await env.DECKS.get(KV_DECK(slug), "json");
          if (!stored) {
            return {
              found: false,
              reason:
                "This deck is not stored in KV — it's likely a " +
                "build-time JSX deck. I can only read and propose " +
                "changes to data (KV-backed) decks for now.",
            };
          }
          // Run the same shape validator the write endpoint uses, so
          // we surface schema errors here instead of letting the model
          // operate on a malformed record. In practice this should
          // never trip — anything in KV got there through the same
          // validator on the write path — but it's cheap belt-and-
          // braces.
          const validation = validateDataDeck(stored);
          if (!validation.ok) {
            return {
              found: false,
              error: `Stored deck failed validation: ${validation.errors.join("; ")}`,
            };
          }
          return { found: true, deck: validation.value };
        } catch (err) {
          return {
            found: false,
            error:
              err instanceof Error
                ? err.message
                : "Unknown error reading deck",
          };
        }
      },
    }),

    proposePatch: tool({
      description:
        "Propose a change to the current deck. Returns a DRY-RUN of " +
        "the resulting deck — this does NOT persist anything to " +
        "storage. The user must separately confirm before changes " +
        "ship (that confirmation flow is the next phase; for now, " +
        "describe the proposed change and ask if it looks right). " +
        "The `patch` is shallow-merged: `patch.meta` fields override " +
        "the corresponding fields on the current deck's meta, and " +
        "`patch.slides`, if provided, REPLACES the slides array " +
        "wholesale (you must re-emit every slide you want to keep). " +
        "Always call `readDeck` first so you know the current state.",
      inputSchema: z.object({
        patch: z.object({
          meta: z.record(z.string(), z.unknown()).optional(),
          slides: z.array(z.unknown()).optional(),
        }),
      }),
      execute: async ({ patch }): Promise<ProposePatchResult> => {
        try {
          const stored = await env.DECKS.get(KV_DECK(slug), "json");
          if (!stored) {
            return {
              ok: false,
              error:
                "No KV-backed deck found for this slug. " +
                "`proposePatch` can only be used on data decks.",
            };
          }
          const currentValidation = validateDataDeck(stored);
          if (!currentValidation.ok) {
            return {
              ok: false,
              errors: [
                "Stored deck failed validation before patching:",
                ...currentValidation.errors,
              ],
            };
          }
          const current = currentValidation.value;

          // Shallow-merge meta; replace slides wholesale if provided.
          // Construct a plain `Record<string, unknown>` so the result
          // can be re-validated as if it were freshly arrived JSON.
          const mergedMeta = {
            ...(current.meta as unknown as Record<string, unknown>),
            ...(patch.meta ?? {}),
          };
          const merged: Record<string, unknown> = {
            meta: mergedMeta,
            slides: patch.slides ?? current.slides,
          };

          const validation = validateDataDeck(merged);
          if (!validation.ok) {
            return { ok: false, errors: validation.errors };
          }
          return { ok: true, dryRun: validation.value };
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "Unknown error proposing patch",
          };
        }
      },
    }),
  };
}
