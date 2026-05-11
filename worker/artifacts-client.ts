/**
 * Cloudflare Artifacts client wrapper — scaffolding for issue #168 Wave 1
 * (Worker A's full implementation lands here).
 *
 * ## Status: SCAFFOLD ONLY
 *
 * The functions in this file are STUBS that throw `not implemented`.
 * Worker A's implementation in a future session fills in the bodies
 * against the real `env.ARTIFACTS` binding. Until the binding is added
 * to `wrangler.jsonc` (the user must approve that diff per standing
 * rule), the bodies stay unreachable.
 *
 * ## What this file owns
 *
 * Type definitions mirroring the Cloudflare Artifacts Workers binding
 * surface as documented at
 * <https://developers.cloudflare.com/artifacts/api/workers-binding/>
 * (read 2026-05-11 — verify against the live docs before relying on
 * the type details).
 *
 * Plus thin wrapper helpers that take the binding as an argument
 * (dependency injection — makes testing trivial when the
 * implementation lands).
 *
 * ## What goes in `wrangler.jsonc` when the binding is wired
 *
 * ```jsonc
 * "artifacts": [
 *   {
 *     "binding": "ARTIFACTS",
 *     "namespace": "default"
 *   }
 * ]
 * ```
 *
 * After running `npx wrangler types`, the generated
 * `worker-configuration.d.ts` declares `Artifacts` globally. Migrate
 * the local `ArtifactsBinding` interface to that generated type once
 * available.
 *
 * ## Auth context
 *
 * Per #168 amendment 2, draft deck repos are named
 * `${userEmail}-${slug}`. Forks come from the "deck-starter" baseline
 * repo (one-time Worker E setup — see issue #168 amendment 2 for the
 * provisioning script).
 */

/**
 * The Workers binding shape. Mirrors the generated `Artifacts`
 * interface that `wrangler types` produces once the binding is in
 * `wrangler.jsonc`. Kept local so the file compiles cleanly today.
 *
 * TODO(worker A — Wave 1): replace this with `Artifacts` from
 * `worker-configuration.d.ts` once the binding is in wrangler config
 * and `wrangler types` has been re-run.
 */
export interface ArtifactsBinding {
  create(
    name: string,
    opts?: {
      readOnly?: boolean;
      description?: string;
      setDefaultBranch?: string;
    },
  ): Promise<ArtifactsCreateRepoResult>;
  get(name: string): Promise<ArtifactsRepo>;
  list(opts?: {
    limit?: number;
    cursor?: string;
  }): Promise<ArtifactsRepoListResult>;
  import(params: {
    source: { url: string; branch?: string; depth?: number };
    target: {
      name: string;
      opts?: { description?: string; readOnly?: boolean };
    };
  }): Promise<ArtifactsCreateRepoResult>;
  delete(name: string): Promise<boolean>;
}

export interface ArtifactsRepoInfo {
  id: string;
  name: string;
  remote: string;
  defaultBranch: string;
  status: "ready" | "importing" | "forking";
}

export interface ArtifactsRepo extends ArtifactsRepoInfo {
  createToken(
    scope?: "read" | "write",
    ttl?: number,
  ): Promise<ArtifactsCreateTokenResult>;
  listTokens(): Promise<ArtifactsTokenListResult>;
  revokeToken(tokenOrId: string): Promise<boolean>;
  fork(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      defaultBranchOnly?: boolean;
    },
  ): Promise<ArtifactsCreateRepoResult>;
}

export interface ArtifactsCreateRepoResult {
  name: string;
  remote: string;
  defaultBranch: string;
  token: string;
}

export interface ArtifactsCreateTokenResult {
  plaintext: string;
  expiresAt: string;
}

export interface ArtifactsTokenListResult {
  total: number;
  tokens: Array<{
    id: string;
    scope: "read" | "write";
    createdAt: string;
    expiresAt: string;
  }>;
}

export interface ArtifactsRepoListResult {
  repos: ArtifactsRepoInfo[];
  cursor?: string;
}

/**
 * Convention for naming draft deck repos: `${userEmail}-${slug}`.
 * Email is the Access-issued user identity. Slug is the deck slug
 * the agent is iterating on. Sanitised to fit RepoName constraints
 * (alphanumeric + hyphens + dots; no `@` from emails).
 *
 * Exposed as a pure helper so Worker A's tool implementations + tests
 * agree on the naming.
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
  return `${sanitisedEmail}-${sanitisedSlug}`;
}

/**
 * Baseline repo name for new deck drafts. Created once via the Worker E
 * provisioning step (#168 amendment 2). Forks for individual draft
 * sessions point at this as their source.
 */
export const DECK_STARTER_REPO = "deck-starter";

/**
 * Fork the deck-starter baseline into a new draft repo for the given
 * `(userEmail, slug)` pair. Returns the fork's remote URL + initial
 * write token.
 *
 * STUB — Worker A fills in the body.
 */
export async function forkDeckStarter(
  artifacts: ArtifactsBinding,
  userEmail: string,
  slug: string,
  opts?: { description?: string },
): Promise<ArtifactsCreateRepoResult> {
  // Reference the parameters so `noUnusedParameters` is satisfied
  // while keeping the body a thrown stub. Worker A's implementation
  // replaces this with the real binding calls.
  void artifacts;
  void userEmail;
  void slug;
  void opts;
  throw new Error(
    "[artifacts-client] forkDeckStarter is not implemented yet (issue #168 Wave 1 / Worker A).",
  );
}

/**
 * Resolve a draft repo handle for the given `(userEmail, slug)` pair.
 * Throws if the repo doesn't exist yet (Worker A's tool callers should
 * fall back to `forkDeckStarter` in that case).
 *
 * STUB — Worker A fills in the body.
 */
export async function getDraftRepo(
  artifacts: ArtifactsBinding,
  userEmail: string,
  slug: string,
): Promise<ArtifactsRepo> {
  void artifacts;
  void userEmail;
  void slug;
  throw new Error(
    "[artifacts-client] getDraftRepo is not implemented yet (issue #168 Wave 1 / Worker A).",
  );
}

/**
 * Mint a short-lived write token for the Sandbox to use when pushing
 * generated deck source back into the draft repo. Default TTL is 5
 * minutes — enough for a full clone + AI gen + push cycle, short
 * enough that a leaked token can't be reused.
 *
 * STUB — Worker A fills in the body.
 */
export async function mintWriteToken(
  repo: ArtifactsRepo,
  ttlSeconds: number = 5 * 60,
): Promise<ArtifactsCreateTokenResult> {
  void repo;
  void ttlSeconds;
  throw new Error(
    "[artifacts-client] mintWriteToken is not implemented yet (issue #168 Wave 1 / Worker A).",
  );
}
