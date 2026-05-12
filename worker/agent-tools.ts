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
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
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
  openPullRequest,
  putFileContents,
  readFileContents,
  TARGET_REPO,
  type GitHubError,
} from "./github-client";
import {
  applyFilesIntoSandbox,
  cloneRepoIntoSandbox,
  commitAndPushInSandbox,
  runSandboxTestGate,
  type FileEdit,
  type PhaseResult,
  type TestGatePhase,
} from "./sandbox-source-edit";
import {
  runCreateDeckDraft,
  runIterateOnDeckDraft,
  type DeckDraftError,
  type DeckDraftResult,
} from "./sandbox-deck-creation";

/** Subset of the Worker env the tools need. */
export interface AgentToolsEnv {
  DECKS: KVNamespace;
  GITHUB_TOKENS: KVNamespace;
  /**
   * `Sandbox` Durable Object namespace (issue #131 phase 3c) — backs
   * `proposeSourceEdit`. Typed as `DurableObjectNamespace<Sandbox>`
   * so `getSandbox(env.Sandbox, ...)` surfaces the full RPC method
   * union at call sites.
   */
  Sandbox: DurableObjectNamespace<Sandbox>;
  /**
   * Cloudflare Artifacts binding (issue #168 Wave 1) — backs
   * `createDeckDraft` + `iterateOnDeckDraft`. Repos are forks of the
   * `deck-starter` baseline (one-time Worker E setup).
   */
  ARTIFACTS: Artifacts;
  /**
   * Workers AI binding — Workers AI calls inside the deck-draft
   * tools (separate from the agent's main streamText loop) go via
   * this binding + the AI Gateway.
   */
  AI: Ai;
}

const KV_DECK = (slug: string) => `deck:${slug}`;

/**
 * Pull the authenticated user's email from the current execution
 * context. Tools that hit GitHub need this to look up the per-user
 * OAuth token in `GITHUB_TOKENS` KV.
 *
 * Two paths, tried in order:
 *
 *   1. `getCurrentAgent().request` — set by the SDK during the HTTP
 *      `onRequest` hook and the WebSocket upgrade `onConnect` hook.
 *      Parse the Access-issued email header off it directly.
 *
 *   2. `getCurrentAgent().connection?.state?.email` — fallback for
 *      the WebSocket-frame path that drives `onChatMessage`. The SDK
 *      runs `onMessage` (and the tool `execute` callbacks it
 *      triggers) inside an `AsyncLocalStorage` context with
 *      `request: undefined` but `connection` populated. To bridge
 *      the gap, `DeckAuthorAgent.onConnect` stashes the email on
 *      connection state via `connection.setState({ email })`; we
 *      read it back here. `Connection.setState` persists into the
 *      WebSocket attachment per partyserver's contract, so this
 *      survives DO hibernation.
 *
 *   3. Otherwise return `null`. Service-token connections legitimately
 *      hit this branch — they pass `requireAccessAuth` via the JWT
 *      signal but carry no user identity. Tool runners that need an
 *      email surface a friendly "no user identity" error.
 *
 * Wrapped + exported so it can be stubbed in tests. See issue #131
 * item B for the SDK-internal investigation that surfaced the
 * `onMessage` / `onConnect` request-availability asymmetry.
 */
export function currentUserEmail(): string | null {
  try {
    const ctx = getCurrentAgent();
    // Prefer the current request's Access header — it's the most
    // recently-issued auth signal for this call, so it wins over
    // anything potentially stale on connection state.
    if (ctx.request) {
      const fromReq = getAccessUserEmail(ctx.request);
      if (fromReq) return fromReq;
    }
    // Fallback: read whatever DeckAuthorAgent.onConnect stashed on
    // the connection at upgrade time. The SDK's strict typing on
    // `Connection.state` is `unknown`; this module owns the schema
    // (just `{ email: string }`), so a narrow local cast is fine.
    const state = ctx.connection?.state as
      | { email?: string | null }
      | null
      | undefined;
    return state?.email ?? null;
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
 * Result of `proposeSourceEdit` — the source-deck PR-based write flow
 * (issue #131 phase 3c). The model sees this and decides whether to
 * iterate (on failure) or stop talking and let the human review the
 * PR (on success). Discriminated by `ok` then by `phase` so the chat
 * UI can render a tailored summary for each stage's failure mode.
 */
export type ProposeSourceEditResult =
  | {
      ok: true;
      prNumber: number;
      prHtmlUrl: string;
      branch: string;
      commitSha: string;
      /**
       * Each phase of the test gate's per-phase result. Useful for
       * the UI to summarise "all four gates passed" without making
       * the model re-quote them in chat.
       */
      testGatePhases: PhaseResult[];
    }
  | {
      ok: false;
      /**
       * Which step of the pipeline failed — surfaced separately so
       * the model can suggest the right remediation (re-prompt the
       * user vs. re-attempt vs. give up).
       */
      phase:
        | "auth"
        | "github_token"
        | "clone"
        | "apply"
        | "test_gate"
        | "commit_push"
        | "open_pr";
      error: string;
      /** Set when phase === 'test_gate'. */
      failedTestGatePhase?: TestGatePhase;
      testGatePhases?: PhaseResult[];
      /** Set when phase === 'apply'. */
      failedPath?: string;
      /** Set when phase === 'commit_push' and the diff was empty. */
      noEffectiveChanges?: boolean;
    };

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

    createDeckDraft: tool({
      description:
        "Start a NEW deck draft. Forks the `deck-starter` Cloudflare " +
        "Artifacts repo (creating `${userEmail}-${slug}` if it doesn't " +
        "exist), spawns a Sandbox, asks Workers AI to write a complete " +
        "set of JSX files for a deck about the user's prompt, commits " +
        "+ pushes to the fork. Use when the user wants to START a new " +
        "deck. Pick a kebab-case slug from the prompt (e.g. \"build me " +
        "a deck about CRDT collaboration\" → slug `crdt-collab`). " +
        "Returns the draft ID + commit SHA. The draft is NOT published " +
        "to GitHub or live decks — call `publishDraft` later for that.",
      inputSchema: z.object({
        slug: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, {
            message:
              "Slug must be kebab-case: lowercase letters / digits / hyphens, " +
              "starting with a letter, ending with letter or digit.",
          })
          .describe(
            "Kebab-case slug for the new deck. Derive from the prompt's topic.",
          ),
        prompt: z
          .string()
          .min(3)
          .max(2_000)
          .describe(
            "The user's natural-language description of the deck. Pass through verbatim.",
          ),
      }),
      execute: async ({ slug, prompt }): Promise<DeckDraftToolResult> => {
        return runCreateDeckDraftTool(env, slug, prompt);
      },
    }),

    iterateOnDeckDraft: tool({
      description:
        "Iterate on an EXISTING deck draft. Resolves the user's " +
        "`${userEmail}-${slug}` Artifacts repo, clones HEAD, sends the " +
        "current files + the user's prompt to Workers AI as context, " +
        "applies the diff, commits + pushes a follow-up revision. Use " +
        "when the user wants to MODIFY an existing draft (the agent's " +
        "instance name is usually the slug). Returns the new commit " +
        "SHA. If the draft doesn't exist yet, returns a `fork`-phase " +
        "error — call `createDeckDraft` first in that case.",
      inputSchema: z.object({
        slug: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/)
          .describe(
            "Kebab-case slug of the existing draft. Usually matches the agent instance name.",
          ),
        prompt: z
          .string()
          .min(3)
          .max(2_000)
          .describe(
            "The user's prompt describing the change they want to make.",
          ),
        pinnedElements: z
          .array(
            z.object({
              file: z.string(),
              lineStart: z.number().int().positive(),
              lineEnd: z.number().int().positive(),
              htmlExcerpt: z.string(),
            }),
          )
          .max(20)
          .optional()
          .describe(
            "Optional pinned elements from the inspector. The model " +
              "scopes its edits to ONLY these source ranges unless the " +
              "prompt explicitly broadens scope.",
          ),
      }),
      execute: async ({
        slug,
        prompt,
        pinnedElements,
      }): Promise<DeckDraftToolResult> => {
        return runIterateOnDeckDraftTool(env, slug, prompt, pinnedElements);
      },
    }),

    proposeSourceEdit: tool({
      description:
        "Propose source-file edits to the Slide of Hand repo " +
        `(${TARGET_REPO.owner}/${TARGET_REPO.repo}) ` +
        "as a Sandbox-validated draft PULL REQUEST. " +
        "This is how to make REAL CHANGES to build-time JSX decks, " +
        "framework code, or any other non-data file. The workflow: " +
        "(1) we spawn an isolated Cloudflare Sandbox, " +
        "(2) clone the repo with the user's GitHub OAuth, " +
        "(3) apply your proposed file edits, " +
        "(4) run the full test gate (`npm ci` → typecheck → " +
        "vitest → build), " +
        "(5) commit + push a fresh `agent/<slug>-<timestamp>` branch, " +
        "(6) open a DRAFT pull request the user reviews on GitHub. " +
        "Use this tool ONLY after exploring the relevant source via " +
        "`listSourceTree` / `readSource`, so your file contents are " +
        "complete (each `files[].content` REPLACES the file wholesale). " +
        "The PR is opened as a draft — the user reviews + merges on " +
        "GitHub, NOT via chat confirmation. Return the PR URL to the " +
        "user when this succeeds; do NOT pretend a change has shipped " +
        "until the user has merged the PR themselves.",
      inputSchema: z.object({
        files: z
          .array(
            z.object({
              path: z
                .string()
                .describe(
                  "Path relative to repo root, e.g. " +
                    "`src/decks/public/hello/01-title.tsx`. " +
                    "Forward-slash separated. No leading `/`. No `..`.",
                ),
              content: z
                .string()
                .describe(
                  "The COMPLETE new file content. This REPLACES the " +
                    "file wholesale — use `readSource` first to fetch " +
                    "the current content + make your edits, otherwise " +
                    "you'll lose existing code.",
                ),
            }),
          )
          .min(1)
          .describe(
            "One or more file edits. Each entry replaces the named " +
              "file's content wholesale.",
          ),
        summary: z
          .string()
          .min(3)
          .max(72)
          .describe(
            "One-line summary used as the PR title + commit subject. " +
              "Keep it human-readable, e.g. 'tighten title slide copy'.",
          ),
        prDescription: z
          .string()
          .optional()
          .describe(
            "Optional Markdown PR body — typically a short rationale + " +
              "test plan. The bot adds the test-gate result automatically.",
          ),
      }),
      execute: async ({
        files,
        summary,
        prDescription,
      }): Promise<ProposeSourceEditResult> => {
        return runProposeSourceEdit(env, slug, {
          files,
          summary,
          prDescription,
        });
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

// ─── proposeSourceEdit runner (issue #131 phase 3c) ─────────────────

export interface ProposeSourceEditInput {
  files: FileEdit[];
  summary: string;
  prDescription?: string;
}

/**
 * Optional dependency-injection hook for tests. The runner uses
 * `getSandbox` from `@cloudflare/sandbox` by default. Tests pass an
 * override so the SDK doesn't have to be reachable from happy-dom.
 */
export type GetSandboxFn = (
  namespace: DurableObjectNamespace<Sandbox>,
  id: string,
) => Sandbox;

/**
 * Sandbox-validated source-edit flow (issue #131 phase 3c). Composes
 * the five helpers from `worker/sandbox-source-edit.ts` +
 * `openPullRequest` from `worker/github-client.ts`:
 *
 *   auth → token lookup → clone → applyFiles → testGate → commit/push → openPR
 *
 * Each step has its own discriminant on the `ok: false` branch so the
 * model + UI can render the right next action. Importantly, the
 * runner does NOT swallow underlying errors — it propagates them
 * verbatim (or as close as possible) so the model can iterate when
 * the failure is recoverable (e.g. typecheck red) and stop cleanly
 * when it isn't (e.g. user hasn't connected GitHub).
 *
 * **Idempotency.** The sandbox ID is keyed by `<deck-slug>` so
 * sequential proposeSourceEdit invocations on the same deck reuse
 * the warmed container (~saves the boot cost of subsequent attempts
 * in the same chat). The first step inside the container is a fresh
 * clone, so the working tree is always clean — no leakage between
 * invocations.
 */
export async function runProposeSourceEdit(
  env: AgentToolsEnv,
  slug: string,
  input: ProposeSourceEditInput,
  /**
   * Test hook — defaults to the real `getSandbox`. Real callers
   * don't pass this.
   */
  getSandboxFn: GetSandboxFn = getSandbox,
  /**
   * Same hook for the current user's email. Mirrors `runCommitPatch`'s
   * `emailOverride` pattern so tests can pin the identity without
   * stubbing `getCurrentAgent` globally.
   */
  emailOverride?: string | null,
): Promise<ProposeSourceEditResult> {
  // 1. Auth: resolve the current user's email.
  const email =
    emailOverride !== undefined ? emailOverride : currentUserEmail();
  if (!email) {
    return {
      ok: false,
      phase: "auth",
      error:
        "Source-edit flow requires an authenticated user. Service-token " +
        "contexts have no user identity to commit on behalf of.",
    };
  }

  // 2. Token lookup: the per-user GitHub OAuth token. Same KV path
  // as `commitPatch`'s GitHub-backup leg.
  const stored = await getStoredGitHubToken(env, email);
  if (!stored) {
    return {
      ok: false,
      phase: "github_token",
      error:
        "GitHub not connected. Ask the user to open Settings → GitHub → " +
        "Connect, then retry. This flow needs the user's GitHub " +
        "credentials to clone the repo and open the PR.",
    };
  }

  // Spawn / warm the sandbox.
  const sandbox = getSandboxFn(env.Sandbox, `source-edit:${slug}`);

  // 3. Clone the repo into the sandbox.
  const clone = await cloneRepoIntoSandbox(sandbox, {
    token: stored.token,
    repo: TARGET_REPO,
  });
  if (!clone.ok) {
    return { ok: false, phase: "clone", error: clone.error };
  }

  // 4. Apply the proposed file edits.
  const apply = await applyFilesIntoSandbox(
    sandbox,
    input.files,
    clone.workdir,
  );
  if (!apply.ok) {
    return {
      ok: false,
      phase: "apply",
      error: apply.error,
      failedPath: apply.failedPath,
    };
  }

  // 5. Run the test gate. This is the slow step — typically 30-60 s
  // for the project's full vitest suite + tsc + vite build.
  const gate = await runSandboxTestGate(sandbox, clone.workdir);
  if (!gate.ok) {
    return {
      ok: false,
      phase: "test_gate",
      failedTestGatePhase: gate.failedPhase,
      testGatePhases: gate.phases,
      error: `Test gate failed at the \`${gate.failedPhase}\` phase.`,
    };
  }

  // 6. Commit + push a fresh branch.
  const branchName = `agent/${slug}-${Date.now()}`;
  const authorName = stored.username ?? "slide-of-hand-agent";
  const authorEmail = stored.username
    ? `${stored.userId}+${stored.username}@users.noreply.github.com`
    : "agent@slide-of-hand.local";
  const commitResult = await commitAndPushInSandbox(
    sandbox,
    {
      branchName,
      authorName,
      authorEmail,
      commitMessage: input.summary,
    },
    clone.workdir,
  );
  if (!commitResult.ok) {
    return {
      ok: false,
      phase: "commit_push",
      error: commitResult.error,
      noEffectiveChanges: commitResult.noEffectiveChanges,
    };
  }

  // 7. Open the draft PR.
  const prBody = buildPullRequestBody(input, gate.phases);
  const pr = await openPullRequest({
    token: stored.token,
    head: commitResult.branch,
    title: input.summary,
    body: prBody,
    draft: true,
  });
  if (!pr.ok) {
    return {
      ok: false,
      phase: "open_pr",
      error: ghErrorMessage(pr),
    };
  }

  return {
    ok: true,
    prNumber: pr.result.number,
    prHtmlUrl: pr.result.htmlUrl,
    branch: commitResult.branch,
    commitSha: commitResult.sha,
    testGatePhases: gate.phases,
  };
}

// ─── createDeckDraft + iterateOnDeckDraft tool runners ──────────────

export type DeckDraftToolResult = DeckDraftResult | DeckDraftError;

/**
 * Tool runner for `createDeckDraft`. Resolves the user's email from
 * the current AsyncLocalStorage context + delegates to
 * `runCreateDeckDraft` in `sandbox-deck-creation.ts`. Surfaces a
 * friendly auth error for service-token contexts (which have no
 * user identity).
 */
export async function runCreateDeckDraftTool(
  env: AgentToolsEnv,
  slug: string,
  prompt: string,
  emailOverride?: string | null,
): Promise<DeckDraftToolResult> {
  const email =
    emailOverride !== undefined ? emailOverride : currentUserEmail();
  if (!email) {
    return {
      ok: false,
      phase: "validation",
      error:
        "createDeckDraft requires an interactive user identity. " +
        "Service-token contexts can't create per-user drafts.",
    };
  }
  return runCreateDeckDraft(env, {
    userEmail: email,
    slug,
    prompt,
  });
}

/**
 * Tool runner for `iterateOnDeckDraft`. Mirrors `runCreateDeckDraftTool`
 * but for the iteration flow.
 */
export async function runIterateOnDeckDraftTool(
  env: AgentToolsEnv,
  slug: string,
  prompt: string,
  pinnedElements?: Array<{
    file: string;
    lineStart: number;
    lineEnd: number;
    htmlExcerpt: string;
  }>,
  emailOverride?: string | null,
): Promise<DeckDraftToolResult> {
  const email =
    emailOverride !== undefined ? emailOverride : currentUserEmail();
  if (!email) {
    return {
      ok: false,
      phase: "validation",
      error:
        "iterateOnDeckDraft requires an interactive user identity. " +
        "Service-token contexts can't iterate on per-user drafts.",
    };
  }
  return runIterateOnDeckDraft(env, {
    userEmail: email,
    slug,
    prompt,
    ...(pinnedElements ? { pinnedElements } : {}),
  });
}

/**
 * Compose the PR body. Prefers the model's `prDescription` (if it
 * provided one); always appends an auto-generated test-gate summary
 * so the human reviewer sees the install/typecheck/test/build status
 * straight from the PR.
 */
function buildPullRequestBody(
  input: ProposeSourceEditInput,
  phases: PhaseResult[],
): string {
  const lines: string[] = [];
  if (input.prDescription && input.prDescription.trim().length > 0) {
    lines.push(input.prDescription.trim(), "", "---", "");
  }
  lines.push(
    "Opened by the in-Studio AI agent (`proposeSourceEdit`).",
    "",
    "## Test gate",
    "",
    "| Phase | Command | Exit | Status |",
    "| --- | --- | --- | --- |",
    ...phases.map(
      (p) =>
        `| \`${p.phase}\` | \`${p.command}\` | ${p.exitCode} | ${p.ok ? "✅" : "❌"} |`,
    ),
  );
  return lines.join("\n");
}
