/**
 * Cloudflare Artifacts client helpers for issue #168 Wave 1 (Worker A).
 *
 * Thin wrappers around the `Artifacts` binding (typed by
 * `worker-configuration.d.ts` after `npx wrangler types`). The wrappers
 * exist so:
 *
 *   - The agent's tool runners get a focused API for the operations
 *     they need (`createDraftRepo`, `getDraftRepo`, `mintWriteToken`,
 *     `ensureDeckStarterRepo`) rather than re-deriving the binding
 *     dance every time.
 *
 *   - Tests can inject a stubbed `Artifacts` surface without spinning
 *     up real binding calls.
 *
 *   - The `?expires=` token suffix stripping + URL-embedded auth
 *     pattern live in one place (`buildAuthenticatedRemoteUrl`).
 *     Bug fixes don't have to be re-applied across the agent + the
 *     preview route + the publish flow.
 *
 * ## Auth + URL conventions
 *
 * Per the Artifacts git protocol docs
 * (<https://developers.cloudflare.com/artifacts/api/git-protocol/>):
 *
 *   - Tokens are issued as `art_v1_<40-hex>?expires=<unix-seconds>`.
 *     The `?expires=` suffix is metadata for the holder — strip it
 *     before embedding in a URL.
 *
 *   - Two auth flavours:
 *     1. Bearer header (recommended for long-lived workflows).
 *     2. HTTP Basic in the URL (`https://x:<token>@host/path`) —
 *        the username is ignored; `x` is a placeholder. Best for
 *        one-shot Sandbox `git clone` / `git push` commands where
 *        the URL is the cleanest carrier.
 *
 *   - Push is supported on protocol v1 only. The Sandbox helpers in
 *     `worker/sandbox-deck-creation.ts` force `-c protocol.version=1`
 *     on push to avoid the v2-receive-pack-not-supported failure
 *     mode.
 *
 * ## Naming
 *
 * - `deck-starter` — historical baseline repo. Used to be the source
 *   for `starter.fork()` draft creation; no longer load-bearing
 *   after the #182 workaround switched to `Artifacts.create()`
 *   directly. Kept in place via `ensureDeckStarterRepo` /
 *   `POST /api/admin/setup/deck-starter` for backward compatibility
 *   + as a safety net if `fork()` is ever revived. Removing it is a
 *   separate cleanup.
 *
 * - `${userEmail}-${slug}` — draft repo name for a given user + deck
 *   slug. Email sanitised: lowercase, alphanumeric + hyphens only,
 *   no leading/trailing/duplicate hyphens. Slug sanitised likewise.
 *   This is the only namespacing — Artifacts itself scopes repos by
 *   the namespace declared in `wrangler.jsonc` (`slide-of-hand-drafts`).
 */

/**
 * Convention: every draft deck repo is named `${userEmail}-${slug}`
 * (both sanitised). Helper kept pure so callers + tests agree on the
 * naming.
 */
export function draftRepoName(userEmail: string, slug: string): string {
  const sanitisedEmail = userEmail
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const sanitisedSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!sanitisedEmail) throw new Error("draftRepoName: invalid user email");
  if (!sanitisedSlug) throw new Error("draftRepoName: invalid slug");
  return `${sanitisedEmail}-${sanitisedSlug}`;
}

/**
 * Baseline repo name. Created once via Worker E; never deleted.
 */
export const DECK_STARTER_REPO = "deck-starter";

/**
 * Detect whether an error from the Artifacts API indicates a
 * duplicate-name collision (the repo already exists). Diagnosed
 * during the post-#179 verification — the Artifacts beta surfaces
 * this case as either:
 *
 *   1. A generic `An internal error occurred.` (when the API
 *      transient-fails AFTER successfully creating the repo, the
 *      retry then sees a duplicate but reports it as 500).
 *   2. An explicit `repo already exists: <name>` message.
 *
 * Both are recoverable: the repo IS there, we just need to fetch
 * a handle for it instead of trying to create it again.
 * `createDraftRepo` uses this to do exactly that, turning a
 * transient duplicate error into a successful response.
 *
 * The matcher is intentionally generous: "already exists",
 * "duplicate", and "conflict" all qualify. The cost of a false
 * positive (treating a non-duplicate as recoverable) is one
 * extra `getDraftRepo` call which then throws its own error;
 * the cost of a false negative is the bug we're fixing today.
 */
export function isDuplicateNameError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists|duplicate|conflict/i.test(msg);
}

/**
 * Token TTL for write operations inside the Sandbox. 5 minutes —
 * comfortably covers clone → AI gen → commit → push (typically 30s)
 * but short enough that a leaked token can't be reused weeks later.
 *
 * The Artifacts default is 24 hours; we tighten because tokens leave
 * the Worker (embedded in clone URLs inside the Sandbox container).
 */
export const DEFAULT_WRITE_TOKEN_TTL_SECONDS = 5 * 60;

/**
 * Strip the `?expires=<unix-seconds>` metadata suffix from an
 * Artifacts token. The bare token is what goes in the URL or the
 * Authorization header.
 */
export function stripExpiresSuffix(token: string): string {
  const queryIdx = token.indexOf("?expires=");
  if (queryIdx === -1) return token;
  return token.slice(0, queryIdx);
}

/**
 * Parse the `?expires=` suffix on an Artifacts token and return the
 * expiry as a `Date`. Returns `null` if the suffix is missing or
 * unparseable — callers can treat that as "expires unknown".
 */
export function parseTokenExpiry(token: string): Date | null {
  const queryIdx = token.indexOf("?expires=");
  if (queryIdx === -1) return null;
  const expiresStr = token.slice(queryIdx + "?expires=".length);
  const seconds = Number.parseInt(expiresStr, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/**
 * Build a clone/push URL with the token embedded via HTTP Basic auth.
 * The username slot is the placeholder `x` (Artifacts ignores it).
 * The token's `?expires=` suffix is stripped first.
 *
 * Throws if the remote URL isn't HTTPS — git clone over plain HTTP
 * with credentials would leak the token over the wire. The Artifacts
 * remote URL is always HTTPS in practice; this is a defensive
 * assertion against future configuration drift.
 */
export function buildAuthenticatedRemoteUrl(
  remote: string,
  token: string,
): string {
  const url = new URL(remote);
  if (url.protocol !== "https:") {
    throw new Error(
      `buildAuthenticatedRemoteUrl: remote must be HTTPS (got ${url.protocol}).`,
    );
  }
  const secret = stripExpiresSuffix(token);
  url.username = "x";
  url.password = secret;
  return url.toString();
}

/**
 * Create a fresh draft repo named `${userEmail}-${slug}` (sanitised)
 * in the Artifacts namespace. Returns the repo's metadata + the
 * initial write token for the Sandbox to use.
 *
 * ## Why `create()` instead of `deck-starter.fork()`
 *
 * Originally this was `forkDeckStarter` and called
 * `starter.fork(targetName, ...)`. Post-#180 diagnostic (see #182 +
 * the `/api/admin/_diag/artifacts` enhancement that landed alongside
 * this refactor) showed three things:
 *
 *   1. `fork()` was returning `ArtifactsError: An internal error
 *      occurred.` with 100% failure rate against this namespace.
 *   2. Failed forks left NO repos behind (the ghost-probe `get()`
 *      after a failed fork returned `Repository not found`).
 *   3. `Artifacts.create()` was healthy on the same namespace.
 *
 * In this codebase the fork was never doing anything fork-shaped:
 * the deck-starter baseline is empty (per `sandbox-artifacts.ts`
 * lines 19-22 — "Fresh Artifacts repos are EMPTY (no initial
 * commit)") and the AI gen pass writes every file from scratch on
 * the first turn. The fork was just "give me a new empty namespaced
 * repo." `Artifacts.create()` does exactly that with a single call.
 *
 * So this function now skips the `get("deck-starter") → starter.fork()`
 * dance and calls `artifacts.create(targetName, ...)` directly. The
 * deck-starter baseline is left in place (`ensureDeckStarterRepo`
 * still works) but no longer load-bearing — removing it is a
 * separate cleanup.
 *
 * ## Duplicate-name recovery
 *
 * Kept from the previous `forkDeckStarter` implementation. The
 * Artifacts API can still return a duplicate-name error on
 * `create()` if a prior call to create the same repo succeeded but
 * had a transient response failure. The recovery path is identical:
 * fetch a handle for the existing repo + mint a fresh write token +
 * synthesise an `ArtifactsCreateRepoResult` from the existing
 * metadata. See `isDuplicateNameError` for the matcher.
 */
export async function createDraftRepo(
  artifacts: Artifacts,
  userEmail: string,
  slug: string,
  opts: { description?: string } = {},
): Promise<ArtifactsCreateRepoResult> {
  const targetName = draftRepoName(userEmail, slug);
  try {
    return await artifacts.create(targetName, {
      description:
        opts.description ??
        `Draft deck for ${slug} by ${userEmail} (Slide of Hand #168).`,
      readOnly: false,
      setDefaultBranch: "main",
    });
  } catch (err) {
    if (!isDuplicateNameError(err)) {
      throw err;
    }
    // The repo already exists — usually because a prior create
    // succeeded server-side but the API surfaced a transient
    // error before returning success. Recover by fetching a
    // handle + minting a fresh write token, and return the same
    // shape we'd have returned on a successful create.
    //
    // The shape of `ArtifactsCreateRepoResult` includes `name`,
    // `remote`, and `token` (plaintext); we synthesise it from the
    // existing repo's metadata + a freshly-minted write token.
    console.info(
      `[artifacts-client] createDraftRepo: duplicate-name recovery for ${targetName}. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
    const existing = await artifacts.get(targetName);
    const freshToken = await mintWriteToken(existing);
    // Synthesise the `ArtifactsCreateRepoResult` shape from the
    // existing repo's metadata + a fresh write token. The metadata
    // getters on `Artifacts.get()`'s handle are reliable at runtime
    // (the documented serialization quirk only affects
    // JSON.stringify; direct property access works).
    return {
      id: existing.id,
      name: existing.name,
      description: existing.description,
      defaultBranch: existing.defaultBranch,
      remote: existing.remote,
      token: freshToken.plaintext,
      tokenExpiresAt: freshToken.expiresAt,
    };
  }
}

/**
 * Idempotent variant of `createDraftRepo`. Tries `getDraftRepo`
 * first; if the repo doesn't exist, creates it. Returns a
 * discriminated union so callers can tell which path was taken.
 *
 * Note: the Artifacts SDK's `get()` throws if the repo doesn't exist
 * yet (or hasn't finished provisioning). Catching the error here is
 * the only signal we have for "not found vs. transient failure" — the
 * SDK doesn't expose a typed error class. The error message is logged
 * so operators can see the underlying cause if the subsequent create
 * also fails.
 */
export async function ensureDraftRepo(
  artifacts: Artifacts,
  userEmail: string,
  slug: string,
  opts: { description?: string } = {},
): Promise<
  | { kind: "existed"; repo: ArtifactsRepo; freshWriteToken: ArtifactsCreateTokenResult }
  | { kind: "created"; result: ArtifactsCreateRepoResult }
> {
  try {
    const existing = await getDraftRepo(artifacts, userEmail, slug);
    const freshWriteToken = await mintWriteToken(existing);
    return { kind: "existed", repo: existing, freshWriteToken };
  } catch (err) {
    // Repo doesn't exist yet — proceed to create. Logged at info
    // level so operators can spot legitimate "not found" vs.
    // transient failures (which would surface on the subsequent
    // create call).
    console.info(
      `[artifacts-client] ensureDraftRepo: repo not found, creating. (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
  const result = await createDraftRepo(artifacts, userEmail, slug, opts);
  return { kind: "created", result };
}

/**
 * Resolve a handle for an existing draft repo. Throws if the repo
 * doesn't exist or isn't ready yet.
 */
export async function getDraftRepo(
  artifacts: Artifacts,
  userEmail: string,
  slug: string,
): Promise<ArtifactsRepo> {
  const name = draftRepoName(userEmail, slug);
  return artifacts.get(name);
}

/**
 * Mint a short-lived write token for the Sandbox to use when pushing.
 * Returns the structured result (with `plaintext` + `expiresAt`) so
 * callers know both the token and when it expires.
 */
export async function mintWriteToken(
  repo: ArtifactsRepo,
  ttlSeconds: number = DEFAULT_WRITE_TOKEN_TTL_SECONDS,
): Promise<ArtifactsCreateTokenResult> {
  return repo.createToken("write", ttlSeconds);
}

/**
 * Mint a short-lived read token. Used by the preview route to fetch
 * repo files at a given SHA without exposing write credentials.
 */
export async function mintReadToken(
  repo: ArtifactsRepo,
  ttlSeconds: number = DEFAULT_WRITE_TOKEN_TTL_SECONDS,
): Promise<ArtifactsCreateTokenResult> {
  return repo.createToken("read", ttlSeconds);
}

/**
 * Ensure the deck-starter baseline repo exists. Idempotent: returns
 * `{ kind: "existed", repo }` if it's already there, `{ kind:
 * "created", result }` if we just made it.
 *
 * Used by the Worker E setup endpoint
 * (`POST /api/admin/setup/deck-starter`). Safe to call repeatedly.
 */
export async function ensureDeckStarterRepo(
  artifacts: Artifacts,
  opts: { description?: string } = {},
): Promise<
  | { kind: "existed"; repo: ArtifactsRepo }
  | { kind: "created"; result: ArtifactsCreateRepoResult }
> {
  try {
    const existing = await artifacts.get(DECK_STARTER_REPO);
    return { kind: "existed", repo: existing };
  } catch (err) {
    console.info(
      `[artifacts-client] ensureDeckStarterRepo: baseline not found, creating. (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
  const result = await artifacts.create(DECK_STARTER_REPO, {
    description:
      opts.description ??
      "Baseline repo for Slide of Hand AI-generated deck drafts (#168).",
    readOnly: false,
    setDefaultBranch: "main",
  });
  return { kind: "created", result };
}
