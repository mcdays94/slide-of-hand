/**
 * Thin GitHub REST client for the in-Studio agent's tools (#131 phases
 * 3a + 3b).
 *
 * We do NOT pull in `@octokit/*` because the surface we need is tiny —
 * three endpoints — and `fetch()` from a Worker is the smallest viable
 * dependency. Octokit also ships substantial transitive deps that
 * would bloat the bundle for what amounts to a handful of REST calls.
 *
 * All functions take a per-user OAuth token (from `getStoredGitHubToken`)
 * and return parsed JSON results or a structured error. Tools call
 * these and translate the result back into the tool-message wire shape.
 *
 * ## Target repo
 *
 * Hardcoded to `mcdays94/slide-of-hand` for v1. Make configurable via
 * a wrangler var (e.g. `GITHUB_TARGET_REPO`) when the agent needs to
 * write to other repos.
 *
 * ## Data-deck storage path
 *
 * KV-backed (data) decks get committed to `data-decks/<slug>.json` in
 * the repo. This path is distinct from `src/decks/public/<slug>/` (the
 * build-time JSX decks) so the agent can tell them apart from listing
 * the source tree.
 */

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "slide-of-hand-agent/1.0";
const ACCEPT = "application/vnd.github+json";
const GITHUB_API_VERSION = "2022-11-28";

/**
 * Default target repo for agent-driven commits + source reads. Hardcoded
 * for v1; later phases can read this from a wrangler var.
 */
export const TARGET_REPO = {
  owner: "mcdays94",
  repo: "slide-of-hand",
} as const;

/**
 * Default branch the agent commits to / reads from. Direct commits to
 * `main` are intentional for phase 3a (the validator already gates the
 * write); phase 3c will switch source-deck edits to PR-based commits.
 */
export const DEFAULT_BRANCH = "main";

/** Where KV-backed deck JSON lives in the repo (one file per slug). */
export function dataDeckPath(slug: string): string {
  return `data-decks/${slug}.json`;
}

/** Base headers for every GitHub REST call. */
function ghHeaders(token: string): Record<string, string> {
  return {
    accept: ACCEPT,
    authorization: `Bearer ${token}`,
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": USER_AGENT,
  };
}

/** A single entry in a directory listing. */
export interface GitHubDirEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  sha: string;
}

export interface GitHubReadResult {
  /** UTF-8-decoded file content. */
  content: string;
  /** Size in bytes, as reported by GitHub. */
  size: number;
  /** Blob sha — used as the `sha` parameter on subsequent PUT requests. */
  sha: string;
  /** The path relative to the repo root. */
  path: string;
}

export interface GitHubWriteResult {
  /** The new commit's sha. */
  commitSha: string;
  /** Web URL to the commit on GitHub. Surfaced in tool-result UI. */
  commitHtmlUrl: string;
  /** The new blob sha for the written file. */
  contentSha: string;
  /** The path that was written. */
  path: string;
}

export type GitHubError =
  | { ok: false; kind: "not_found"; message: string }
  | { ok: false; kind: "auth"; message: string; status: number }
  | { ok: false; kind: "rate_limited"; message: string }
  | { ok: false; kind: "other"; message: string; status?: number };

/**
 * List files + directories at a given path in the target repo.
 *
 * For paths that resolve to a single file (not a directory), GitHub's
 * Contents API returns a single object instead of an array — we
 * normalise to always return an array for ergonomics.
 *
 * Treats 404 as "not found" rather than throwing. Other non-2xx
 * statuses become structured errors so the tool can surface a
 * descriptive message to the model.
 */
export async function listContents(
  token: string,
  path: string,
  ref: string = DEFAULT_BRANCH,
): Promise<{ ok: true; items: GitHubDirEntry[] } | GitHubError> {
  const cleanPath = stripLeadingSlash(path);
  const url = new URL(
    `${GITHUB_API}/repos/${TARGET_REPO.owner}/${TARGET_REPO.repo}/contents/${encodeRepoPath(cleanPath)}`,
  );
  url.searchParams.set("ref", ref);

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: ghHeaders(token),
    });
  } catch (err) {
    return {
      ok: false,
      kind: "other",
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (resp.status === 404) {
    return {
      ok: false,
      kind: "not_found",
      message: `path not found in ${TARGET_REPO.owner}/${TARGET_REPO.repo}@${ref}: ${cleanPath}`,
    };
  }
  if (resp.status === 401 || resp.status === 403) {
    return {
      ok: false,
      kind: "auth",
      message: `GitHub API returned ${resp.status} — the user's OAuth token may be missing the right scope, expired, or revoked. Suggest reconnecting from Settings.`,
      status: resp.status,
    };
  }
  if (!resp.ok) {
    const text = await safeText(resp);
    return {
      ok: false,
      kind: "other",
      message: `GitHub API returned ${resp.status}: ${text.slice(0, 200)}`,
      status: resp.status,
    };
  }

  const body = (await resp.json()) as unknown;
  const items: GitHubDirEntry[] = Array.isArray(body)
    ? (body as GitHubDirEntry[]).map(coerceDirEntry)
    : [coerceDirEntry(body as GitHubDirEntry)];
  return { ok: true, items };
}

/**
 * Read a single file's contents from the repo. Returns UTF-8 text;
 * binary files are detected and reported as such (without trying to
 * stuff binary into the tool-result string).
 *
 * GitHub's Contents API caps single-file reads at 1 MB; larger blobs
 * have to go through the Git Blobs API. We surface that limit as a
 * structured error so the tool can tell the model.
 */
export async function readFileContents(
  token: string,
  path: string,
  ref: string = DEFAULT_BRANCH,
): Promise<{ ok: true; result: GitHubReadResult } | GitHubError> {
  const cleanPath = stripLeadingSlash(path);
  const url = new URL(
    `${GITHUB_API}/repos/${TARGET_REPO.owner}/${TARGET_REPO.repo}/contents/${encodeRepoPath(cleanPath)}`,
  );
  url.searchParams.set("ref", ref);

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: ghHeaders(token),
    });
  } catch (err) {
    return {
      ok: false,
      kind: "other",
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (resp.status === 404) {
    return {
      ok: false,
      kind: "not_found",
      message: `file not found in ${TARGET_REPO.owner}/${TARGET_REPO.repo}@${ref}: ${cleanPath}`,
    };
  }
  if (resp.status === 401 || resp.status === 403) {
    return {
      ok: false,
      kind: "auth",
      message: `GitHub API returned ${resp.status} for ${cleanPath} — token may be missing scope, expired, or revoked.`,
      status: resp.status,
    };
  }
  if (!resp.ok) {
    const text = await safeText(resp);
    return {
      ok: false,
      kind: "other",
      message: `GitHub API returned ${resp.status} for ${cleanPath}: ${text.slice(0, 200)}`,
      status: resp.status,
    };
  }

  const body = (await resp.json()) as
    | { type?: string; content?: string; encoding?: string; size?: number; sha?: string; path?: string }
    | unknown[];

  if (Array.isArray(body)) {
    return {
      ok: false,
      kind: "other",
      message: `${cleanPath} is a directory; use the list tool instead`,
    };
  }
  if (body.type !== "file") {
    return {
      ok: false,
      kind: "other",
      message: `${cleanPath} is not a file (got type=${body.type ?? "unknown"})`,
    };
  }
  if (body.encoding !== "base64" || typeof body.content !== "string") {
    return {
      ok: false,
      kind: "other",
      message: `unexpected content encoding for ${cleanPath} (encoding=${body.encoding ?? "missing"})`,
    };
  }

  let decoded: string;
  try {
    decoded = decodeBase64Utf8(body.content);
  } catch (err) {
    return {
      ok: false,
      kind: "other",
      message: `file ${cleanPath} is not valid UTF-8 (likely binary): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    ok: true,
    result: {
      content: decoded,
      size: body.size ?? decoded.length,
      sha: body.sha ?? "",
      path: body.path ?? cleanPath,
    },
  };
}

/**
 * Create or update a single file at `path` on `branch`. Idempotent:
 * if the file already exists, we look up its current sha and supply
 * it so GitHub treats this as an update (otherwise GitHub rejects
 * the PUT with `sha required`).
 */
export async function putFileContents(
  token: string,
  options: {
    path: string;
    content: string;
    message: string;
    branch?: string;
    /** GitHub author info; defaults to the OAuth user's identity. */
    committer?: { name: string; email: string };
  },
): Promise<{ ok: true; result: GitHubWriteResult } | GitHubError> {
  const branch = options.branch ?? DEFAULT_BRANCH;
  const cleanPath = stripLeadingSlash(options.path);

  // Look up the existing file's sha. 404 means "create new"; non-404
  // errors propagate.
  const existing = await readFileContents(token, cleanPath, branch);
  let priorSha: string | undefined;
  if (existing.ok) {
    priorSha = existing.result.sha;
  } else if (existing.kind !== "not_found") {
    return existing;
  }

  const url = `${GITHUB_API}/repos/${TARGET_REPO.owner}/${TARGET_REPO.repo}/contents/${encodeRepoPath(cleanPath)}`;
  const body: Record<string, unknown> = {
    message: options.message,
    content: encodeBase64Utf8(options.content),
    branch,
  };
  if (priorSha) body.sha = priorSha;
  if (options.committer) body.committer = options.committer;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "PUT",
      headers: { ...ghHeaders(token), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      kind: "other",
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (resp.status === 401 || resp.status === 403) {
    return {
      ok: false,
      kind: "auth",
      message: `GitHub API returned ${resp.status} writing to ${cleanPath} — token may lack required scope (need at least public_repo).`,
      status: resp.status,
    };
  }
  if (resp.status === 422) {
    const text = await safeText(resp);
    return {
      ok: false,
      kind: "other",
      message: `GitHub rejected the commit (422): ${text.slice(0, 300)}`,
      status: 422,
    };
  }
  if (!resp.ok) {
    const text = await safeText(resp);
    return {
      ok: false,
      kind: "other",
      message: `GitHub API returned ${resp.status}: ${text.slice(0, 200)}`,
      status: resp.status,
    };
  }

  const json = (await resp.json()) as {
    commit?: { sha?: string; html_url?: string };
    content?: { sha?: string; path?: string };
  };
  return {
    ok: true,
    result: {
      commitSha: json.commit?.sha ?? "",
      commitHtmlUrl: json.commit?.html_url ?? "",
      contentSha: json.content?.sha ?? "",
      path: json.content?.path ?? cleanPath,
    },
  };
}

// ── helpers ───────────────────────────────────────────────────────────

function stripLeadingSlash(p: string): string {
  return p.startsWith("/") ? p.slice(1) : p;
}

/**
 * Encode the path portion of a Contents API URL. Segments need to be
 * URL-encoded individually (so slashes between dirs stay literal) and
 * we have to preserve the empty-path case (root listing).
 */
function encodeRepoPath(p: string): string {
  if (p === "") return "";
  return p.split("/").map(encodeURIComponent).join("/");
}

function coerceDirEntry(raw: GitHubDirEntry): GitHubDirEntry {
  return {
    name: raw.name,
    path: raw.path,
    type: raw.type,
    size: raw.size,
    sha: raw.sha,
  };
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

/**
 * Decode a base64-encoded string into UTF-8 text. Throws if the bytes
 * aren't valid UTF-8 (binary files trip this).
 */
function decodeBase64Utf8(base64: string): string {
  // GitHub's content field has newlines embedded every 60 chars — they
  // need to be stripped before atob.
  const flat = base64.replace(/\s+/g, "");
  const binary = atob(flat);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    bytes,
  );
}

/** Encode UTF-8 text as base64 for the Contents API PUT body. */
function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
