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
 *      Forks the deck-starter baseline (idempotent), spawns a Sandbox,
 *      clones the fork, asks Workers AI to write JSX files, applies
 *      them, commits + pushes back to the Artifacts repo, returns the
 *      resulting commit SHA + a draft ID.
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
  buildAuthenticatedRemoteUrl,
  draftRepoName,
  forkDeckStarterIdempotent,
  getDraftRepo,
  mintWriteToken,
  stripExpiresSuffix,
} from "./artifacts-client";
import {
  cloneArtifactsRepoIntoSandbox,
  commitAndPushToArtifactsInSandbox,
} from "./sandbox-artifacts";
import { applyFilesIntoSandbox } from "./sandbox-source-edit";
import { generateDeckFiles } from "./ai-deck-gen";

export interface SandboxDeckCreationEnv {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ARTIFACTS: Artifacts;
  AI: Ai;
}

export interface CreateDeckDraftInput {
  userEmail: string;
  slug: string;
  prompt: string;
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
 * First-turn deck creation. Forks `deck-starter` (idempotent), clones
 * the fork into a fresh Sandbox, asks Workers AI for the deck files,
 * applies + commits + pushes them.
 */
export async function runCreateDeckDraft(
  env: SandboxDeckCreationEnv,
  input: CreateDeckDraftInput,
  /** Test hook. Defaults to the real `getSandbox`. */
  getSandboxFn: GetSandboxFn = getSandbox,
): Promise<DeckDraftResult | DeckDraftError> {
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

  // 1. Fork (or look up an existing fork).
  let remoteUrl: string;
  let token: string;
  try {
    const forkResult = await forkDeckStarterIdempotent(
      env.ARTIFACTS,
      input.userEmail,
      input.slug,
    );
    if (forkResult.kind === "created") {
      remoteUrl = forkResult.result.remote;
      token = forkResult.result.token;
    } else {
      remoteUrl = forkResult.repo.remote;
      token = forkResult.freshWriteToken.plaintext;
    }
  } catch (err) {
    return {
      ok: false,
      phase: "fork",
      error: `Failed to fork deck-starter: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let authenticatedUrl: string;
  try {
    authenticatedUrl = buildAuthenticatedRemoteUrl(remoteUrl, token);
  } catch (err) {
    return {
      ok: false,
      phase: "token",
      error: `Failed to build authenticated URL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const draftId = draftRepoName(input.userEmail, input.slug);
  const sandbox = getSandboxFn(env.Sandbox, sandboxIdForDraft(draftId));

  // 2. Clone (empty repo is fine — empty: true).
  const clone = await cloneArtifactsRepoIntoSandbox(sandbox, {
    authenticatedUrl,
  });
  if (!clone.ok) {
    return { ok: false, phase: "clone", error: clone.error };
  }

  // 3. AI gen.
  const aiResult = await generateDeckFiles(env.AI, {
    slug: input.slug,
    userPrompt: input.prompt,
    // Wave 3 references aren't wired here yet — passed through if the
    // model later supports them.
  }, {
    ...(input.modelId ? { modelId: input.modelId } : {}),
  });
  if (!aiResult.ok) {
    return {
      ok: false,
      phase: "ai_generation",
      aiGenPhase: aiResult.phase,
      error: aiResult.error,
    };
  }

  // 4. Apply files.
  const apply = await applyFilesIntoSandbox(
    sandbox,
    aiResult.files,
    clone.workdir,
  );
  if (!apply.ok) {
    return {
      ok: false,
      phase: "apply_files",
      error: `Failed to write generated files: ${apply.error}${
        apply.failedPath ? ` (path: ${apply.failedPath})` : ""
      }`,
    };
  }

  // 5. Commit + push.
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
    return {
      ok: false,
      phase: "commit_push",
      error: commitResult.error,
    };
  }

  // Wipe the locally-held bare token before returning, defence in
  // depth in case `token` would otherwise survive in a closure
  // captured by the calling tool's response.
  token = stripExpiresSuffix("redacted");

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
 * elements) as context to Workers AI, applies the resulting diff,
 * commits + pushes a follow-up revision.
 */
export async function runIterateOnDeckDraft(
  env: SandboxDeckCreationEnv,
  input: IterateOnDeckDraftInput,
  /** Test hook. Defaults to the real `getSandbox`. */
  getSandboxFn: GetSandboxFn = getSandbox,
): Promise<DeckDraftResult | DeckDraftError> {
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

  // 1. Resolve existing fork + mint a fresh write token.
  let remoteUrl: string;
  let token: string;
  try {
    const repo = await getDraftRepo(env.ARTIFACTS, input.userEmail, input.slug);
    const fresh = await mintWriteToken(repo);
    remoteUrl = repo.remote;
    token = fresh.plaintext;
  } catch (err) {
    return {
      ok: false,
      phase: "fork",
      error: `Draft not found for slug "${input.slug}". Use createDeckDraft first. (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  let authenticatedUrl: string;
  try {
    authenticatedUrl = buildAuthenticatedRemoteUrl(remoteUrl, token);
  } catch (err) {
    return {
      ok: false,
      phase: "token",
      error: `Failed to build authenticated URL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const draftId = draftRepoName(input.userEmail, input.slug);
  const sandbox = getSandboxFn(env.Sandbox, sandboxIdForDraft(draftId));

  // 2. Clone HEAD.
  const clone = await cloneArtifactsRepoIntoSandbox(sandbox, {
    authenticatedUrl,
  });
  if (!clone.ok) {
    return { ok: false, phase: "clone", error: clone.error };
  }

  // 3. Read the existing deck files so the AI gen has full context.
  // We use a single `find + cat` script to gather them efficiently.
  const existingFiles = await readDeckFilesFromSandbox(
    sandbox,
    input.slug,
    clone.workdir,
  );

  // 4. AI gen with iteration context.
  const aiResult = await generateDeckFiles(env.AI, {
    slug: input.slug,
    userPrompt: input.prompt,
    existingFiles,
    ...(input.pinnedElements ? { pinnedElements: input.pinnedElements } : {}),
  }, {
    ...(input.modelId ? { modelId: input.modelId } : {}),
  });
  if (!aiResult.ok) {
    return {
      ok: false,
      phase: "ai_generation",
      aiGenPhase: aiResult.phase,
      error: aiResult.error,
    };
  }

  // 5. Apply.
  const apply = await applyFilesIntoSandbox(
    sandbox,
    aiResult.files,
    clone.workdir,
  );
  if (!apply.ok) {
    return {
      ok: false,
      phase: "apply_files",
      error: `Failed to write generated files: ${apply.error}${
        apply.failedPath ? ` (path: ${apply.failedPath})` : ""
      }`,
    };
  }

  // 6. Commit + push.
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
    return {
      ok: false,
      phase: "commit_push",
      error: commitResult.error,
    };
  }

  token = stripExpiresSuffix("redacted");

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

// ── publishDraft remains stubbed for Wave 1 follow-up ──────────────

export interface PublishDraftInput {
  userEmail: string;
  slug: string;
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
    | "clone"
    | "test_gate"
    | "github_push"
    | "open_pr"
    | "not_implemented";
  error: string;
}

/**
 * Publish a draft to GitHub. STUB — Wave 1 follow-up. The flow is
 * documented in the file header but the implementation needs:
 *
 *   1. The user's GitHub OAuth token from `GITHUB_TOKENS` KV.
 *   2. A read token for the Artifacts draft.
 *   3. A two-step clone (Artifacts read into one workdir, then a
 *      separate clone of the slide-of-hand GitHub repo).
 *   4. Copy the draft files into the slide-of-hand checkout.
 *   5. `runSandboxTestGate` against the full project.
 *   6. `commitAndPushInSandbox` to GitHub.
 *   7. `openPullRequest` against `main`.
 *
 * Building this requires the iteration loop to be exercised in
 * practice first — quality of the publish flow depends on quality of
 * the generated decks. Deferring keeps the Wave 1 PR focused.
 */
export async function runPublishDraft(
  env: SandboxDeckCreationEnv,
  input: PublishDraftInput,
): Promise<PublishDraftResult | PublishDraftError> {
  void env;
  void input;
  return {
    ok: false,
    phase: "not_implemented",
    error:
      "Deck publish is not implemented yet (issue #168 Wave 1 follow-up). " +
      "Create + iterate flows work end-to-end via createDeckDraft and " +
      "iterateOnDeckDraft; publish to GitHub is the next slice.",
  };
}
