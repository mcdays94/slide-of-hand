/**
 * Source-backed deck lifecycle actions via gated GitHub draft PR
 * (issue #247 / PRD #242).
 *
 * Provides the Worker-side surface for source-deck Archive (and, in
 * follow-up slices #248–#249, Restore + Delete). The flow:
 *
 *   1. Admin clicks Archive on a source deck card.
 *   2. Admin UI confirms GitHub is connected (#251 gate). If not,
 *      the gate intercepts here.
 *   3. Admin UI calls `POST /api/admin/source-decks/<slug>/archive`.
 *   4. This Worker module:
 *      a. Verifies Access auth + user email.
 *      b. Resolves the user's GitHub OAuth token from KV.
 *      c. Spawns a Cloudflare Sandbox, clones slide-of-hand from
 *         GitHub on `main`, verifies `src/decks/public/<slug>/`
 *         exists AND `src/decks/archive/<slug>/` does NOT.
 *      d. `mkdir -p src/decks/archive` + `git mv` the deck folder.
 *      e. Runs the standard test gate (`npm ci` → typecheck → test
 *         → build) against the post-move tree.
 *      f. Commits + pushes `archive/<slug>-<timestamp>`.
 *      g. Opens a draft PR against `main`.
 *      h. Persists a `PendingSourceAction` record in KV so the
 *         admin UI's projection (#246) immediately shows the deck
 *         in the Archived section with a Pending pill + PR link.
 *
 * **No direct writes to `main`.** The PR is always draft. The admin
 * UI's pending projection survives a reload because the record lives
 * in KV.
 *
 * **Tests must mock every Sandbox/GitHub collaborator.** No real
 * network. See `worker/source-deck-lifecycle.test.ts`.
 *
 * ## Why a dedicated module
 *
 * `worker/sandbox-deck-creation.ts` owns `runPublishDraft`, which
 * is the closest sibling flow but operates on a *different domain*:
 * it ships a brand-new AI-generated deck from Artifacts to GitHub.
 * Archive is a structural mutation of the existing source tree —
 * different inputs (no Artifacts), different effects (file move
 * rather than file write), different commit shape (`archive/` branch
 * prefix, archive-themed message). Sharing the underlying primitives
 * (`cloneRepoIntoSandbox`, `runSandboxTestGate`,
 * `commitAndPushInSandbox`, `openPullRequest`) is the right level of
 * reuse; sharing the orchestrator would couple two flows that will
 * diverge as Restore (#248) and Delete (#249) land.
 *
 * ## Slug validation
 *
 * Slugs arrive from the URL path and are also used in shell paths
 * inside the Sandbox (`test -d src/decks/public/<slug>`). The
 * existing `isValidSlug` helper restricts to `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`
 * which is shell-safe by construction (no spaces, slashes, quote
 * characters, or `..`). We still validate at every entry point as
 * defence in depth.
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

export type ArchiveSourceDeckPhase =
  | "auth"
  | "invalid_slug"
  | "github_token"
  | "clone_github"
  | "source_missing"
  | "archive_exists"
  | "move"
  | "test_gate"
  | "github_push"
  | "open_pr"
  | "pending_record";

export interface ArchiveSourceDeckResult {
  ok: true;
  branch: string;
  prNumber: number;
  prUrl: string;
  action: "archive";
}

export interface ArchiveSourceDeckError {
  ok: false;
  phase: ArchiveSourceDeckPhase;
  error: string;
  failedTestGatePhase?: TestGatePhase;
  testGatePhases?: TestGatePhaseResult[];
  noEffectiveChanges?: boolean;
}

export type GetSandboxFn = (
  namespace: DurableObjectNamespace<Sandbox>,
  id: string,
) => Sandbox;

// ── KV layout (mirrors `worker/pending-source-actions.ts`) ──────────

const KV_PENDING_RECORD = (slug: string) => `pending-source-action:${slug}`;
const KV_PENDING_INDEX = "pending-source-actions-list";

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
 * Build the pending-source-action record for an archive that just
 * opened a PR.
 */
function makeArchivePendingRecord(
  slug: string,
  prUrl: string,
): PendingSourceAction {
  return {
    slug,
    action: "archive",
    expectedState: expectedStateFor("archive"),
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

/**
 * Build the PR body for an archive PR. Terse on purpose — the diff
 * (a folder rename) is the message; the body just gives the
 * reviewer context + ties back to PRD #242 / issue #247.
 */
function buildArchivePrBody(slug: string, branch: string): string {
  return [
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
  ].join("\n");
}

// ── runArchiveSourceDeck ────────────────────────────────────────────

/**
 * Archive a source-backed deck by opening a draft GitHub PR that
 * moves `src/decks/public/<slug>/` to `src/decks/archive/<slug>/`.
 *
 * See module docstring for the full flow. Returns a tagged-union
 * result; consumers translate the `phase` discriminant into HTTP
 * status codes / inline error copy.
 */
export async function runArchiveSourceDeck(
  env: SourceDeckLifecycleEnv,
  input: ArchiveSourceDeckInput,
  getSandboxFn: GetSandboxFn = getSandbox,
): Promise<ArchiveSourceDeckResult | ArchiveSourceDeckError> {
  // 1. Auth.
  const email = (input.userEmail ?? "").trim();
  if (!email) {
    return {
      ok: false,
      phase: "auth",
      error:
        "Archiving a source deck requires an authenticated user. Service-token contexts have no user identity to commit on behalf of.",
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

  // 4. Sandbox. Keyed by `source-archive:<slug>` so retries against
  // the same slug reuse the warmed container. Each call starts with
  // a fresh clone (step 5) so there's no leakage between attempts.
  const sandbox = getSandboxFn(env.Sandbox, `source-archive:${slug}`);

  // 5. Clone slide-of-hand from GitHub. Uses the user's per-user
  // OAuth token via the standard helper — same path runPublishDraft
  // uses for its GH-side clone.
  const ghClone = await cloneRepoIntoSandbox(sandbox, {
    token: stored.token,
    repo: TARGET_REPO,
    workdir: "/workspace/slide-of-hand",
  });
  if (!ghClone.ok) {
    return { ok: false, phase: "clone_github", error: ghClone.error };
  }

  const workdir = ghClone.workdir;

  // 6a. Source folder must exist on main, otherwise the archive is
  // a no-op (and the resulting PR would have an empty diff).
  const sourceExists = await dirExists(
    sandbox,
    workdir,
    `src/decks/public/${slug}`,
  );
  if (!sourceExists) {
    return {
      ok: false,
      phase: "source_missing",
      error: `Source folder src/decks/public/${slug}/ does not exist on \`main\`. Nothing to archive.`,
    };
  }

  // 6b. Archive folder must NOT exist — otherwise the move would
  // collide. The recovery is manual (a maintainer renames or merges
  // by hand) so we surface the conflict cleanly.
  const archiveExists = await dirExists(
    sandbox,
    workdir,
    `src/decks/archive/${slug}`,
  );
  if (archiveExists) {
    return {
      ok: false,
      phase: "archive_exists",
      error: `Archive folder src/decks/archive/${slug}/ already exists on \`main\`. Archive is blocked until the conflict is resolved.`,
    };
  }

  // 7. Move the folder. `mkdir -p` + `git mv` so git tracks the
  // rename and the resulting PR diff is a clean rename (which keeps
  // history intact and `git log --follow` working from the archived
  // location).
  let moveResult;
  try {
    moveResult = await sandbox.exec(
      `mkdir -p src/decks/archive && git mv src/decks/public/${slug} src/decks/archive/${slug}`,
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

  // 8. Test gate against the post-move tree. Catches anything that
  // references the deck via the now-stale `src/decks/public/<slug>`
  // path AND catches build/test breakage from the rename. Slow step
  // (60–120 s in production) — Sandbox is keyed so retries reuse the
  // container, but a fresh clone resets the workdir per attempt.
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
  const branchName = `archive/${slug}-${Date.now()}`;
  const commitMessage = `chore(deck/${slug}): archive deck (#247)`;
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
  const prTitle = `chore(deck/${slug}): archive deck (#247)`;
  const pr = await openPullRequest({
    token: stored.token,
    head: commit.branch,
    base: "main",
    title: prTitle,
    body: buildArchivePrBody(slug, commit.branch),
    draft: true,
  });
  if (!pr.ok) {
    return { ok: false, phase: "open_pr", error: pr.message };
  }

  // 11. Persist the pending source-action record so the admin UI
  // projection (#246) immediately reflects the expected state. KV
  // writes are best-effort relative to the PR — the PR is the source
  // of truth — but a failure here is still surfaced so callers can
  // retry. The PR remains open either way; the user can "Clear
  // pending" to reset the marker if needed.
  try {
    await writePendingRecord(env, makeArchivePendingRecord(slug, pr.result.htmlUrl));
  } catch (err) {
    return {
      ok: false,
      phase: "pending_record",
      error: `Archive PR opened (${pr.result.htmlUrl}) but the pending marker write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    ok: true,
    branch: commit.branch,
    prNumber: pr.result.number,
    prUrl: pr.result.htmlUrl,
    action: "archive",
  };
}

// ── HTTP router ─────────────────────────────────────────────────────

const ARCHIVE_PATH = /^\/api\/admin\/source-decks\/([^/]+)\/archive\/?$/;

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
 * Map a phase from `runArchiveSourceDeck` to an HTTP status code.
 *
 *   - auth / github_token → 409 (the caller's environment isn't
 *     ready; the UI surfaces a "connect GitHub" hint).
 *   - invalid_slug → 400.
 *   - source_missing / archive_exists → 400 (caller asked for an
 *     operation that doesn't match disk state).
 *   - everything else (clone/test_gate/push/PR/KV) → 400 with the
 *     phase echoed so the UI can show the right error.
 *
 * We avoid 500 — every failure is a known shape, not an internal
 * server error.
 */
function statusForPhase(phase: ArchiveSourceDeckPhase): number {
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

async function handleArchive(
  request: Request,
  env: SourceDeckLifecycleEnv,
  slug: string,
): Promise<Response> {
  // Slug validation again at the router boundary so a malformed slug
  // never reaches the executor.
  if (!isValidSlug(slug)) {
    return jsonError(400, `invalid slug: "${slug}"`);
  }
  const email = getAccessUserEmail(request);
  if (!email) {
    // `requireAccessAuth` accepts service-token contexts (JWT) for
    // defence-in-depth, but archive needs a user email to attribute
    // the PR. Reject cleanly so the UI shows the "connect GitHub"
    // hint.
    return jsonError(
      409,
      "Source archive requires an interactive Access user — service-token auth has no email to associate with a GitHub account.",
    );
  }
  const result = await runArchiveSourceDeck(env, { userEmail: email, slug });
  if (result.ok) {
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
  const status = statusForPhase(result.phase);
  return jsonError(status, result.error, {
    phase: result.phase,
    ...(result.failedTestGatePhase
      ? { failedTestGatePhase: result.failedTestGatePhase }
      : {}),
    ...(result.noEffectiveChanges ? { noEffectiveChanges: true } : {}),
  });
}

/**
 * Route a request against the source-deck lifecycle API. Returns a
 * `Response` for paths this handler owns, or `null` for the caller
 * to fall through. All paths are Access-gated.
 *
 * Owns:
 *   - `POST /api/admin/source-decks/<slug>/archive` — issue #247
 *
 * Restore (#248) + Delete (#249) ship in follow-up slices.
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
  return null;
}
