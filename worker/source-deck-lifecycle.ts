/**
 * Source-backed deck lifecycle actions via gated GitHub draft PR
 * (PRD #242, issues #247 archive / #248 restore / #249 delete).
 *
 * Provides the Worker-side surface for source-deck Archive, Restore,
 * and Delete. The flow for each:
 *
 *   1. Admin clicks Archive / Restore / Delete on a source deck card.
 *   2. Admin UI confirms GitHub is connected (#251 gate). If not,
 *      the gate intercepts here.
 *   3. Admin UI calls `POST /api/admin/source-decks/<slug>/<action>`.
 *   4. This Worker module:
 *      a. Verifies Access auth + user email.
 *      b. Resolves the user's GitHub OAuth token from KV.
 *      c. Spawns a Cloudflare Sandbox, clones slide-of-hand from
 *         GitHub on `main`, verifies the relevant source folder(s)
 *         exist. For Archive/Restore the destination folder must NOT
 *         yet exist; for Delete the folder is resolved as
 *         `src/decks/public/<slug>/` if present else
 *         `src/decks/archive/<slug>/`.
 *      d. Either `mkdir -p <dest-parent>` + `git mv` the deck folder
 *         (archive/restore) or `git rm -r` the deck folder (delete).
 *      e. Runs the standard test gate (`npm ci` → typecheck → test
 *         → build) against the post-edit tree.
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
 * Delete (#249) shares the same orchestration shell. Where archive
 * and restore are mirror moves, delete is a single-direction REMOVE
 * with a "source folder lives in either of two places" probe (public
 * for active decks, archive for archived decks). We model that with
 * a `mode` discriminator on `SourceLifecycleConfig`: `"move"` for
 * archive/restore, `"remove"` for delete.
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

const CLONE_TIMEOUT_MS = 90_000;
const MUTATE_TIMEOUT_MS = 30_000;
const TEST_GATE_TIMEOUT_MS = 180_000;
const GITHUB_PUSH_TIMEOUT_MS = 90_000;
const OPEN_PR_TIMEOUT_MS = 60_000;
const PENDING_RECORD_TIMEOUT_MS = 30_000;

export interface SourceDeckLifecycleEnv {
  Sandbox: DurableObjectNamespace<Sandbox>;
  /** Pending source action store (same KV namespace as decks). */
  DECKS: KVNamespace;
  /** GitHub OAuth token store (per-user). */
  GITHUB_TOKENS: KVNamespace;
  /** Background queue for slow source lifecycle Sandbox/GitHub work. */
  SOURCE_DECK_LIFECYCLE_QUEUE?: Queue<SourceDeckLifecycleJob>;
}

export interface SourceDeckLifecycleJob {
  jobId: string;
  action: PendingSourceActionType;
  slug: string;
  userEmail: string;
  enqueuedAt: string;
}

export interface ArchiveSourceDeckInput {
  userEmail: string;
  slug: string;
}

/** Alias for symmetry with archive. Restore takes the same input shape. */
export type RestoreSourceDeckInput = ArchiveSourceDeckInput;

/** Alias for symmetry with archive. Delete takes the same input shape. */
export type DeleteSourceDeckInput = ArchiveSourceDeckInput;

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

export type DeleteSourceDeckResult = SourceLifecycleSuccess<"delete">;
export type DeleteSourceDeckError = SourceLifecycleFailure;

export type GetSandboxFn = (
  namespace: DurableObjectNamespace<Sandbox>,
  id: string,
) => Sandbox;

// ── KV layout (mirrors `worker/pending-source-actions.ts`) ──────────

const KV_PENDING_RECORD = (slug: string) => `pending-source-action:${slug}`;
const KV_PENDING_INDEX = "pending-source-actions-list";

// ── Per-action configuration ────────────────────────────────────────

/**
 * Shared configuration fields for every lifecycle action.
 */
interface BaseSourceLifecycleConfig<A extends PendingSourceActionType> {
  /** The lifecycle action type. */
  action: A;
  /** Sandbox keying prefix (`source-archive:`, `source-restore:`, `source-delete:`). */
  sandboxKeyPrefix: string;
  /** Branch prefix (e.g. `archive/`, `restore/`, `delete/`). */
  branchPrefix: string;
  /** Conventional-commit subject line (without slug or issue ref). */
  commitMessage: (slug: string) => string;
  /** PR title. Mirrors the commit message by convention. */
  prTitle: (slug: string) => string;
  /** PR body (terse — the rename / removal is the message). */
  prBody: (slug: string, branch: string) => string;
}

/**
 * `mode: "move"` — archive/restore. Probe `sourceDir` exists AND
 * `destDir` does NOT, then `mkdir -p <destParent> && git mv`.
 */
interface MoveSourceLifecycleConfig<A extends PendingSourceActionType>
  extends BaseSourceLifecycleConfig<A> {
  mode: "move";
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
}

/**
 * `mode: "remove"` — delete. The deck folder may live in either of
 * two locations (active = `public`, archived = `archive`). We probe
 * each and pick whichever exists. If neither exists, short-circuit
 * with `source_missing`. The removal is `git rm -r <resolved>`.
 */
interface RemoveSourceLifecycleConfig<A extends PendingSourceActionType>
  extends BaseSourceLifecycleConfig<A> {
  mode: "remove";
  /** Candidate folders to probe in order. First hit wins. */
  candidateDirs: (slug: string) => string[];
  /** Phase emitted when none of the candidates exist. */
  sourceMissingPhase: SourceLifecyclePhase;
  /** Human-friendly error when none of the candidates exist. */
  sourceMissingError: (slug: string) => string;
}

type SourceLifecycleConfig<A extends PendingSourceActionType> =
  | MoveSourceLifecycleConfig<A>
  | RemoveSourceLifecycleConfig<A>;

interface SourceLifecycleOptions {
  writePendingRecord?: boolean;
}

/** Archive config: public → archive. */
const ARCHIVE_CONFIG: SourceLifecycleConfig<"archive"> = {
  mode: "move",
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
  mode: "move",
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

/**
 * Delete config: remove `src/decks/public/<slug>/` if present, else
 * `src/decks/archive/<slug>/`. The deck folder is fully removed from
 * source. Pending projection (#246) keeps the card visible in the
 * Archived section with a "Pending delete" pill until the PR merges
 * + deploys, at which point reconciliation (#250) clears any
 * remaining side data (KV, R2). This module does NOT clean side data
 * — see the PRD #242 / #249 acceptance criteria for why side-data
 * cleanup is deferred to reconciliation.
 */
const DELETE_CONFIG: SourceLifecycleConfig<"delete"> = {
  mode: "remove",
  action: "delete",
  sandboxKeyPrefix: "source-delete:",
  candidateDirs: (slug) => [
    `src/decks/public/${slug}`,
    `src/decks/archive/${slug}`,
  ],
  sourceMissingPhase: "source_missing",
  sourceMissingError: (slug) =>
    `Neither src/decks/public/${slug}/ nor src/decks/archive/${slug}/ exists on \`main\`. Nothing to delete.`,
  branchPrefix: "delete/",
  commitMessage: (slug) => `chore(deck/${slug}): delete deck (#249)`,
  prTitle: (slug) => `chore(deck/${slug}): delete deck (#249)`,
  prBody: (slug, branch) =>
    [
      `Delete source deck \`${slug}\` by removing its folder from`,
      "`main`. The deck is gone from the deployed app once this PR",
      "merges and the next deploy lands.",
      "",
      "Generated by the slide-of-hand admin Delete action.",
      "",
      "| Field | Value |",
      "| --- | --- |",
      `| Deck slug | \`${slug}\` |`,
      `| Branch | \`${branch}\` |`,
      `| Lifecycle action | delete |`,
      "",
      "Side data (KV, R2 thumbnails, analytics) is left in place",
      "until reconciliation (#250) confirms the merged + deployed",
      "source no longer contains the deck.",
      "",
      "Closes part of #249 (PRD #242).",
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
  extras: Pick<PendingSourceAction, "branch" | "jobId"> = {},
): PendingSourceAction {
  const now = new Date().toISOString();
  return {
    slug,
    action,
    expectedState: expectedStateFor(action),
    prUrl,
    status: "pr_open",
    createdAt: now,
    updatedAt: now,
    ...extras,
  };
}

function makeQueuedPendingRecord(
  job: SourceDeckLifecycleJob,
): PendingSourceAction {
  return {
    slug: job.slug,
    action: job.action,
    expectedState: expectedStateFor(job.action),
    status: "queued",
    jobId: job.jobId,
    createdAt: job.enqueuedAt,
    updatedAt: job.enqueuedAt,
  };
}

function transitionPendingRecord(
  existing: PendingSourceAction | null,
  job: SourceDeckLifecycleJob,
  patch: Partial<PendingSourceAction>,
): PendingSourceAction {
  return {
    slug: job.slug,
    action: job.action,
    expectedState: expectedStateFor(job.action),
    createdAt: existing?.createdAt ?? job.enqueuedAt,
    jobId: job.jobId,
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

async function readPendingRecord(
  env: SourceDeckLifecycleEnv,
  slug: string,
): Promise<PendingSourceAction | null> {
  return (await env.DECKS.get(
    KV_PENDING_RECORD(slug),
    "json",
  )) as PendingSourceAction | null;
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
  options: SourceLifecycleOptions = {},
): Promise<SourceLifecycleSuccess<A> | SourceLifecycleFailure> {
  // 1. Auth.
  const email = (input.userEmail ?? "").trim();
  if (!email) {
    const actionVerb =
      config.action === "archive"
        ? "Archiving"
        : config.action === "restore"
          ? "Restoring"
          : "Deleting";
    return {
      ok: false,
      phase: "auth",
      error: `${actionVerb} a source deck requires an authenticated user. Service-token contexts have no user identity to commit on behalf of.`,
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
  let ghClone;
  try {
    ghClone = await withSourceActionTimeout(
      cloneRepoIntoSandbox(sandbox, {
        token: stored.token,
        repo: TARGET_REPO,
        workdir: "/workspace/slide-of-hand",
      }),
      CLONE_TIMEOUT_MS,
      "GitHub clone",
    );
  } catch (err) {
    return {
      ok: false,
      phase: "clone_github",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!ghClone.ok) {
    return { ok: false, phase: "clone_github", error: ghClone.error };
  }

  const workdir = ghClone.workdir;

  // 6. Existence probe + tree mutation.
  //
  // `move` mode (archive/restore): source MUST exist, dest MUST NOT.
  // `remove` mode (delete): pick the first candidate that exists;
  //   if none exist, short-circuit. There's no destination to check.
  let mutateCommand: string;
  if (config.mode === "move") {
    // 6a. Source folder must exist (otherwise the move is a no-op /
    // the resulting PR has an empty diff).
    const sourceExists = await dirExists(
      sandbox,
      workdir,
      config.sourceDir(slug),
    );
    if (!sourceExists) {
      return {
        ok: false,
        phase: config.sourceMissingPhase,
        error: config.sourceMissingError(slug),
      };
    }

    // 6b. Destination folder must NOT exist — otherwise the move
    // would collide. Recovery is manual.
    const destExists = await dirExists(sandbox, workdir, config.destDir(slug));
    if (destExists) {
      return {
        ok: false,
        phase: config.destExistsPhase,
        error: config.destExistsError(slug),
      };
    }
    // `mkdir -p` + `git mv` so git tracks the rename and the
    // resulting PR diff is a clean rename (which keeps history
    // intact and `git log --follow` working from the new location).
    mutateCommand = `mkdir -p ${config.destParent} && git mv ${config.sourceDir(slug)} ${config.destDir(slug)}`;
  } else {
    // 6c. Resolve which of the candidate folders is on disk. First
    // hit wins — for delete this is "prefer public, fall back to
    // archive" so an active deck and an archived deck both delete
    // cleanly from their respective homes.
    let resolved: string | null = null;
    for (const candidate of config.candidateDirs(slug)) {
      // eslint-disable-next-line no-await-in-loop
      if (await dirExists(sandbox, workdir, candidate)) {
        resolved = candidate;
        break;
      }
    }
    if (resolved === null) {
      return {
        ok: false,
        phase: config.sourceMissingPhase,
        error: config.sourceMissingError(slug),
      };
    }
    // `git rm -r` so the removal is tracked by git and the PR diff
    // is a clean delete.
    mutateCommand = `git rm -r ${resolved}`;
  }

  // 7. Apply the tree mutation (move or remove).
  let moveResult;
  try {
    moveResult = await withSourceActionTimeout(
      sandbox.exec(mutateCommand, { cwd: workdir }),
      MUTATE_TIMEOUT_MS,
      "Source tree mutation",
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
        `${config.mode === "move" ? "git mv" : "git rm"} failed (exit ${moveResult.exitCode ?? "unknown"}).`,
    };
  }

  // 8. Test gate against the post-move tree.
  let gate;
  try {
    gate = await withSourceActionTimeout(
      runSandboxTestGate(sandbox, workdir),
      TEST_GATE_TIMEOUT_MS,
      "Cloudflare Sandbox test/build gate",
    );
  } catch (err) {
    return {
      ok: false,
      phase: "test_gate",
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
  let commit;
  try {
    commit = await withSourceActionTimeout(
      commitAndPushInSandbox(
        sandbox,
        {
          branchName,
          authorName: SLIDE_OF_HAND_COMMIT_IDENTITY.name,
          authorEmail: SLIDE_OF_HAND_COMMIT_IDENTITY.email,
          commitMessage,
        },
        workdir,
      ),
      GITHUB_PUSH_TIMEOUT_MS,
      "GitHub branch push",
    );
  } catch (err) {
    return {
      ok: false,
      phase: "github_push",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!commit.ok) {
    return {
      ok: false,
      phase: "github_push",
      error: commit.error,
      ...(commit.noEffectiveChanges ? { noEffectiveChanges: true } : {}),
    };
  }

  // 10. Open the draft PR.
  let pr;
  try {
    pr = await withSourceActionTimeout(
      openPullRequest({
        token: stored.token,
        head: commit.branch,
        base: "main",
        title: config.prTitle(slug),
        body: config.prBody(slug, commit.branch),
        draft: true,
      }),
      OPEN_PR_TIMEOUT_MS,
      "GitHub draft PR creation",
    );
  } catch (err) {
    return {
      ok: false,
      phase: "open_pr",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!pr.ok) {
    return { ok: false, phase: "open_pr", error: pr.message };
  }

  // 11. Persist the pending source-action record in direct mode. Queue
  // consumers own their status transitions so they disable this write.
  if (options.writePendingRecord !== false) {
    try {
      await withSourceActionTimeout(
        writePendingRecord(
          env,
          makePendingRecord(slug, config.action, pr.result.htmlUrl, {
            branch: commit.branch,
          }),
        ),
        PENDING_RECORD_TIMEOUT_MS,
        "Pending marker write",
      );
    } catch (err) {
      const actionLabel =
        config.action === "archive"
          ? "Archive"
          : config.action === "restore"
            ? "Restore"
            : "Delete";
      return {
        ok: false,
        phase: "pending_record",
        error: `${actionLabel} PR opened (${pr.result.htmlUrl}) but the pending marker write failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    ok: true,
    branch: commit.branch,
    prNumber: pr.result.number,
    prUrl: pr.result.htmlUrl,
    action: config.action,
  };
}

async function withSourceActionTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} timed out after ${Math.round(timeoutMs / 1000)} seconds. The source action was not finalized; please retry.`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  options: SourceLifecycleOptions = {},
): Promise<ArchiveSourceDeckResult | ArchiveSourceDeckError> {
  return runSourceLifecycle(env, input, ARCHIVE_CONFIG, getSandboxFn, options);
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
  options: SourceLifecycleOptions = {},
): Promise<RestoreSourceDeckResult | RestoreSourceDeckError> {
  return runSourceLifecycle(env, input, RESTORE_CONFIG, getSandboxFn, options);
}

// ── runDeleteSourceDeck ─────────────────────────────────────────────

/**
 * Delete a source-backed deck (active OR archived) by opening a
 * draft GitHub PR that removes the deck folder from `main`. Resolves
 * the folder as `src/decks/public/<slug>/` if present, else
 * `src/decks/archive/<slug>/`.
 *
 * **Side data (KV records, R2 thumbnails, analytics) is NOT cleaned
 * up here.** That cleanup is deferred to reconciliation (issue
 * #250), which runs after the PR is merged + deployed and confirms
 * the source no longer contains the deck. Until then, the pending
 * record (action=delete, expectedState=deleted) drives the admin
 * projection so the card shows in the Archived section with a
 * "Pending delete" pill linking to the PR.
 *
 * Built on `runSourceLifecycle` in `mode: "remove"`.
 */
export async function runDeleteSourceDeck(
  env: SourceDeckLifecycleEnv,
  input: DeleteSourceDeckInput,
  getSandboxFn: GetSandboxFn = getSandbox,
  options: SourceLifecycleOptions = {},
): Promise<DeleteSourceDeckResult | DeleteSourceDeckError> {
  return runSourceLifecycle(env, input, DELETE_CONFIG, getSandboxFn, options);
}

// ── Queue consumer ──────────────────────────────────────────────────

function redactedError(error: string, job: SourceDeckLifecycleJob): string {
  return error
    .replaceAll(job.userEmail, "[redacted-email]")
    .replace(/gh[opsu]_[A-Za-z0-9_]+/g, "[redacted-token]");
}

async function runQueuedSourceLifecycle(
  env: SourceDeckLifecycleEnv,
  job: SourceDeckLifecycleJob,
): Promise<
  | SourceLifecycleSuccess<PendingSourceActionType>
  | SourceLifecycleFailure
> {
  const input = { userEmail: job.userEmail, slug: job.slug };
  const options: SourceLifecycleOptions = { writePendingRecord: false };
  switch (job.action) {
    case "archive":
      return runArchiveSourceDeck(env, input, getSandbox, options);
    case "restore":
      return runRestoreSourceDeck(env, input, getSandbox, options);
    case "delete":
      return runDeleteSourceDeck(env, input, getSandbox, options);
  }
}

async function handleSourceLifecycleJob(
  job: SourceDeckLifecycleJob,
  env: SourceDeckLifecycleEnv,
): Promise<void> {
  const existing = await readPendingRecord(env, job.slug);
  await writePendingRecord(
    env,
    transitionPendingRecord(existing, job, { status: "running" }),
  );
  const result = await runQueuedSourceLifecycle(env, job);
  const latest = await readPendingRecord(env, job.slug);
  if (result.ok) {
    await writePendingRecord(
      env,
      transitionPendingRecord(latest, job, {
        status: "pr_open",
        prUrl: result.prUrl,
        branch: result.branch,
        error: undefined,
      }),
    );
    return;
  }
  await writePendingRecord(
    env,
    transitionPendingRecord(latest, job, {
      status: "failed",
      prUrl: undefined,
      branch: undefined,
      error: redactedError(result.error, job),
    }),
  );
}

export async function handleSourceDeckLifecycleQueue(
  batch: MessageBatch<SourceDeckLifecycleJob>,
  env: SourceDeckLifecycleEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    await handleSourceLifecycleJob(message.body, env);
  }
}

// ── HTTP router ─────────────────────────────────────────────────────

const ARCHIVE_PATH = /^\/api\/admin\/source-decks\/([^/]+)\/archive\/?$/;
const RESTORE_PATH = /^\/api\/admin\/source-decks\/([^/]+)\/restore\/?$/;
const DELETE_PATH = /^\/api\/admin\/source-decks\/([^/]+)\/delete\/?$/;

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

function buildQueuedResponse(record: PendingSourceAction): Response {
  return new Response(JSON.stringify({ ok: true, pending: record }), {
    status: 202,
    headers: NO_STORE_HEADERS,
  });
}

async function enqueueSourceLifecycleAction(
  request: Request,
  env: SourceDeckLifecycleEnv,
  slug: string,
  action: PendingSourceActionType,
  label: string,
): Promise<Response> {
  if (!isValidSlug(slug)) {
    return jsonError(400, `invalid slug: "${slug}"`);
  }
  const email = getAccessUserEmail(request);
  if (!email) {
    return jsonError(
      409,
      `Source ${label} requires an interactive Access user — service-token auth has no email to associate with a GitHub account.`,
    );
  }
  const stored = await getStoredGitHubToken(env, email);
  if (!stored) {
    return jsonError(
      409,
      "GitHub not connected. Connect GitHub from Settings → GitHub → Connect before retrying. This flow needs the user's GitHub credentials to clone the repo, push a branch, and open a draft PR.",
      { phase: "github_token" },
    );
  }
  if (!env.SOURCE_DECK_LIFECYCLE_QUEUE) {
    return jsonError(500, "Source lifecycle queue binding is not configured.");
  }
  const enqueuedAt = new Date().toISOString();
  const job: SourceDeckLifecycleJob = {
    jobId: crypto.randomUUID(),
    action,
    slug,
    userEmail: email,
    enqueuedAt,
  };
  const record = makeQueuedPendingRecord(job);
  await writePendingRecord(env, record);
  await env.SOURCE_DECK_LIFECYCLE_QUEUE.send(job, { contentType: "json" });
  return buildQueuedResponse(record);
}

async function handleArchive(
  request: Request,
  env: SourceDeckLifecycleEnv,
  slug: string,
): Promise<Response> {
  return enqueueSourceLifecycleAction(request, env, slug, "archive", "archive");
}

async function handleRestore(
  request: Request,
  env: SourceDeckLifecycleEnv,
  slug: string,
): Promise<Response> {
  return enqueueSourceLifecycleAction(request, env, slug, "restore", "restore");
}

async function handleDelete(
  request: Request,
  env: SourceDeckLifecycleEnv,
  slug: string,
): Promise<Response> {
  return enqueueSourceLifecycleAction(request, env, slug, "delete", "delete");
}

/**
 * Route a request against the source-deck lifecycle API. Returns a
 * `Response` for paths this handler owns, or `null` for the caller
 * to fall through. All paths are Access-gated.
 *
 * Owns:
 *   - `POST /api/admin/source-decks/<slug>/archive` — issue #247
 *   - `POST /api/admin/source-decks/<slug>/restore` — issue #248
 *   - `POST /api/admin/source-decks/<slug>/delete`  — issue #249
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
  const deleteMatch = url.pathname.match(DELETE_PATH);
  if (deleteMatch) {
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
    const slug = decodeURIComponent(deleteMatch[1]);
    return handleDelete(request, env, slug);
  }
  return null;
}
