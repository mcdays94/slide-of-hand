/**
 * GitHub OAuth Web Flow — per-user GitHub connection for the in-Studio
 * AI agent's `commitPatch` tool (issue #131 phase 3 prep).
 *
 * The agent commits deck JSON to GitHub when the user confirms an
 * edit. A single shared PAT would attribute every commit to one
 * account; OAuth Web Flow gives each authenticated admin user their
 * own connection so commits show up authored by the person who
 * actually triggered them.
 *
 * ## Flow
 *
 * 1. **Start.** The user clicks "Connect GitHub" in Settings → the
 *    SPA opens `/api/admin/auth/github/start?returnTo=<path>`. We
 *    generate a single-use `state` token, stash it in KV alongside
 *    the Access user's email + `returnTo`, then 302 to GitHub's
 *    authorize page with our `client_id` + `state` + `scope`.
 *
 * 2. **Authorize.** The user clicks Authorize on github.com. GitHub
 *    302s them back to our callback with `?code=...&state=...`.
 *
 * 3. **Callback.** We look up the state in KV. If it's missing,
 *    expired, or the stored email doesn't match the current Access
 *    user's email, we reject with 400. Otherwise we delete the state
 *    (single-use) and exchange `code` for an access token via
 *    `POST https://github.com/login/oauth/access_token`. We then
 *    fetch the user's GitHub identity (`/user`) and store
 *    `{ token, username, scopes, connectedAt }` at
 *    `github-token:<email>`. Finally we 302 back to `returnTo`.
 *
 * 4. **Status.** `GET /api/admin/auth/github/status` returns
 *    `{ connected, username?, scopes? }`. Never returns the token
 *    itself — that's an internal-only secret.
 *
 * 5. **Disconnect.** `POST /api/admin/auth/github/disconnect` deletes
 *    the stored token. Optionally also revokes it on GitHub's side
 *    (best-effort — we don't block the disconnect on the GitHub call).
 *
 * ## Why this works through Cloudflare Access
 *
 * The OAuth callback is a browser-driven 302 from github.com back to
 * the slide-of-hand origin. The user's browser still has its
 * `CF_Authorization` cookie from the Access challenge that ran when
 * they signed in initially, so the callback request arrives with
 * `cf-access-authenticated-user-email` populated by Access at the
 * edge. The Worker validates that header via `requireAccessAuth()`
 * before doing any code-exchange work.
 *
 * ## Trust model
 *
 * - The `state` token is generated server-side via `crypto.randomUUID()`
 *   (cryptographically random, per workers-best-practices). KV stores
 *   it with a 10-minute TTL and we delete on first use. An attacker
 *   cannot guess a valid state, replay a used state, or forge one
 *   bound to a different user.
 * - The exchange of `code` for `token` happens server-to-server with
 *   our `client_secret` (a Worker secret). The token never appears
 *   in client-visible URLs or responses.
 * - The stored `token` is keyed on the Access-verified user email.
 *   Service tokens (no email) can't OAuth-connect — they have no
 *   user identity to associate a GitHub account with. The status
 *   endpoint returns `{ connected: false }` for service-token
 *   callers.
 * - Scope is `public_repo` for v1 — read/write public repos only.
 *   Bumping to `repo` is a one-line change if private decks ever
 *   need committing.
 *
 * ## Reading the stored token
 *
 * Other modules (notably the phase-3 `commitPatch` agent tool) can
 * call `getStoredGitHubToken(env, email)` to fetch a user's token.
 * Returns `null` if not connected. The token is then used as a
 * `Bearer` header against the GitHub API.
 */
import { getAccessUserEmail, requireAccessAuth } from "./access-auth";

export interface GitHubOAuthEnv {
  GITHUB_TOKENS: KVNamespace;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
}

const PATH_PREFIX = "/api/admin/auth/github";
const START_PATH = `${PATH_PREFIX}/start`;
const CALLBACK_PATH = `${PATH_PREFIX}/callback`;
const STATUS_PATH = `${PATH_PREFIX}/status`;
const DISCONNECT_PATH = `${PATH_PREFIX}/disconnect`;

/** OAuth scope. v1 uses `public_repo`; bump to `repo` if/when private decks need committing. */
const OAUTH_SCOPE = "public_repo";

/** State tokens are single-use and expire 10 minutes after generation. */
const STATE_TTL_SECONDS = 600;

/** KV key prefix for stashed OAuth state tokens. */
const STATE_KEY_PREFIX = "github-oauth-state:";

/** KV key prefix for per-user stored GitHub tokens. */
const TOKEN_KEY_PREFIX = "github-token:";

/** GitHub OAuth endpoints. */
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_USER_AGENT = "slide-of-hand-agent/1.0";

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

export interface StoredGitHubToken {
  /** OAuth access token. Bearer-format. Never returned to the client. */
  token: string;
  /** GitHub username (`login` field). Surfaced in the UI. */
  username: string;
  /** GitHub user ID (numeric). Useful for stable identity if the user renames. */
  userId: number;
  /** Granted scopes (CSV from GitHub's `X-OAuth-Scopes` header, parsed). */
  scopes: string[];
  /** Epoch milliseconds when this token was stored. */
  connectedAt: number;
}

interface StoredState {
  email: string;
  returnTo: string;
  createdAt: number;
}

export function stateKey(state: string): string {
  return `${STATE_KEY_PREFIX}${state}`;
}

export function tokenKey(email: string): string {
  return `${TOKEN_KEY_PREFIX}${email}`;
}

/**
 * Generate a cryptographically random state token. Used to bind the
 * OAuth round-trip to a specific browser session and prevent CSRF.
 */
export function generateState(): string {
  // `crypto.randomUUID()` returns a v4 UUID, which is 122 bits of
  // entropy — plenty for a single-use 10-minute-TTL state token.
  // workers-best-practices forbids `Math.random()` here.
  return crypto.randomUUID();
}

/**
 * Fetch a stored GitHub token for the given Access user email.
 * Returns `null` if the user hasn't connected GitHub. Surface via
 * other modules (phase 3 `commitPatch`).
 */
export async function getStoredGitHubToken(
  env: Pick<GitHubOAuthEnv, "GITHUB_TOKENS">,
  email: string,
): Promise<StoredGitHubToken | null> {
  const raw = await env.GITHUB_TOKENS.get(tokenKey(email));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredGitHubToken;
  } catch {
    // Malformed record. Treat as not-connected; the user can
    // reconnect via Settings.
    return null;
  }
}

/**
 * Main entry. Returns a `Response` if this handler owns the request,
 * or `null` if the path doesn't match (so the composing `fetch`
 * handler can fall through to the next route module).
 */
export async function handleGitHubOAuth(
  request: Request,
  env: GitHubOAuthEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PATH_PREFIX)) return null;

  // Every OAuth route is Access-gated. The OAuth flow runs in a
  // browser context, so the user's CF_Authorization cookie travels
  // with the GitHub-driven redirect back to us and Access populates
  // the email header. Service-token callers have no email and can't
  // initiate a per-user OAuth flow.
  const denied = requireAccessAuth(request);
  if (denied) return denied;

  switch (url.pathname) {
    case START_PATH:
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return handleStart(url, request, env);
    case CALLBACK_PATH:
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return handleCallback(url, request, env);
    case STATUS_PATH:
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return handleStatus(request, env);
    case DISCONNECT_PATH:
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      return handleDisconnect(request, env);
    default:
      return new Response("not found", {
        status: 404,
        headers: { "content-type": "text/plain", "cache-control": "no-store" },
      });
  }
}

function methodNotAllowed(allowed: readonly string[]): Response {
  return new Response("method not allowed", {
    status: 405,
    headers: { allow: allowed.join(", "), ...JSON_HEADERS },
  });
}

async function handleStart(
  url: URL,
  request: Request,
  env: GitHubOAuthEnv,
): Promise<Response> {
  const email = getAccessUserEmail(request);
  if (!email) {
    // Service tokens have no user identity and can't initiate a
    // per-user OAuth flow. (We could route them through a shared
    // service-account flow in the future, but that's out of scope
    // for v1.)
    return new Response(
      JSON.stringify({
        error:
          "OAuth flow requires an interactive user — service-token auth has no email to associate with a GitHub account",
      }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // The SPA passes `?returnTo=/admin/decks/<slug>?edit=1` (URL-encoded)
  // so we can bounce the user back to where they were after the
  // round-trip. Default to `/admin` if absent. Only accept same-origin
  // paths (relative URLs starting with `/`) — never let an OAuth flow
  // redirect the user off-site, which would be a phishing vector.
  const requestedReturnTo = url.searchParams.get("returnTo");
  const returnTo = sanitiseReturnTo(requestedReturnTo);

  const state = generateState();
  const stored: StoredState = {
    email,
    returnTo,
    createdAt: Date.now(),
  };
  await env.GITHUB_TOKENS.put(stateKey(state), JSON.stringify(stored), {
    expirationTtl: STATE_TTL_SECONDS,
  });

  // Build the GitHub OAuth authorize URL.
  const authorize = new URL(GITHUB_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", buildCallbackUrl(url));
  authorize.searchParams.set("scope", OAUTH_SCOPE);
  authorize.searchParams.set("state", state);
  // `allow_signup=false` keeps the page slimmer — most admins already
  // have GitHub accounts.
  authorize.searchParams.set("allow_signup", "false");

  return Response.redirect(authorize.toString(), 302);
}

async function handleCallback(
  url: URL,
  request: Request,
  env: GitHubOAuthEnv,
): Promise<Response> {
  const email = getAccessUserEmail(request);
  if (!email) {
    return new Response(
      JSON.stringify({ error: "callback requires interactive auth" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // GitHub returns either `?code=&state=` on success, or
  // `?error=&error_description=&state=` on user denial.
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const ghError = url.searchParams.get("error");

  if (!state) {
    return new Response(
      JSON.stringify({ error: "missing state — OAuth flow corrupted" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // Always consume the state token, even on error paths, so the
  // single-use invariant holds.
  const storedStateRaw = await env.GITHUB_TOKENS.get(stateKey(state));
  await env.GITHUB_TOKENS.delete(stateKey(state));

  if (!storedStateRaw) {
    return new Response(
      JSON.stringify({
        error:
          "state expired or invalid — OAuth state tokens are single-use and live for 10 minutes; please retry from Settings",
      }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  let storedState: StoredState;
  try {
    storedState = JSON.parse(storedStateRaw) as StoredState;
  } catch {
    return new Response(
      JSON.stringify({ error: "malformed state record" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // The user who started the flow must be the user who finishes it.
  // Without this check, an attacker could trick a different user
  // into completing an OAuth flow initiated by the attacker.
  if (storedState.email !== email) {
    return new Response(
      JSON.stringify({
        error:
          "state was issued for a different user — please restart the OAuth flow from your own Settings",
      }),
      { status: 403, headers: JSON_HEADERS },
    );
  }

  if (ghError) {
    // User denied authorization (or GitHub returned some other error).
    // Send them back to `returnTo` with a flag so the SPA can show
    // a "connection cancelled" toast. We don't leak the underlying
    // error to the URL since GitHub's error messages can be noisy.
    const redirect = new URL(storedState.returnTo, url.origin);
    redirect.searchParams.set("github_oauth", "denied");
    return Response.redirect(redirect.toString(), 302);
  }

  if (!code) {
    return new Response(
      JSON.stringify({ error: "missing code — OAuth flow corrupted" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // Server-to-server exchange of code for access token.
  let tokenResp: Response;
  try {
    tokenResp = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": GITHUB_USER_AGENT,
      },
      body: JSON.stringify({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
        redirect_uri: buildCallbackUrl(url),
      }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: `network error contacting GitHub: ${err instanceof Error ? err.message : String(err)}`,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (!tokenResp.ok) {
    return new Response(
      JSON.stringify({
        error: `GitHub token exchange failed (${tokenResp.status})`,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const tokenJson = (await tokenResp.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (tokenJson.error || !tokenJson.access_token) {
    return new Response(
      JSON.stringify({
        error:
          tokenJson.error_description ||
          tokenJson.error ||
          "GitHub returned no access token",
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const accessToken = tokenJson.access_token;
  const scopes = (tokenJson.scope ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Fetch the GitHub username so we can surface it in the UI ("Connected as @username").
  let userResp: Response;
  try {
    userResp = await fetch(GITHUB_USER_URL, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": GITHUB_USER_AGENT,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: `network error fetching GitHub user: ${err instanceof Error ? err.message : String(err)}`,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (!userResp.ok) {
    return new Response(
      JSON.stringify({
        error: `GitHub /user lookup failed (${userResp.status})`,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const userJson = (await userResp.json()) as {
    login?: string;
    id?: number;
  };

  if (!userJson.login || typeof userJson.id !== "number") {
    return new Response(
      JSON.stringify({ error: "GitHub /user response missing login/id" }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const stored: StoredGitHubToken = {
    token: accessToken,
    username: userJson.login,
    userId: userJson.id,
    scopes,
    connectedAt: Date.now(),
  };
  await env.GITHUB_TOKENS.put(tokenKey(email), JSON.stringify(stored));

  // Redirect back to the original surface so the user lands where
  // they started, with a query flag so the SPA can show a "Connected!"
  // toast.
  const redirect = new URL(storedState.returnTo, url.origin);
  redirect.searchParams.set("github_oauth", "connected");
  return Response.redirect(redirect.toString(), 302);
}

async function handleStatus(
  request: Request,
  env: GitHubOAuthEnv,
): Promise<Response> {
  const email = getAccessUserEmail(request);
  if (!email) {
    // Service token. No per-user GitHub identity to look up.
    return new Response(JSON.stringify({ connected: false }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  const stored = await getStoredGitHubToken(env, email);
  if (!stored) {
    return new Response(JSON.stringify({ connected: false }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  return new Response(
    JSON.stringify({
      connected: true,
      username: stored.username,
      userId: stored.userId,
      scopes: stored.scopes,
      connectedAt: stored.connectedAt,
    }),
    { status: 200, headers: JSON_HEADERS },
  );
}

async function handleDisconnect(
  request: Request,
  env: GitHubOAuthEnv,
): Promise<Response> {
  const email = getAccessUserEmail(request);
  if (!email) {
    return new Response(
      JSON.stringify({ error: "disconnect requires interactive auth" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // Just remove our stored copy. We don't attempt to call GitHub's
  // OAuth-app-revoke endpoint here because that requires the app's
  // Basic-auth client_id/client_secret pair and adds a network
  // dependency to the disconnect flow. The user can revoke from
  // <https://github.com/settings/applications> if they want a
  // server-side revoke too. v1 trade-off: cheap, local, deterministic.
  await env.GITHUB_TOKENS.delete(tokenKey(email));

  return new Response(JSON.stringify({ disconnected: true }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

/**
 * Build the absolute callback URL from the request URL's origin.
 * Worker requests carry the actual hostname (`slideofhand.lusostreams.com`),
 * which must match what's registered on the GitHub OAuth App.
 */
function buildCallbackUrl(url: URL): string {
  return new URL(CALLBACK_PATH, url.origin).toString();
}

/**
 * Sanitise the `returnTo` query parameter. Only allow same-origin
 * relative paths (starting with `/` and not `//`). Reject anything
 * that could redirect off-site after the OAuth flow completes —
 * open-redirect bugs in OAuth flows are a classic phishing vector.
 */
export function sanitiseReturnTo(raw: string | null): string {
  if (!raw) return "/admin";
  // Decode in case the SPA URL-encoded it.
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return "/admin";
  }
  if (!value.startsWith("/")) return "/admin";
  // `//host` and `/\host` are protocol-relative URLs that browsers
  // interpret as off-site. Block them.
  if (value.startsWith("//") || value.startsWith("/\\")) return "/admin";
  // Trim to a reasonable length to avoid stuffing weird payloads in.
  return value.slice(0, 2000);
}
