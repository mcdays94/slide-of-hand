/**
 * Source-backed deck lifecycle actions via gated GitHub draft PR
 * (PRD #242, issues #247 archive / #248 restore).
 *
 * Provides the Worker-side surface for source-deck Archive + Restore.
 * Delete (#249) ships in a follow-up slice. The flow for each:
 *
 *   1. Admin clicks Archive / Restore on a source deck card.
 *   2. Admin UI confirms GitHub is connected (#251 gate). If not,
 *      the gate intercepts here.
 *   3. Admin UI calls `POST /api/admin/source-decks/<slug>/archive`
 *      or `POST /api/admin/source-decks/<slug>/restore`.
 *   4. This Worker module:
 *      a. Verifies Access auth + user email.
 *      b. Resolves the user's GitHub OAuth token from KV.
 *      c. Spawns a Cloudflare Sandbox, clones slide-of-hand from
 *         GitHub on `main`, verifies the SOURCE folder exists AND
 *         the DESTINATION folder does NOT exist (where source/dest
 *         depend on the action — archive moves public → archive,
 *         restore moves archive → public).
 *      d. `mkdir -p <dest-parent>` + `git mv` the deck folder.
 *      e. Runs the standard test gate (`npm ci` → typecheck → test
 *         → build) against the post-move tree.
 *      f. Commits + pushes `<action>/<slug>-<timestamp>`.
 *      g. Opens a draft PR against `main`.
 *      h. Persists a `PendingSourceAction` record in KV so the
 *         admin UI's projection (#246) immediately shows the deck
 *         in its expected section with a Pending pill + PR link.
 *
 * **No direct writes to `main`.** The PR is always draft. The admin
 * UI's pending projection survives a reload because the record lives
 * in KV.
 *
 * **Tests must mock every Sandbox/GitHub collaborator.** No real
 * network. See `worker/source-deck-lifecycle.test.ts`.
 *
 * ## Why one module, two thin wrappers
 *
 * Archive and Restore are exact mirrors at the orchestration layer:
 * same clone → existence-probe → git-mv → gate → push → PR → KV
 * shape. Only the direction, branch prefix, commit/PR phrasing, and
 * action label differ. We capture those differences in a small
 * `SourceLifecycleConfig` and run them through a shared
 * `runSourceLifecycle` core. The exported `runArchiveSourceDeck` and
 * `runRestoreSourceDeck` are 5-line wrappers that build the config
 * and delegate. This keeps the two public entry points (and their
 * tests) explicit while avoiding orchestration drift.
 *
 * Delete (#249) will likely fit this same shape (one move = remove,
 * with an empty destination) but until that slice lands we don't
 * over-fit the parameter surface.
 *
 * ## Slug validation
 *
 * Slugs arrive from the URL path and are also used in shell paths
 * inside the Sandbox (`test -d src/decks/public/<slug>`). The
 * existing `isValidSlug` helper restricts to
 * `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$` which is shell-safe by
 * construction (no spaces, slashes, quote characters, or `..`). We
 * still validate at every entry point as defence in depth.
 */
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import {
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
import { getAccessUserEmail, requireAccessAuth } from "./access-auth";
import { isValidSlug } from "../src/lib/theme-tokens";
import {
  expectedStateFor,
  type PendingSourceAction,
  type PendingSourceActionType,
} from "../src/lib/pending-source-actions";

export interface SourceDeckLifecycleEnv {
  Sandbox: DurableObjectNamespace<Sandbox>;
  /** Pending source action store (same KV namespace as decks). */
  DECKS: KVNamespace;
  /** GitHub OAuth token store (per-user). */
  GITHUB_TOKENS: KVNamespace;
}

export interface ArchiveSourceDeckInput {
  userEmail: string;
  slug: string;
}

/** Alias for symmetry with archive. Restore takes the same input shape. */
export type RestoreSourceDeckInput = ArchiveSourceDeckInput;

/**
 * Phases shared by both archive and restore. The destination-collision
 * phase is named per-action (`archive_exists` for archive,
 * `active_exists` for restore) so error UIs can render specific copy
 * without checking the action separately; same for the
 * source-missing phase (`source_missing` for archive's public source,
 * `archive_missing` for restore's archive source).
 */
export type SourceLifecyclePhase =
  | "auth"
  | "invalid_slug"
  | "github_token"
  | "clone_github"
  | "source_missing"
  | "archive_exists"
  | "archive_missing"
  | "active_exists"
  | "move"
  | "test_gate"
  | "github_push"
  | "open_pr"
  | "pending_record";

/** Preserved for backwards compatibility with the #247 wave. */
export type ArchiveSourceDeckPhase = SourceLifecyclePhase;

interface SourceLifecycleSuccess<A extends PendingSourceActionType> {
  ok: true;
  branch: string;
  prNumber: number;
  prUrl: string;
  action: A;
}

interface SourceLifecycleFailure {
  ok: false;
  phase: SourceLifecyclePhase;
  error: string;
  failedTestGatePhase?: TestGatePhase;
  testGatePhases?: TestGatePhaseResult[];
  noEffectiveChanges?: boolean;
}

export type ArchiveSourceDeckResult = SourceLifecycleSuccess<"archive">;
export type ArchiveSourceDeckError = SourceLifecycleFailure;

export type RestoreSourceDeckResult = SourceLifecycleSuccess<"restore">;
export type RestoreSourceDeckError = SourceLifecycleFailure;

export type GetSandboxFn = (
  namespace: DurableObjectNamespace<Sandbox>,
  id: string,
) => Sandbox;

// ── KV layout (mirrors `worker/pending-source-actions.ts`) ──────────

const KV_PENDING_RECORD = (slug: string) => `pending-source-action:${slug}`;
const KV_PENDING_INDEX = "pending-source-actions-list";

// ── Per-action configuration ────────────────────────────────────────

interface SourceLifecycleConfig<A extends PendingSourceActionType> {
  /** The lifecycle action type. */
  action: A;
  /** Sandbox keying prefix (`source-archive:`, `source-restore:`). */
  sandboxKeyPrefix: string;
  /** Relative path of the folder that MUST exist before the move. */
  sourceDir: (slug: string) => string;
  /** Relative path of the folder that must NOT yet exist. */
  destDir: (slug: string) => string;
  /** Parent directory to `mkdir -p` before `git mv`. */
  destParent: string;
  /** Phase emitted when `sourceDir` is missing. */
  sourceMissingPhase: SourceLifecyclePhase;
  /** Phase emitted when `destDir` already exists. */
  destExistsPhase: SourceLifecyclePhase;
  /** Human-friendly error when `sourceDir` is missing. */
  sourceMissingError: (slug: string) => string;
  /** Human-friendly error when `destDir` already exists. */
  destExistsError: (slug: string) => string;
  /** Branch prefix (e.g. `archive/`, `restore/`). */
  branchPrefix: string;
  /** Conventional-commit subject line (without slug or issue ref). */
  commitMessage: (slug: string) => string;
  /** PR title. Mirrors the commit message by convention. */
  prTitle: (slug: string) => string;
  /** PR body (terse — the rename is the message). */
  prBody: (slug: string, branch: string) => string;
}

/** Archive config: public → archive. */
const ARCHIVE_CONFIG: SourceLifecycleConfig<"archive"> = {
  action: "archive",
  sandboxKeyPrefix: "source-archive:",
  sourceDir: (slug) => `src/decks/public/${slug}`,
  destDir: (slug) => `src/decks/archive/${slug}`,
  destParent: "src/decks/archive",
  sourceMissingPhase: "source_missing",
  destExistsPhase: "archive_exists",
  sourceMissingError: (slug) =>
    `Source folder src/decks/public/${slug}/ does not exist on \`main\`. Nothing to archive.`,
  destExistsError: (slug) =>
    `Archive folder src/decks/archive/${slug}/ already exists on \`main\`. Archive is blocked until the conflict is resolved.`,
  branchPrefix: "archive/",
  commitMessage: (slug) => `chore(deck/${slug}): archive deck (#247)`,
  prTitle: (slug) => `chore(deck/${slug}): archive deck (#247)`,
  prBody: (slug, branch) =>
    [
      `Archive source deck \`${slug}\` by relocating its folder from`,
      `\`src/decks/public/${slug}/\` to \`src/decks/archive/${slug}/\`.`,
      "",
      "Generated by the slide-of-hand admin Archive action.",
      "",
      "| Field | Value |",
      "| --- | --- |",
      `| Deck slug | \`${slug}\` |`,
      `| Branch | \`${branch}\` |`,
      `| Lifecycle action | archive |`,
      "",
      "Closes part of #247 (PRD #242).",
    ].join("\n"),
};

/** Restore config: archive → public. */
const RESTORE_CONFIG: SourceLifecycleConfig<"restore"> = {
  action: "restore",
  sandboxKeyPrefix: "source-restore:",
  sourceDir: (slug) => `src/decks/archive/${slug}`,
  destDir: (slug) => `src/decks/public/${slug}`,
  destParent: "src/decks/public",
  sourceMissingPhase: "archive_missing",
  destExistsPhase: "active_exists",
  sourceMissingError: (slug) =>
    `Archive folder src/decks/archive/${slug}/ does not exist on \`main\`. Nothing to restore.`,
  destExistsError: (slug) =>
    `Public folder src/decks/public/${slug}/ already exists on \`main\`. Restore is blocked until the conflict is resolved.`,
  branchPrefix: "restore/",
  commitMessage: (slug) => `chore(deck/${slug}): restore deck (#248)`,
  prTitle: (slug) => `chore(deck/${slug}): restore deck (#248)`,
  prBody: (slug, branch) =>
    [
      `Restore source deck \`${slug}\` by relocating its folder from`,
      `\`src/decks/archive/${slug}/\` back to \`src/decks/public/${slug}/\`.`,
      "",
      "Generated by the slide-of-hand admin Restore action.",
      "",
      "| Field | Value |",
      "| --- | --- |",
      `| Deck slug | \`${slug}\` |`,
      `| Branch | \`${branch}\` |`,
      `| Lifecycle action | restore |`,
      "",
      "Closes part of #248 (PRD #242).",
    ].join("\n"),
};

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Probe whether a directory exists inside the cloned workdir.
 * Returns true on `test -d <path>` exit 0, false otherwise.
 *
 * NOTE: the probe command is sent verbatim through `exec` so the
 * `test -d <slug>` form gives the Sandbox stub a clean string to
 * pattern-match against in tests. The slug is validated by the
 * caller before reaching here.
 */
async function dirExists(
  sandbox: Pick<Sandbox, "exec">,
  workdir: string,
  relPath: string,
): Promise<boolean> {
  try {
    const result = await sandbox.exec(`test -d ${relPath}`, { cwd: workdir });
    return result.success === true && (result.exitCode ?? -1) === 0;
  } catch {
    return false;
  }
}

/**
 * Build the pending-source-action record for an in-flight PR.
 */
function makePendingRecord<A extends PendingSourceActionType>(
  slug: string,
  action: A,
  prUrl: string,
): PendingSourceAction {
  return {
    slug,
    action,
    expectedState: expectedStateFor(action),
    prUrl,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Atomically persist the pending record + add the slug to the
 * denormalised index. Mirrors `handleUpsert` in
 * `worker/pending-source-actions.ts` so the two surfaces stay in
 * sync.
 */
async function writePendingRecord(
  env: SourceDeckLifecycleEnv,
  record: PendingSourceAction,
): Promise<void> {
  await env.DECKS.put(KV_PENDING_RECORD(record.slug), JSON.stringify(record));
  const list = ((await env.DECKS.get(KV_PENDING_INDEX, "json")) as
    | string[]
    | null) ?? [];
  if (!list.includes(record.slug)) {
    list.push(record.slug);
    await env.DECKS.put(KV_PENDING_INDEX, JSON.stringify(list));
  }
}

// ── Shared executor ─────────────────────────────────────────────────

/**
 * Shared executor for both archive and restore. The two flows are
 * structurally identical — only the directories, branch prefix, and
 * copy differ — so we orchestrate once and parameterise via
 * `SourceLifecycleConfig`.
 */
async function runSourceLifecycle<A extends PendingSourceActionType>(
  env: SourceDeckLifecycleEnv,
  input: { userEmail: string; slug: string },
  config: SourceLifecycleConfig<A>,
  getSandboxFn: GetSandboxFn,
): Promise<SourceLifecycleSuccess<A> | SourceLifecycleFailure> {
  // 1. Auth.
  const email = (input.userEmail ?? "").trim();
  if (!email) {
    return {
      ok: false,
      phase: "auth",
      error:
        `${config.action === "archive" ? "Archiving" : "Restoring"} a source deck requires an authenticated user. Service-token contexts have no user identity to commit on behalf of.`,
    };
  }

  // 2. Slug validation. Belt-and-braces — the route handler already
  // checks but we don't want a malformed slug reaching the shell.
  const slug = (input.slug ?? "").trim();
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      phase: "invalid_slug",
      error: `Invalid slug: "${slug}". Slugs must be kebab-case and shell-safe.`,
    };
  }

  // 3. GitHub token lookup.
  const stored = await getStoredGitHubToken(env, email);
  if (!stored) {
    return {
      ok: false,
      phase: "github_token",
      error:
        "GitHub not connected. Connect GitHub from Settings → GitHub → Connect before retrying. This flow needs the user's GitHub credentials to clone the repo, push a branch, and open a draft PR.",
    };
  }

  // 4. Sandbox. Keyed by `<prefix><slug>` so retries against the same
  // slug reuse the warmed container. Each call starts with a fresh
  // clone (step 5) so there's no leakage between attempts.
  const sandbox = getSandboxFn(env.Sandbox, `${config.sandboxKeyPrefix}${slug}`);

  // 5. Clone slide-of-hand from GitHub.
  const ghClone = await cloneRepoIntoSandbox(sandbox, {
    token: stored.token,
    repo: TARGET_REPO,
    workdir: "/workspace/slide-of-hand",
  });
  if (!ghClone.ok) {
    return { ok: false, phase: "clone_github", error: ghClone.error };
  }

  const workdir = ghClone.workdir;

  // 6a. Source folder must exist (otherwise the move is a no-op /
  // the resulting PR has an empty diff).
  const sourceExists = await dirExists(sandbox, workdir, config.sourceDir(slug));
  if (!sourceExists) {
    return {
      ok: false,
      phase: config.sourceMissingPhase,
      error: config.sourceMissingError(slug),
    };
  }

  // 6b. Destination folder must NOT exist — otherwise the move would
  // collide. Recovery is manual.
  const destExists = await dirExists(sandbox, workdir, config.destDir(slug));
  if (destExists) {
    return {
      ok: false,
      phase: config.destExistsPhase,
      error: config.destExistsError(slug),
    };
  }

  // 7. Move the folder. `mkdir -p` + `git mv` so git tracks the
  // rename and the resulting PR diff is a clean rename (which keeps
  // history intact and `git log --follow` working from the new
  // location).
  let moveResult;
  try {
    moveResult = await sandbox.exec(
      `mkdir -p ${config.destParent} && git mv ${config.sourceDir(slug)} ${config.destDir(slug)}`,
      { cwd: workdir },
    );
  } catch (err) {
    return {
      ok: false,
      phase: "move",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!moveResult.success || (moveResult.exitCode ?? -1) !== 0) {
    return {
      ok: false,
      phase: "move",
      error:
        (moveResult.stderr && moveResult.stderr.trim()) ||
        `git mv failed (exit ${moveResult.exitCode ?? "unknown"}).`,
    };
  }

  // 8. Test gate against the post-move tree.
  const gate = await runSandboxTestGate(sandbox, workdir);
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
  // the action creates a fresh branch every time, avoiding GitHub's
  // "branch already exists" rejection if the previous attempt left a
  // branch behind.
  const branchName = `${config.branchPrefix}${slug}-${Date.now()}`;
  const commitMessage = config.commitMessage(slug);
  const commit = await commitAndPushInSandbox(
    sandbox,
    {
      branchName,
      authorName: SLIDE_OF_HAND_COMMIT_IDENTITY.name,
      authorEmail: SLIDE_OF_HAND_COMMIT_IDENTITY.email,
      commitMessage,
    },
    workdir,
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
  const pr = await openPullRequest({
    token: stored.token,
    head: commit.branch,
    base: "main",
    title: config.prTitle(slug),
    body: config.prBody(slug, commit.branch),
    draft: true,
  });
  if (!pr.ok) {
    return { ok: false, phase: "open_pr", error: pr.message };
  }

  // 11. Persist the pending source-action record.
  try {
    await writePendingRecord(
      env,
      makePendingRecord(slug, config.action, pr.result.htmlUrl),
    );
  } catch (err) {
    return {
      ok: false,
      phase: "pending_record",
      error: `${config.action === "archive" ? "Archive" : "Restore"} PR opened (${pr.result.htmlUrl}) but the pending marker write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    ok: true,
    branch: commit.branch,
    prNumber: pr.result.number,
    prUrl: pr.result.htmlUrl,
    action: config.action,
  };
}

// ── runArchiveSourceDeck ────────────────────────────────────────────

/**
 * Archive a source-backed deck by opening a draft GitHub PR that
 * moves `src/decks/public/<slug>/` to `src/decks/archive/<slug>/`.
 *
 * Returns a tagged-union result; consumers translate the `phase`
 * discriminant into HTTP status codes / inline error copy.
 */
export async function runArchiveSourceDeck(
  env: SourceDeckLifecycleEnv,
  input: ArchiveSourceDeckInput,
  getSandboxFn: GetSandboxFn = getSandbox,
): Promise<ArchiveSourceDeckResult | ArchiveSourceDeckError> {
  return runSourceLifecycle(env, input, ARCHIVE_CONFIG, getSandboxFn);
}

// ── runRestoreSourceDeck ────────────────────────────────────────────

/**
 * Restore an archived source-backed deck by opening a draft GitHub
 * PR that moves `src/decks/archive/<slug>/` back to
 * `src/decks/public/<slug>/`.
 *
 * Mirror of `runArchiveSourceDeck`. The orchestration is shared via
 * `runSourceLifecycle`; only the per-action config differs.
 */
export async function runRestoreSourceDeck(
  env: SourceDeckLifecycleEnv,
  input: RestoreSourceDeckInput,
  getSandboxFn: GetSandboxFn = getSandbox,
): Promise<RestoreSourceDeckResult | RestoreSourceDeckError> {
  return runSourceLifecycle(env, input, RESTORE_CONFIG, getSandboxFn);
}

// ── HTTP router ─────────────────────────────────────────────────────

const ARCHIVE_PATH = /^\/api\/admin\/source-decks\/([^/]+)\/archive\/?$/;
const RESTORE_PATH = /^\/api\/admin\/source-decks\/([^/]+)\/restore\/?$/;

const NO_STORE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ error, ...(extra ?? {}) }),
    { status, headers: NO_STORE_HEADERS },
  );
}

/**
 * Map a phase from `runSourceLifecycle` to an HTTP status code.
 *
 *   - auth / github_token → 409 (the caller's environment isn't
 *     ready; the UI surfaces a "connect GitHub" hint).
 *   - invalid_slug → 400.
 *   - source_missing / archive_exists / archive_missing /
 *     active_exists → 400 (caller asked for an operation that
 *     doesn't match disk state).
 *   - everything else (clone/test_gate/push/PR/KV) → 400 with the
 *     phase echoed so the UI can show the right error.
 *
 * We avoid 500 — every failure is a known shape, not an internal
 * server error.
 */
function statusForPhase(phase: SourceLifecyclePhase): number {
  switch (phase) {
    case "auth":
    case "github_token":
      return 409;
    case "invalid_slug":
      return 400;
    default:
      return 400;
  }
}

function buildSuccessResponse(
  result: SourceLifecycleSuccess<PendingSourceActionType>,
): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      prUrl: result.prUrl,
      prNumber: result.prNumber,
      branch: result.branch,
      action: result.action,
    }),
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

function buildFailureResponse(result: SourceLifecycleFailure): Response {
  return jsonError(statusForPhase(result.phase), result.error, {
    phase: result.phase,
    ...(result.failedTestGatePhase
      ? { failedTestGatePhase: result.failedTestGatePhase }
      : {}),
    ...(result.noEffectiveChanges ? { noEffectiveChanges: true } : {}),
  });
}

async function handleArchive(
  request: Request,
  env: SourceDeckLifecycleEnv,
  slug: string,
): Promise<Response> {
  if (!isValidSlug(slug)) {
    return jsonError(400, `invalid slug: "${slug}"`);
  }
  const email = getAccessUserEmail(request);
  if (!email) {
    return jsonError(
      409,
      "Source archive requires an interactive Access user — service-token auth has no email to associate with a GitHub account.",
    );
  }
  const result = await runArchiveSourceDeck(env, { userEmail: email, slug });
  return result.ok ? buildSuccessResponse(result) : buildFailureResponse(result);
}

async function handleRestore(
  request: Request,
  env: SourceDeckLifecycleEnv,
  slug: string,
): Promise<Response> {
  if (!isValidSlug(slug)) {
    return jsonError(400, `invalid slug: "${slug}"`);
  }
  const email = getAccessUserEmail(request);
  if (!email) {
    return jsonError(
      409,
      "Source restore requires an interactive Access user — service-token auth has no email to associate with a GitHub account.",
    );
  }
  const result = await runRestoreSourceDeck(env, { userEmail: email, slug });
  return result.ok ? buildSuccessResponse(result) : buildFailureResponse(result);
}

/**
 * Route a request against the source-deck lifecycle API. Returns a
 * `Response` for paths this handler owns, or `null` for the caller
 * to fall through. All paths are Access-gated.
 *
 * Owns:
 *   - `POST /api/admin/source-decks/<slug>/archive` — issue #247
 *   - `POST /api/admin/source-decks/<slug>/restore` — issue #248
 *
 * Delete (#249) ships in a follow-up slice.
 */
export async function handleSourceDeckLifecycle(
  request: Request,
  env: SourceDeckLifecycleEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const archiveMatch = url.pathname.match(ARCHIVE_PATH);
  if (archiveMatch) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "method not allowed" }),
        {
          status: 405,
          headers: { ...NO_STORE_HEADERS, allow: "POST" },
        },
      );
    }
    const slug = decodeURIComponent(archiveMatch[1]);
    return handleArchive(request, env, slug);
  }
  const restoreMatch = url.pathname.match(RESTORE_PATH);
  if (restoreMatch) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "method not allowed" }),
        {
          status: 405,
          headers: { ...NO_STORE_HEADERS, allow: "POST" },
        },
      );
    }
    const slug = decodeURIComponent(restoreMatch[1]);
    return handleRestore(request, env, slug);
  }
  return null;
}
