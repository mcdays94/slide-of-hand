/**
 * Sandbox-side orchestrators for AI-driven deck creation (issue #168
 * Wave 1 / Worker A).
 *
 * Composes:
 *   - `worker/artifacts-client.ts` for fork + token minting against
 *     the Cloudflare Artifacts binding.
 *   - `worker/sandbox-artifacts.ts` for the Sandbox-side git clone
 *     + commit/push specifically against the Artifacts git protocol.
 *   - `worker/sandbox-source-edit.ts` for the generic file-write
 *     helper (`applyFilesIntoSandbox`).
 *   - `worker/ai-deck-gen.ts` for the Workers AI call that produces
 *     the actual TSX files for the deck.
 *
 * ## Three orchestrators
 *
 *   1. `runCreateDeckDraft` — first turn for a new (or resumed) draft.
 *      Creates a new (empty) Artifacts repo for the draft (idempotent),
 *      spawns a Sandbox, clones the repo, asks Workers AI to write JSX
 *      files, applies them, commits + pushes back to the Artifacts
 *      repo, returns the resulting commit SHA + a draft ID.
 *
 *      Note: this used to literally fork the `deck-starter` baseline
 *      via `starter.fork()`, but switched to `Artifacts.create()`
 *      in the #182 workaround. See `artifacts-client.ts`
 *      `createDraftRepo` for the rationale. The phase strip's "fork"
 *      label is preserved as a semantic name for the "draft repo
 *      creation" step.
 *
 *   2. `runIterateOnDeckDraft` — subsequent turns on an existing
 *      draft. Resolves the existing fork, clones HEAD, runs AI gen
 *      with the existing files as context, commits a follow-up
 *      revision, returns the new SHA.
 *
 *   3. `runPublishDraft` — DEFERRED. Will run the full slide-of-hand
 *      test gate + push to GitHub on a `deck/<slug>` branch + open a
 *      draft PR. Sitting in a stub until the publish flow is fleshed
 *      out (#168 Wave 1 follow-up).
 *
 * ## Iteration test gate
 *
 * Iteration does NOT run a test gate today. The Artifacts working
 * tree doesn't have the framework types resolved (no `node_modules`,
 * no `tsconfig`), so a standalone typecheck would fail on every
 * `@/framework/viewer/types` import. The publish flow's full
 * slide-of-hand test gate catches schema violations + brand-token
 * issues + render errors. For v1 we trust the model's output on
 * iteration and validate at publish.
 *
 * If iteration-time validation becomes important later, two options:
 *   - Bundle the framework types into the deck-starter baseline so
 *     a standalone `tsc --noEmit` works against the cloned repo.
 *   - Run the cheap-ish `npx tsc --noEmit --skipLibCheck` against
 *     just the generated files, accepting unresolved imports as
 *     warnings.
 */

import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import {
  buildArtifactsRemoteUrl,
  buildAuthenticatedRemoteUrl,
  draftRepoName,
  ensureDraftRepo,
  getDraftRepo,
  mintWriteToken,
  stripExpiresSuffix,
} from "./artifacts-client";
import {
  cloneArtifactsRepoIntoSandbox,
  commitAndPushToArtifactsInSandbox,
} from "./sandbox-artifacts";
import {
  applyFilesIntoSandbox,
  cloneRepoIntoSandbox,
  commitAndPushInSandbox,
  runSandboxTestGate,
  type TestGatePhase,
  type PhaseResult as TestGatePhaseResult,
} from "./sandbox-source-edit";
import {
  openPullRequest,
  SLIDE_OF_HAND_COMMIT_IDENTITY,
  TARGET_REPO,
} from "./github-client";
import { getStoredGitHubToken } from "./github-oauth";
import { streamDeckFiles, type DeckGenPartial } from "./ai-deck-gen";
import type { DeckCreationSnapshot } from "../src/lib/deck-creation-snapshot";

export interface SandboxDeckCreationEnv {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ARTIFACTS: Artifacts;
  AI: Ai;
  /**
   * Cloudflare account ID. Set via `vars.CF_ACCOUNT_ID` in
   * `wrangler.jsonc`. Used to construct the Artifacts remote URL
   * deterministically (see `buildArtifactsRemoteUrl` for why we
   * can't trust `repo.remote` from the SDK). The same value also
   * powers the analytics SQL endpoint.
   *
   * Typed as optional to match `AnalyticsEnv.CF_ACCOUNT_ID`'s
   * existing convention — the var is always set in production
   * (wrangler.jsonc enforces it) but the optional type lets the
   * Worker's top-level `Env` cleanly extend both env interfaces.
   * Runtime check in the orchestrator throws if it's missing.
   */
  CF_ACCOUNT_ID?: string;
  /**
   * AI Gateway authentication token (Worker secret
   * `CF_AI_GATEWAY_TOKEN`). Threaded through to `streamDeckFiles`
   * so the model call carries `cf-aig-authorization: Bearer <token>`
   * when the gateway requires auth. Optional — unset means the
   * gateway is unauthenticated.
   */
  CF_AI_GATEWAY_TOKEN?: string;
}

export interface CreateDeckDraftInput {
  userEmail: string;
  slug: string;
  prompt: string;
  /**
   * Intended publish-time visibility of the deck. Threaded through
   * to `streamDeckFiles` so the AI's generated `meta.ts` carries
   * the correct value. Defaults to "private" when unset (safer
   * floor than the reverse). Issue #171 visibility toggle.
   */
  visibility?: "public" | "private";
  /**
   * Optional reference URLs (Wave 3) — fetched + readability-stripped
   * + attached as system-prompt context. Out of scope for Wave 1 but
   * plumbed through so Wave 3 can land without disturbing the tool
   * contract.
   */
  references?: string[];
  /** Optional model override (from the Settings model picker). */
  modelId?: string;
}

export interface IterateOnDeckDraftInput {
  userEmail: string;
  slug: string;
  prompt: string;
  /** Wave 2 — pinned elements from the inspector. */
  pinnedElements?: Array<{
    file: string;
    lineStart: number;
    lineEnd: number;
    htmlExcerpt: string;
  }>;
  references?: string[];
  modelId?: string;
}

export interface DeckDraftResult {
  ok: true;
  /**
   * The Artifacts repo name (== draftRepoName(userEmail, slug)).
   * Forms the URL for downstream preview / publish.
   */
  draftId: string;
  /** The commit SHA we just pushed. */
  commitSha: string;
  /** The branch we pushed to (always `main` for now). */
  branch: string;
  /** Number of files written this turn. */
  fileCount: number;
  /** Commit message — surfaced in the chat UI's success message. */
  commitMessage: string;
  /**
   * True if a git note carrying the prompt text was pushed alongside
   * the commit. Falsy means the notes push failed (not fatal — the
   * commit is still good).
   */
  promptNotePushed?: boolean;
}

export interface DeckDraftError {
  ok: false;
  phase:
    | "validation"
    | "fork"
    | "token"
    | "clone"
    | "ai_generation"
    | "apply_files"
    | "commit_push";
  error: string;
  /** AI gen sub-phase when phase === 'ai_generation'. */
  aiGenPhase?:
    | "model_error"
    | "schema_violation"
    | "path_violation"
    | "no_files";
}

/**
 * Re-export `DeckCreationSnapshot` from the shared types module. The
 * shape lives in `src/lib/deck-creation-snapshot.ts` because both
 * `tsconfig.app.json` (frontend) and `tsconfig.node.json` (worker)
 * need to type-check against it, and pulling it out of `worker/`
 * avoids transitively dragging Cloudflare ambient types (`Artifacts`,
 * `Ai`, ...) into the frontend type-check. See ADR 0002.
 */
export type { DeckCreationSnapshot } from "../src/lib/deck-creation-snapshot";
export type { DeckGenPartial } from "../src/lib/deck-creation-snapshot";

export type GetSandboxFn = (
  namespace: DurableObjectNamespace<Sandbox>,
  id: string,
) => Sandbox;

/**
 * Sandbox key for a given draft. One sandbox per draft so iteration
 * reuses the warmed container. The sandbox is destroyed when the
 * Container is recycled (after idle timeout).
 */
function sandboxIdForDraft(draftId: string): string {
  return `deck-draft:${draftId}`;
}

function authorIdentityFor(userEmail: string): {
  name: string;
  email: string;
} {
  // The Artifacts repo history is per-user, so use the user's actual
  // email rather than a generic "agent" identity. Display name is
  // derived from the local part of the email.
  const localPart = userEmail.split("@")[0] ?? "user";
  return { name: localPart, email: userEmail };
}

function buildPromptNote(prompt: string, modelId?: string): string {
  const lines = [`prompt: ${prompt}`];
  if (modelId) lines.push(`model: ${modelId}`);
  lines.push(`at: ${new Date().toISOString()}`);
  return lines.join("\n");
}

/**
 * Flip a stream-derived files array (last entry "writing") into the
 * "all done" shape used by snapshots from `apply` onwards. Saves
 * the orchestrator from rebuilding the same map at every phase
 * boundary post-AI-gen.
 */
function asAllDone(
  files: Array<{ path: string; content: string }>,
): DeckCreationSnapshot["files"] {
  return files.map((f) => ({
    path: f.path,
    content: f.content,
    state: "done" as const,
  }));
}

/**
 * Translate a single `DeckGenPartial` from `streamDeckFiles` into the
 * envelope shape consumed by the canvas. Adds `phase: "ai_gen"` and
 * (when known) the draftId. Keeps `currentFile` / `commitMessage`
 * fields when the partial includes them.
 */
function aiGenSnapshotFromPartial(
  partial: DeckGenPartial,
  draftId: string,
): DeckCreationSnapshot {
  const snap: DeckCreationSnapshot = {
    phase: "ai_gen",
    files: partial.files,
    draftId,
  };
  if (partial.currentFile !== undefined) snap.currentFile = partial.currentFile;
  if (partial.commitMessage !== undefined) {
    snap.commitMessage = partial.commitMessage;
  }
  return snap;
}

/**
 * First-turn deck creation. Creates the draft Artifacts repo
 * (idempotent), clones it into a fresh Sandbox, asks Workers AI for
 * the deck files (streaming), applies + commits + pushes them.
 *
 * **Async generator**: yields a `DeckCreationSnapshot` at every phase
 * boundary AND for each partial yielded by `streamDeckFiles` during
 * `ai_gen`. Returns the lean `DeckDraftResult | DeckDraftError` once
 * the pipeline terminates — that return value is what the model sees
 * as the tool result (see ADR 0002).
 *
 * Validation failures return directly without yielding — the UI
 * hasn't pivoted yet at that point. All later failures yield an
 * `error` snapshot AND return the appropriate `DeckDraftError` so
 * both consumers (canvas + model) are kept in sync.
 *
 * Issue #178 sub-pieces (1) + (3).
 */
export async function* runCreateDeckDraft(
  env: SandboxDeckCreationEnv,
  input: CreateDeckDraftInput,
  /** Test hook. Defaults to the real `getSandbox`. */
  getSandboxFn: GetSandboxFn = getSandbox,
): AsyncGenerator<DeckCreationSnapshot, DeckDraftResult | DeckDraftError> {
  if (!input.userEmail.trim()) {
    return {
      ok: false,
      phase: "validation",
      error: "Missing user email — service-token contexts can't create drafts.",
    };
  }
  if (!input.slug.trim()) {
    return { ok: false, phase: "validation", error: "Missing deck slug." };
  }
  if (!input.prompt.trim()) {
    return { ok: false, phase: "validation", error: "Missing prompt." };
  }

  // Phase 1: "fork". Yield the boundary BEFORE the call so the
  // canvas can show "draft creation in progress" while Artifacts
  // provisions the empty repo.
  //
  // Note: the phase name "fork" is preserved for backwards
  // compatibility with the existing canvas phase strip + chip UI.
  // The implementation switched from `starter.fork()` to
  // `Artifacts.create()` in #182's workaround (see
  // `artifacts-client.ts` `createDraftRepo` for the rationale).
  // Semantically the phase still means "draft repo creation".
  yield { phase: "fork", files: [] };

  let remoteUrl: string;
  let token: string;
  try {
    const draftResult = await ensureDraftRepo(
      env.ARTIFACTS,
      input.userEmail,
      input.slug,
    );
    // SDK quirk workaround: do NOT read `.remote` off the SDK's
    // result — `Artifacts.get(name)`'s returned handle has
    // unreliable getters (see `buildArtifactsRemoteUrl`'s docstring
    // for the diag-confirmed evidence). The handle's METHODS
    // (`createToken`, etc.) work, so we pluck the token from the
    // appropriate branch but construct the remote URL ourselves.
    remoteUrl = buildArtifactsRemoteUrl({
      accountId: env.CF_ACCOUNT_ID,
      repoName: draftRepoName(input.userEmail, input.slug),
    });
    if (draftResult.kind === "created") {
      token = draftResult.result.token;
    } else {
      token = draftResult.freshWriteToken.plaintext;
    }
  } catch (err) {
    const errorMsg = `Failed to create draft repo: ${err instanceof Error ? err.message : String(err)}`;
    yield { phase: "error", files: [], error: errorMsg, failedPhase: "fork" };
    return { ok: false, phase: "fork", error: errorMsg };
  }

  let authenticatedUrl: string;
  try {
    authenticatedUrl = buildAuthenticatedRemoteUrl(remoteUrl, token);
  } catch (err) {
    const errorMsg = `Failed to build authenticated URL: ${err instanceof Error ? err.message : String(err)}`;
    // `token` is a DeckDraftError phase but not a canvas phase — the
    // strip's "fork" chip is the closest visible step (token-build
    // happens right after fork success). Marking it red is honest
    // enough for the user.
    yield { phase: "error", files: [], error: errorMsg, failedPhase: "fork" };
    return { ok: false, phase: "token", error: errorMsg };
  }

  const draftId = draftRepoName(input.userEmail, input.slug);
  const sandbox = getSandboxFn(env.Sandbox, sandboxIdForDraft(draftId));

  // Phase 2: clone.
  yield { phase: "clone", files: [], draftId };

  const clone = await cloneArtifactsRepoIntoSandbox(sandbox, {
    authenticatedUrl,
  });
  if (!clone.ok) {
    yield {
      phase: "error",
      files: [],
      error: clone.error,
      draftId,
      failedPhase: "clone",
    };
    return { ok: false, phase: "clone", error: clone.error };
  }

  // Phase 3: AI generation. Yield the boundary first so the canvas can
  // flip to "model is thinking" before the first partial arrives, then
  // forward each `partialObjectStream` partial as its own `ai_gen`
  // snapshot.
  yield { phase: "ai_gen", files: [], draftId };

  const aiStream = streamDeckFiles(env.AI, {
    slug: input.slug,
    userPrompt: input.prompt,
    // Default to private — the new-deck creator UI's toggle also
    // defaults to private, and the model is instructed to pass that
    // default through unless the user overrides. Floor case in case
    // neither the UI nor the model supplies a value.
    visibility: input.visibility ?? "private",
  }, {
    ...(input.modelId ? { modelId: input.modelId } : {}),
    // Thread the AI Gateway token through so the Workers AI call
    // can authenticate against the gateway when it's set to
    // Authenticated. No-op when the secret isn't set.
    ...(env.CF_AI_GATEWAY_TOKEN
      ? { gatewayToken: env.CF_AI_GATEWAY_TOKEN }
      : {}),
  });

  for await (const partial of aiStream.partials) {
    yield aiGenSnapshotFromPartial(partial, draftId);
  }

  const aiResult = await aiStream.result;
  if (!aiResult.ok) {
    yield {
      phase: "error",
      files: [],
      error: aiResult.error,
      draftId,
      failedPhase: "ai_gen",
    };
    return {
      ok: false,
      phase: "ai_generation",
      aiGenPhase: aiResult.phase,
      error: aiResult.error,
    };
  }

  // Files are now committed (in the model's output sense, not git
  // sense yet) — flip them all to "done" for the post-AI-gen phases.
  const doneFiles = asAllDone(aiResult.files);

  // Phase 4: apply files into the Sandbox working tree.
  yield {
    phase: "apply",
    files: doneFiles,
    commitMessage: aiResult.commitMessage,
    draftId,
  };

  const apply = await applyFilesIntoSandbox(
    sandbox,
    aiResult.files,
    clone.workdir,
  );
  if (!apply.ok) {
    const errorMsg = `Failed to write generated files: ${apply.error}${
      apply.failedPath ? ` (path: ${apply.failedPath})` : ""
    }`;
    yield {
      phase: "error",
      files: doneFiles,
      error: errorMsg,
      draftId,
      failedPhase: "apply",
    };
    return { ok: false, phase: "apply_files", error: errorMsg };
  }

  // Phase 5: commit + push (atomic helper).
  yield {
    phase: "commit",
    files: doneFiles,
    commitMessage: aiResult.commitMessage,
    draftId,
  };

  const authorIdentity = authorIdentityFor(input.userEmail);
  const commitResult = await commitAndPushToArtifactsInSandbox(
    sandbox,
    {
      authenticatedUrl,
      branchName: "main",
      commitMessage: aiResult.commitMessage,
      authorName: authorIdentity.name,
      authorEmail: authorIdentity.email,
      promptNote: buildPromptNote(input.prompt, input.modelId),
    },
    clone.workdir,
  );
  if (!commitResult.ok) {
    yield {
      phase: "error",
      files: doneFiles,
      error: commitResult.error,
      draftId,
      failedPhase: "commit",
    };
    return { ok: false, phase: "commit_push", error: commitResult.error };
  }

  // Phase 6: push. The underlying helper does commit + push
  // atomically; the separate yield keeps the canvas's six-chip phase
  // strip honest about progressing past commit. UI consumers may see
  // this and `done` arrive back-to-back; that's fine — the chip flips
  // through `push` then immediately to `done`.
  yield {
    phase: "push",
    files: doneFiles,
    commitMessage: aiResult.commitMessage,
    draftId,
  };

  // Wipe the locally-held bare token before returning. Defence in
  // depth — the generator's closure stays alive until GC, so the
  // token would otherwise be retrievable via a `.return()` trick.
  token = stripExpiresSuffix("redacted");
  void token;

  // Terminal: yield the success snapshot (commitSha now populated),
  // then return the lean `DeckDraftResult` for the model.
  yield {
    phase: "done",
    files: doneFiles,
    commitMessage: aiResult.commitMessage,
    commitSha: commitResult.sha,
    draftId,
  };

  const result: DeckDraftResult = {
    ok: true,
    draftId,
    commitSha: commitResult.sha,
    branch: commitResult.branch,
    fileCount: aiResult.files.length,
    commitMessage: aiResult.commitMessage,
  };
  if (typeof commitResult.promptNotePushed === "boolean") {
    result.promptNotePushed = commitResult.promptNotePushed;
  }
  return result;
}

/**
 * Iteration on an existing draft. Resolves the existing fork, clones
 * HEAD into a Sandbox, sends the existing files (+ optional pinned
 * elements) as context to Workers AI (streaming), applies the
 * resulting diff, commits + pushes a follow-up revision.
 *
 * Same async-generator contract as `runCreateDeckDraft` — yields
 * `DeckCreationSnapshot`s for the canvas, returns
 * `DeckDraftResult | DeckDraftError` for the model. The phase
 * sequence is the same; semantically `fork` here means "resolving the
 * existing draft + minting a write token", not literal git-fork.
 *
 * Issue #178 sub-piece (1) — symmetric with `runCreateDeckDraft` so
 * the orchestrators can't drift on snapshot shape.
 */
export async function* runIterateOnDeckDraft(
  env: SandboxDeckCreationEnv,
  input: IterateOnDeckDraftInput,
  /** Test hook. Defaults to the real `getSandbox`. */
  getSandboxFn: GetSandboxFn = getSandbox,
): AsyncGenerator<DeckCreationSnapshot, DeckDraftResult | DeckDraftError> {
  if (!input.userEmail.trim()) {
    return {
      ok: false,
      phase: "validation",
      error: "Missing user email — service-token contexts can't iterate.",
    };
  }
  if (!input.slug.trim()) {
    return { ok: false, phase: "validation", error: "Missing deck slug." };
  }
  if (!input.prompt.trim()) {
    return { ok: false, phase: "validation", error: "Missing prompt." };
  }

  // Phase 1: "fork" — semantically "resolve existing draft" for the
  // iteration path. Yields the same phase boundary so the canvas's
  // phase strip is consistent across create and iterate.
  yield { phase: "fork", files: [] };

  let remoteUrl: string;
  let token: string;
  try {
    const repo = await getDraftRepo(env.ARTIFACTS, input.userEmail, input.slug);
    const fresh = await mintWriteToken(repo);
    // SDK quirk workaround: ignore `repo.remote` — getters on the
    // handle are unreliable. See `buildArtifactsRemoteUrl`.
    remoteUrl = buildArtifactsRemoteUrl({
      accountId: env.CF_ACCOUNT_ID,
      repoName: draftRepoName(input.userEmail, input.slug),
    });
    token = fresh.plaintext;
  } catch (err) {
    const errorMsg = `Draft not found for slug "${input.slug}". Use createDeckDraft first. (${err instanceof Error ? err.message : String(err)})`;
    yield { phase: "error", files: [], error: errorMsg, failedPhase: "fork" };
    return { ok: false, phase: "fork", error: errorMsg };
  }

  let authenticatedUrl: string;
  try {
    authenticatedUrl = buildAuthenticatedRemoteUrl(remoteUrl, token);
  } catch (err) {
    const errorMsg = `Failed to build authenticated URL: ${err instanceof Error ? err.message : String(err)}`;
    yield { phase: "error", files: [], error: errorMsg, failedPhase: "fork" };
    return { ok: false, phase: "token", error: errorMsg };
  }

  const draftId = draftRepoName(input.userEmail, input.slug);
  const sandbox = getSandboxFn(env.Sandbox, sandboxIdForDraft(draftId));

  // Phase 2: clone HEAD.
  yield { phase: "clone", files: [], draftId };

  const clone = await cloneArtifactsRepoIntoSandbox(sandbox, {
    authenticatedUrl,
  });
  if (!clone.ok) {
    yield {
      phase: "error",
      files: [],
      error: clone.error,
      draftId,
      failedPhase: "clone",
    };
    return { ok: false, phase: "clone", error: clone.error };
  }

  // Read the existing deck files so the AI gen has full context.
  // (Not a separate phase — happens inside the boundary before
  // `ai_gen` yields. The file read is fast, ~10ms typically.)
  const existingFiles = await readDeckFilesFromSandbox(
    sandbox,
    input.slug,
    clone.workdir,
  );

  // Phase 3: AI generation with iteration context.
  yield { phase: "ai_gen", files: [], draftId };

  const aiStream = streamDeckFiles(env.AI, {
    slug: input.slug,
    userPrompt: input.prompt,
    existingFiles,
    ...(input.pinnedElements ? { pinnedElements: input.pinnedElements } : {}),
  }, {
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(env.CF_AI_GATEWAY_TOKEN
      ? { gatewayToken: env.CF_AI_GATEWAY_TOKEN }
      : {}),
  });

  for await (const partial of aiStream.partials) {
    yield aiGenSnapshotFromPartial(partial, draftId);
  }

  const aiResult = await aiStream.result;
  if (!aiResult.ok) {
    yield {
      phase: "error",
      files: [],
      error: aiResult.error,
      draftId,
      failedPhase: "ai_gen",
    };
    return {
      ok: false,
      phase: "ai_generation",
      aiGenPhase: aiResult.phase,
      error: aiResult.error,
    };
  }

  const doneFiles = asAllDone(aiResult.files);

  // Phase 4: apply files.
  yield {
    phase: "apply",
    files: doneFiles,
    commitMessage: aiResult.commitMessage,
    draftId,
  };

  const apply = await applyFilesIntoSandbox(
    sandbox,
    aiResult.files,
    clone.workdir,
  );
  if (!apply.ok) {
    const errorMsg = `Failed to write generated files: ${apply.error}${
      apply.failedPath ? ` (path: ${apply.failedPath})` : ""
    }`;
    yield {
      phase: "error",
      files: doneFiles,
      error: errorMsg,
      draftId,
      failedPhase: "apply",
    };
    return { ok: false, phase: "apply_files", error: errorMsg };
  }

  // Phase 5: commit + push.
  yield {
    phase: "commit",
    files: doneFiles,
    commitMessage: aiResult.commitMessage,
    draftId,
  };

  const authorIdentity = authorIdentityFor(input.userEmail);
  const commitResult = await commitAndPushToArtifactsInSandbox(
    sandbox,
    {
      authenticatedUrl,
      branchName: "main",
      commitMessage: aiResult.commitMessage,
      authorName: authorIdentity.name,
      authorEmail: authorIdentity.email,
      promptNote: buildPromptNote(input.prompt, input.modelId),
    },
    clone.workdir,
  );
  if (!commitResult.ok) {
    yield {
      phase: "error",
      files: doneFiles,
      error: commitResult.error,
      draftId,
      failedPhase: "commit",
    };
    return { ok: false, phase: "commit_push", error: commitResult.error };
  }

  // Phase 6: push (same atomic-helper note as `runCreateDeckDraft`).
  yield {
    phase: "push",
    files: doneFiles,
    commitMessage: aiResult.commitMessage,
    draftId,
  };

  token = stripExpiresSuffix("redacted");
  void token;

  yield {
    phase: "done",
    files: doneFiles,
    commitMessage: aiResult.commitMessage,
    commitSha: commitResult.sha,
    draftId,
  };

  const result: DeckDraftResult = {
    ok: true,
    draftId,
    commitSha: commitResult.sha,
    branch: commitResult.branch,
    fileCount: aiResult.files.length,
    commitMessage: aiResult.commitMessage,
  };
  if (typeof commitResult.promptNotePushed === "boolean") {
    result.promptNotePushed = commitResult.promptNotePushed;
  }
  return result;
}

/**
 * Read all files under `src/decks/public/<slug>/` from the cloned
 * Sandbox working tree. Used by `runIterateOnDeckDraft` to give the
 * AI gen full context of the existing deck.
 *
 * Exported for test introspection — passes the same SandboxLike
 * surface the production helpers use.
 */
export async function readDeckFilesFromSandbox(
  sandbox: Pick<Sandbox, "exec">,
  slug: string,
  workdir: string,
): Promise<Array<{ path: string; content: string }>> {
  const deckDir = `src/decks/public/${slug}`;
  // Print each file with a sentinel header so we can split the output
  // back into per-file chunks. Sentinel includes the relative path so
  // we don't have to track filenames separately.
  const script = `find ${deckDir} -type f \\( -name '*.ts' -o -name '*.tsx' \\) -print0 \
    | xargs -0 -I{} bash -c 'echo "==== FILE: {} ===="; cat "{}"'`;
  let result;
  try {
    result = await sandbox.exec(script, { cwd: workdir });
  } catch {
    return [];
  }
  if (!result.success || !result.stdout) return [];

  const files: Array<{ path: string; content: string }> = [];
  const chunks = result.stdout.split(/^==== FILE: (.+?) ====$\n?/m);
  // chunks: ["", path1, content1, path2, content2, ...]
  for (let i = 1; i < chunks.length; i += 2) {
    const path = chunks[i]?.trim();
    const content = chunks[i + 1] ?? "";
    if (path) {
      files.push({ path, content });
    }
  }
  return files;
}

// ── publishDraft ────────────────────────────────────────────────────

/**
 * Env shape `runPublishDraft` needs. Narrower than
 * `SandboxDeckCreationEnv` (no AI / AI Gateway — publish doesn't
 * generate; it just moves files) but adds `GITHUB_TOKENS` for the
 * per-user OAuth token lookup that authenticates the GitHub clone +
 * PR.
 */
export interface PublishDraftEnv {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ARTIFACTS: Artifacts;
  GITHUB_TOKENS: KVNamespace;
  /**
   * Cloudflare account ID — used for the Artifacts remote-URL
   * construction (see `buildArtifactsRemoteUrl`). Same env var as
   * `SandboxDeckCreationEnv.CF_ACCOUNT_ID`. Optional in the type
   * for parity with `AnalyticsEnv`; runtime-checked below.
   */
  CF_ACCOUNT_ID?: string;
}

export interface PublishDraftInput {
  userEmail: string;
  slug: string;
  /** Reserved for future use — squash-merge hint. Ignored for now. */
  squash?: boolean;
}

export interface PublishDraftResult {
  ok: true;
  branch: string;
  prNumber: number;
  prHtmlUrl: string;
}

export interface PublishDraftError {
  ok: false;
  phase:
    | "auth"
    | "github_token"
    | "artifacts_resolve"
    | "clone_draft"
    | "clone_github"
    | "copy_files"
    | "test_gate"
    | "github_push"
    | "open_pr";
  error: string;
  /** When phase === "test_gate", the gate sub-phase that failed. */
  failedTestGatePhase?: TestGatePhase;
  /** When phase === "test_gate", every gate phase's result (including the failed one). */
  testGatePhases?: TestGatePhaseResult[];
  /** When phase === "github_push" and the diff was empty after `git add -A`. */
  noEffectiveChanges?: boolean;
}

/**
 * Publish a draft from Cloudflare Artifacts to a GitHub PR against
 * `main`. The flow:
 *
 *   1. Auth: confirm the call has a user email (no anonymous publish).
 *   2. Token: resolve the user's stored GitHub OAuth token.
 *   3. Artifacts: resolve the draft repo handle (`${email}-${slug}`).
 *   4. Sandbox: spawn / warm a per-slug container.
 *   5. Clone draft: pull the Artifacts repo into `/workspace/draft`.
 *   6. Clone GitHub: pull `slide-of-hand` into `/workspace/slide-of-hand`.
 *   7. Copy deck folder from draft → GH (`src/decks/public/<slug>/`).
 *   8. Test gate: install → typecheck → test → build against the GH
 *      checkout. Any failure short-circuits here.
 *   9. Commit + push to a fresh `deck/<slug>-<timestamp>` branch.
 *   10. Open a draft PR against `main`.
 *
 * Every step has its own discriminant on the `ok: false` branch so the
 * UI / model can render the right remediation. Underlying errors are
 * propagated verbatim where possible (clone errors, test-gate stderr,
 * GitHub API messages) so the caller can show actionable detail.
 *
 * **Commit identity** is pinned to `SLIDE_OF_HAND_COMMIT_IDENTITY` for
 * the GitHub-bound commit — same reasoning as `runProposeSourceEdit`
 * (see "Cutindah" post-mortem in `worker/github-client.ts`). The user's
 * OAuth token still authorises the push; the author metadata just
 * isn't derived from it.
 */
export async function runPublishDraft(
  env: PublishDraftEnv,
  input: PublishDraftInput,
  getSandboxFn: GetSandboxFn = getSandbox,
): Promise<PublishDraftResult | PublishDraftError> {
  // 1. Auth.
  const email = (input.userEmail ?? "").trim();
  if (!email) {
    return {
      ok: false,
      phase: "auth",
      error:
        "Publishing a draft requires an authenticated user. Service-token " +
        "contexts have no user identity to commit on behalf of.",
    };
  }

  // 2. GitHub token lookup.
  const stored = await getStoredGitHubToken(env, email);
  if (!stored) {
    return {
      ok: false,
      phase: "github_token",
      error:
        "GitHub not connected. Ask the user to open Settings → GitHub → " +
        "Connect, then retry. This flow needs the user's GitHub credentials " +
        "to clone the repo, push a branch, and open the PR.",
    };
  }

  // 3. Resolve the Artifacts draft. `getDraftRepo` throws if the repo
  // doesn't exist (Artifacts treats not-found as an exception); we
  // translate to a clean phase here so the model / UI gets a typed
  // signal rather than a raw thrown error.
  let repo: Awaited<ReturnType<typeof getDraftRepo>>;
  try {
    repo = await getDraftRepo(env.ARTIFACTS, email, input.slug);
  } catch (err) {
    return {
      ok: false,
      phase: "artifacts_resolve",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 4. Sandbox. Keyed by `publish:<slug>` so subsequent publish
  // attempts on the same draft reuse the warmed container — saves
  // the boot cost on retries. Each call starts with fresh clones
  // anyway (steps 5+6 below) so there's no leakage between attempts.
  const sandbox = getSandboxFn(env.Sandbox, `publish:${input.slug}`);

  // 5. Clone the Artifacts draft. We use a write token here even
  // though publish only READS the draft — Artifacts' read-vs-write
  // tokens both grant clone access, but mintWriteToken is the one
  // helper that's wired with sensible TTLs across the existing
  // codebase. The token never leaks out of the Sandbox container,
  // which is torn down after the test gate finishes.
  const readToken = await mintWriteToken(repo);
  // SDK quirk workaround: see `buildArtifactsRemoteUrl`. Don't read
  // `repo.remote` — its getter is unreliable on `Artifacts.get()`
  // handles.
  const draftRemoteUrl = buildArtifactsRemoteUrl({
    accountId: env.CF_ACCOUNT_ID,
    repoName: draftRepoName(email, input.slug),
  });
  const draftAuthUrl = buildAuthenticatedRemoteUrl(
    draftRemoteUrl,
    stripExpiresSuffix(readToken.plaintext),
  );
  const draftClone = await cloneArtifactsRepoIntoSandbox(sandbox, {
    authenticatedUrl: draftAuthUrl,
    workdir: "/workspace/draft",
  });
  if (!draftClone.ok) {
    return { ok: false, phase: "clone_draft", error: draftClone.error };
  }

  // 6. Clone the slide-of-hand GitHub repo into a SEPARATE workdir
  // so step 7 has both checkouts available at once.
  const ghClone = await cloneRepoIntoSandbox(sandbox, {
    token: stored.token,
    repo: TARGET_REPO,
    workdir: "/workspace/slide-of-hand",
  });
  if (!ghClone.ok) {
    return { ok: false, phase: "clone_github", error: ghClone.error };
  }

  // 7. Copy the deck folder from the draft checkout into the GH
  // checkout. We `mkdir -p` the parent first so the cp lands in the
  // right place even if the user's adding a NEW deck slug (parent
  // exists in a fresh checkout but `mkdir -p` is idempotent anyway).
  const srcDir = `${draftClone.workdir}/src/decks/public/${input.slug}`;
  const destParent = `${ghClone.workdir}/src/decks/public`;
  const copyResult = await sandbox.exec(
    `mkdir -p "${destParent}" && cp -r "${srcDir}" "${destParent}/"`,
  );
  if (!copyResult.success || copyResult.exitCode !== 0) {
    return {
      ok: false,
      phase: "copy_files",
      error:
        copyResult.stderr ||
        `Failed to copy draft files from ${srcDir} (exit ${copyResult.exitCode ?? "unknown"}).`,
    };
  }

  // 8. Test gate against the GH checkout. This is the slow step
  // (npm ci alone can be ~30 s; the full gate is 60-120 s).
  const gate = await runSandboxTestGate(sandbox, ghClone.workdir);
  if (!gate.ok) {
    return {
      ok: false,
      phase: "test_gate",
      failedTestGatePhase: gate.failedPhase,
      testGatePhases: gate.phases,
      error: `Test gate failed at the \`${gate.failedPhase}\` phase.`,
    };
  }

  // 9. Commit + push. Branch name embeds the timestamp so re-running
  // publish on the same draft creates a fresh branch every time
  // (avoids GitHub's "already exists" error if the user iterates).
  const branchName = `deck/${input.slug}-${Date.now()}`;
  const commitMessage = `feat(deck/${input.slug}): publish AI-generated deck`;
  const commit = await commitAndPushInSandbox(
    sandbox,
    {
      branchName,
      authorName: SLIDE_OF_HAND_COMMIT_IDENTITY.name,
      authorEmail: SLIDE_OF_HAND_COMMIT_IDENTITY.email,
      commitMessage,
    },
    ghClone.workdir,
  );
  if (!commit.ok) {
    return {
      ok: false,
      phase: "github_push",
      error: commit.error,
      ...(commit.noEffectiveChanges ? { noEffectiveChanges: true } : {}),
    };
  }

  // 10. Open the draft PR.
  const prBody = buildPublishPrBody({
    slug: input.slug,
    draftRepoName: repo.name,
    commitSha: commit.sha,
  });
  const pr = await openPullRequest({
    token: stored.token,
    head: commit.branch,
    base: "main",
    title: commitMessage,
    body: prBody,
    draft: true,
  });
  if (!pr.ok) {
    return { ok: false, phase: "open_pr", error: pr.message };
  }

  return {
    ok: true,
    branch: commit.branch,
    prNumber: pr.result.number,
    prHtmlUrl: pr.result.htmlUrl,
  };
}

/**
 * Build the body for the publish PR. Deliberately terse: a one-line
 * description + structured metadata in a table so the user can scan
 * "what's being published" without scrolling. The actual review still
 * happens against the diff in GitHub's UI.
 */
function buildPublishPrBody(opts: {
  slug: string;
  draftRepoName: string;
  commitSha: string;
}): string {
  return [
    "Publishing an AI-generated deck draft from Cloudflare Artifacts.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Deck slug | \`${opts.slug}\` |`,
    `| Draft repo | \`${opts.draftRepoName}\` |`,
    `| Commit SHA | \`${opts.commitSha.slice(0, 7)}\` |`,
    "",
    `Generated via \`/admin/decks/new\`. Review the diff under \`src/decks/public/${opts.slug}/\` before marking ready.`,
  ].join("\n");
}
