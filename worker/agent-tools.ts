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
import { getCurrentAgent } from "agents";
import { z } from "zod";
import {
  validateDataDeck,
  type DataDeck,
} from "../src/lib/deck-record";
import { getAccessUserEmail } from "./access-auth";
import { getStoredGitHubToken } from "./github-oauth";
import {
  dataDeckPath,
  listContents,
  putFileContents,
  readFileContents,
  TARGET_REPO,
  type GitHubError,
} from "./github-client";

/** Subset of the Worker env the tools need. */
export interface AgentToolsEnv {
  DECKS: KVNamespace;
  GITHUB_TOKENS: KVNamespace;
}

const KV_DECK = (slug: string) => `deck:${slug}`;

/**
 * Pull the authenticated user's email from the current execution
 * context. Tools that hit GitHub need this to look up the per-user
 * OAuth token in `GITHUB_TOKENS` KV.
 *
 * Wrapped + exported so it can be stubbed in tests. The Agents SDK's
 * `getCurrentAgent()` returns `{ agent, connection, request, email }`
 * — we use `request` because Access populates the email header on
 * every authenticated request (interactive flows AND service tokens
 * carry the JWT header that satisfies our `requireAccessAuth`).
 */
export function currentUserEmail(): string | null {
  try {
    const ctx = getCurrentAgent();
    if (!ctx.request) return null;
    return getAccessUserEmail(ctx.request);
  } catch {
    return null;
  }
}

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
 * Result shape of `commitPatch`. KV write is the primary side-effect;
 * the GitHub commit is best-effort backup/audit and surfaces its own
 * outcome separately.
 */
export type CommitPatchResult =
  | {
      ok: true;
      persistedToKv: true;
      githubCommit:
        | { ok: true; commitSha: string; commitHtmlUrl: string; path: string }
        | { ok: false; reason: string };
      deck: DataDeck;
    }
  | { ok: false; errors: string[] }
  | { ok: false; error: string };

export type ListSourceTreeResult =
  | {
      ok: true;
      path: string;
      ref: string;
      items: Array<{ name: string; path: string; type: string; size: number }>;
    }
  | { ok: false; error: string };

export type ReadSourceResult =
  | {
      ok: true;
      path: string;
      ref: string;
      content: string;
      size: number;
      sha: string;
    }
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
        "ship via `commitPatch`. " +
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
        return runProposePatch(env, slug, patch);
      },
    }),

    commitPatch: tool({
      description:
        "Persist a previously-proposed patch to storage. Re-validates " +
        "the patch (defence in depth), writes the merged deck to KV " +
        "(the live source of truth), and ALSO best-effort commits the " +
        "deck JSON to `data-decks/<slug>.json` in the configured " +
        "GitHub repo as a version-controlled backup. " +
        "ONLY call this AFTER the user has explicitly confirmed they " +
        "want the change applied — never call commitPatch off the back " +
        "of `proposePatch` alone. If the user hasn't seen and approved " +
        "the dry-run, stop and ask them. " +
        "The GitHub commit requires the user to have connected their " +
        "GitHub account (Settings → GitHub → Connect). If they haven't, " +
        "the KV write still succeeds and the result tells the user how " +
        "to connect for full audit trail.",
      inputSchema: z.object({
        patch: z.object({
          meta: z.record(z.string(), z.unknown()).optional(),
          slides: z.array(z.unknown()).optional(),
        }),
        commitMessage: z
          .string()
          .optional()
          .describe(
            "Short one-line message describing this change. Used as the " +
              "GitHub commit subject. Default: 'Update deck via in-Studio AI agent'.",
          ),
      }),
      execute: async ({ patch, commitMessage }): Promise<CommitPatchResult> => {
        return runCommitPatch(env, slug, patch, commitMessage);
      },
    }),

    listSourceTree: tool({
      description:
        "List files and directories at a given path in the Slide of " +
        `Hand source repo (${TARGET_REPO.owner}/${TARGET_REPO.repo}). ` +
        "Useful for exploring build-time JSX decks under " +
        "`src/decks/public/<slug>/`, the framework primitives, or any " +
        "other source file the user wants to reason about. " +
        "Requires the user to have connected GitHub (Settings → GitHub " +
        "→ Connect). " +
        "Pass an empty string for `path` to list the repo root. " +
        "Files are listed by name; directories by name with `type: " +
        "'dir'`. Use `readSource` to fetch a specific file's contents.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Path inside the repo (e.g. `src/decks/public/cf-zt-ai`). " +
              "Empty string lists the root.",
          ),
        ref: z
          .string()
          .optional()
          .describe(
            "Optional branch/tag/commit. Defaults to `main`.",
          ),
      }),
      execute: async ({ path, ref }): Promise<ListSourceTreeResult> => {
        return runListSourceTree(env, path, ref);
      },
    }),

    readSource: tool({
      description:
        "Read a single source file from the Slide of Hand repo " +
        `(${TARGET_REPO.owner}/${TARGET_REPO.repo}). ` +
        "Returns the UTF-8 contents — use this to examine build-time " +
        "deck source, framework code, or configuration files. " +
        "Requires the user to have connected GitHub. " +
        "Binary files return an error (use the listing tool to inspect " +
        "asset names instead).",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Path to the file (e.g. `src/decks/public/hello/01-title.tsx`).",
          ),
        ref: z
          .string()
          .optional()
          .describe(
            "Optional branch/tag/commit. Defaults to `main`.",
          ),
      }),
      execute: async ({ path, ref }): Promise<ReadSourceResult> => {
        return runReadSource(env, path, ref);
      },
    }),
  };
}

// ── Tool implementations, factored out so unit tests can call them
//    directly with mocked env / mocked getCurrentAgent context. ──────

export async function runProposePatch(
  env: AgentToolsEnv,
  slug: string,
  patch: { meta?: Record<string, unknown>; slides?: unknown[] },
): Promise<ProposePatchResult> {
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
}

export async function runCommitPatch(
  env: AgentToolsEnv,
  slug: string,
  patch: { meta?: Record<string, unknown>; slides?: unknown[] },
  commitMessage?: string,
  /**
   * Override hook for tests — defaults to reading the current request
   * context. Real callers don't pass this.
   */
  emailOverride?: string | null,
): Promise<CommitPatchResult> {
  // Re-run the proposePatch path to get a validated dry-run. This is
  // defence in depth: even if the model invokes commitPatch with a
  // patch that wasn't previously proposed, the same validator runs.
  const dry = await runProposePatch(env, slug, patch);
  if (!dry.ok) return dry;

  // Persist to KV — the primary side-effect.
  try {
    await env.DECKS.put(KV_DECK(slug), JSON.stringify(dry.dryRun));
  } catch (err) {
    return {
      ok: false,
      error: `KV write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // GitHub commit is best-effort. If the user hasn't connected GitHub,
  // we report that on the result so the user knows + can connect for
  // audit trail.
  const email =
    emailOverride !== undefined ? emailOverride : currentUserEmail();
  if (!email) {
    return {
      ok: true,
      persistedToKv: true,
      githubCommit: {
        ok: false,
        reason:
          "No interactive user identity available (service-token context). " +
          "KV is updated; GitHub backup skipped.",
      },
      deck: dry.dryRun,
    };
  }

  const stored = await getStoredGitHubToken(env, email);
  if (!stored) {
    return {
      ok: true,
      persistedToKv: true,
      githubCommit: {
        ok: false,
        reason:
          "GitHub not connected. Open Settings → GitHub → Connect to " +
          "enable version-controlled backups of deck edits.",
      },
      deck: dry.dryRun,
    };
  }

  const result = await putFileContents(stored.token, {
    path: dataDeckPath(slug),
    content: JSON.stringify(dry.dryRun, null, 2) + "\n",
    message:
      commitMessage?.trim() ||
      `Update deck "${dry.dryRun.meta.title}" via in-Studio AI agent`,
    committer: stored.username
      ? {
          name: stored.username,
          // GitHub requires email; OAuth tokens from `public_repo` don't
          // give us the user's verified email reliably, so fall back to
          // the noreply form which GitHub displays correctly.
          email: `${stored.userId}+${stored.username}@users.noreply.github.com`,
        }
      : undefined,
  });

  if (!result.ok) {
    return {
      ok: true,
      persistedToKv: true,
      githubCommit: { ok: false, reason: ghErrorMessage(result) },
      deck: dry.dryRun,
    };
  }

  return {
    ok: true,
    persistedToKv: true,
    githubCommit: {
      ok: true,
      commitSha: result.result.commitSha,
      commitHtmlUrl: result.result.commitHtmlUrl,
      path: result.result.path,
    },
    deck: dry.dryRun,
  };
}

export async function runListSourceTree(
  env: AgentToolsEnv,
  path: string,
  ref?: string,
  emailOverride?: string | null,
): Promise<ListSourceTreeResult> {
  const tokenLookup = await resolveToken(env, emailOverride);
  if (!tokenLookup.ok) return { ok: false, error: tokenLookup.error };

  const cleanRef = ref?.trim() || "main";
  const result = await listContents(tokenLookup.token, path, cleanRef);
  if (!result.ok) return { ok: false, error: ghErrorMessage(result) };

  return {
    ok: true,
    path,
    ref: cleanRef,
    items: result.items.map((it) => ({
      name: it.name,
      path: it.path,
      type: it.type,
      size: it.size,
    })),
  };
}

export async function runReadSource(
  env: AgentToolsEnv,
  path: string,
  ref?: string,
  emailOverride?: string | null,
): Promise<ReadSourceResult> {
  const tokenLookup = await resolveToken(env, emailOverride);
  if (!tokenLookup.ok) return { ok: false, error: tokenLookup.error };

  const cleanRef = ref?.trim() || "main";
  const result = await readFileContents(tokenLookup.token, path, cleanRef);
  if (!result.ok) return { ok: false, error: ghErrorMessage(result) };

  return {
    ok: true,
    path: result.result.path,
    ref: cleanRef,
    content: result.result.content,
    size: result.result.size,
    sha: result.result.sha,
  };
}

/**
 * Resolve a GitHub token for the current execution context, with a
 * test override hook. Returns either the token or a structured error
 * the tool can surface to the model.
 */
async function resolveToken(
  env: AgentToolsEnv,
  emailOverride: string | null | undefined,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const email =
    emailOverride !== undefined ? emailOverride : currentUserEmail();
  if (!email) {
    return {
      ok: false,
      error:
        "Source-tree access requires an authenticated user. Service-token " +
        "contexts have no user identity to look up a GitHub connection for.",
    };
  }
  const stored = await getStoredGitHubToken(env, email);
  if (!stored) {
    return {
      ok: false,
      error:
        "GitHub not connected. Ask the user to open Settings → GitHub → " +
        "Connect, then retry.",
    };
  }
  return { ok: true, token: stored.token };
}

function ghErrorMessage(err: GitHubError): string {
  return err.message;
}
