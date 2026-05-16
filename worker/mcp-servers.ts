/**
 * `/api/admin/mcp-servers` — per-user MCP server registry CRUD
 * (issue #168 Wave 6 / Worker C).
 *
 * ## What this module owns
 *
 * Per-user MCP server config stored in KV under
 * `mcp-servers:<userEmail>` → JSON array of `McpServerRecord`. CRUD
 * endpoints:
 *
 *   - `GET    /api/admin/mcp-servers` — list current user's servers
 *   - `POST   /api/admin/mcp-servers` — add a server
 *   - `PATCH  /api/admin/mcp-servers/:id` — toggle / update a server
 *   - `DELETE /api/admin/mcp-servers/:id` — remove a server
 *   - `GET    /api/admin/mcp-servers/:id/health` — live probe of
 *     a server's `tools/list` for the Settings UI's status badge
 *
 * All endpoints are Access-gated via `requireAccessAuth` and scope
 * reads/writes by the Access-issued user email. Servers added by one
 * user are NEVER readable by another — the KV key is the user's
 * email, and the handler never reads any other key per request.
 *
 * ## Binding gate
 *
 * `MCP_SERVERS` is declared optional on `McpServersEnv` so the Worker
 * compiles + tests pass before the binding lands in `wrangler.jsonc`.
 * Until the binding is wired, every CRUD call returns 503 with a
 * clear "binding missing" message. The user adds the binding then
 * the endpoints start working.
 *
 * ## Why per-user, not per-deck
 *
 * MCP servers are author-level tools (search docs, search Jira, fetch
 * URLs, etc.) — they don't change between decks. Per-user scoping
 * matches the existing GitHub OAuth token pattern (`github-token:<email>`)
 * and keeps the Settings UI a single global section rather than
 * per-deck.
 *
 * ## Bearer-token handling
 *
 * `bearerToken` is stored verbatim in KV but NEVER returned in
 * responses. Instead the list/get responses include a boolean
 * `hasBearerToken` so the UI can render a "configured" indicator.
 * Updating a server preserves the existing token unless the request
 * explicitly sends a new one.
 *
 * ## Tool merge integration
 *
 * The actual tool merging into the agent's toolset happens elsewhere
 * (Worker C's follow-up commit adds `worker/mcp-tools.ts` +
 * `fetchMcpTools(env, email)` and a hook in `worker/agent.ts
 * onChatMessage`). The server registry CRUD lives here; the run-time
 * tool query lives in `worker/mcp-client.ts`; the merger lives in the
 * yet-to-be-written `worker/mcp-tools.ts`.
 */

import { requireAccessAuth, getAccessUserEmail } from "./access-auth";
import { probeHealth } from "./mcp-client";

/**
 * Env subset. `MCP_SERVERS` is OPTIONAL so dev / preview deploys that
 * predate the binding work fail gracefully (503) rather than crash.
 */
export interface McpServersEnv {
  MCP_SERVERS?: KVNamespace;
}

/**
 * Storage record — what lives in KV. Carries the full config
 * including the bearer token. Never escapes this module's public API
 * untouched; `toPublicRecord(record)` strips the token before
 * returning to clients.
 */
export interface McpServerRecord {
  id: string;
  name: string;
  url: string;
  bearerToken?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

/**
 * Public record — what clients see. Bearer token is replaced with a
 * boolean indicator so the UI can render a "configured" state without
 * the token leaving the Worker.
 */
export interface McpServerPublic {
  id: string;
  name: string;
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
  hasBearerToken?: boolean;
}

const ROUTE_PREFIX = "/api/admin/mcp-servers";
const KV_KEY = (email: string) => `mcp-servers:${email}`;
const OAUTH_STATE_KEY = (state: string) => `mcp-oauth-state:${state}`;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ ok: false, error: message }, status);
}

/**
 * Strip the bearer token from a stored record before emitting it to
 * the client. Preserves the boolean `hasBearerToken` so the UI can
 * render a "configured" indicator.
 */
function toPublicRecord(record: McpServerRecord): McpServerPublic {
  const publicRecord: McpServerPublic = {
    id: record.id,
    name: record.name,
    url: record.url,
    enabled: record.enabled,
  };
  if (record.headers) publicRecord.headers = record.headers;
  if (record.bearerToken && record.bearerToken.length > 0) {
    publicRecord.hasBearerToken = true;
  }
  return publicRecord;
}

async function readServers(
  kv: KVNamespace,
  email: string,
): Promise<McpServerRecord[]> {
  const stored = await kv.get(KV_KEY(email), "json");
  if (!stored) return [];
  if (!Array.isArray(stored)) return [];
  return stored as McpServerRecord[];
}

async function writeServers(
  kv: KVNamespace,
  email: string,
  records: McpServerRecord[],
): Promise<void> {
  await kv.put(KV_KEY(email), JSON.stringify(records));
}

/**
 * Parse-with-validation for an unknown JSON body coming in on
 * POST/PATCH. Returns either the validated subset or a list of
 * human-readable error messages.
 */
function validateBody(
  body: unknown,
  partial: boolean = false,
):
  | {
      ok: true;
      value: Partial<Omit<McpServerRecord, "id">>;
    }
  | { ok: false; errors: string[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }
  const errors: string[] = [];
  const out: Partial<Omit<McpServerRecord, "id">> = {};
  const obj = body as Record<string, unknown>;

  // name
  if ("name" in obj) {
    if (typeof obj.name !== "string" || obj.name.trim() === "") {
      errors.push("`name` must be a non-empty string.");
    } else if (obj.name.length > 100) {
      errors.push("`name` must be at most 100 characters.");
    } else {
      out.name = obj.name.trim();
    }
  } else if (!partial) {
    errors.push("`name` is required.");
  }

  // url — must parse via the URL constructor
  if ("url" in obj) {
    if (typeof obj.url !== "string") {
      errors.push("`url` must be a string.");
    } else {
      try {
        new URL(obj.url);
        out.url = obj.url;
      } catch {
        errors.push("`url` must be a valid URL.");
      }
    }
  } else if (!partial) {
    errors.push("`url` is required.");
  }

  // bearerToken — optional string
  if ("bearerToken" in obj) {
    if (obj.bearerToken === null || obj.bearerToken === "") {
      // null / empty = clear the token
      out.bearerToken = undefined;
    } else if (typeof obj.bearerToken !== "string") {
      errors.push("`bearerToken` must be a string (or null to clear).");
    } else {
      out.bearerToken = obj.bearerToken;
    }
  }

  // headers — optional object of string -> string
  if ("headers" in obj) {
    if (obj.headers === null) {
      out.headers = undefined;
    } else if (
      !obj.headers ||
      typeof obj.headers !== "object" ||
      Array.isArray(obj.headers)
    ) {
      errors.push("`headers` must be an object of string -> string.");
    } else {
      const hdrs = obj.headers as Record<string, unknown>;
      const cleaned: Record<string, string> = {};
      let invalid = false;
      for (const [k, v] of Object.entries(hdrs)) {
        if (typeof v !== "string") {
          invalid = true;
          break;
        }
        cleaned[k] = v;
      }
      if (invalid) {
        errors.push("`headers` values must all be strings.");
      } else {
        out.headers = cleaned;
      }
    }
  }

  // enabled — optional boolean; defaults to true on create
  if ("enabled" in obj) {
    if (typeof obj.enabled !== "boolean") {
      errors.push("`enabled` must be a boolean.");
    } else {
      out.enabled = obj.enabled;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: out };
}

/**
 * Generate a UUID via the Workers runtime's `crypto.randomUUID()`.
 * Falls back to a time-counter-based ID if crypto is missing (won't
 * happen in production Workers but covers exotic test runtimes).
 */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `srv-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

interface RouteMatch {
  kind: "collection" | "item" | "health" | "oauthStart" | "oauthCallback";
  id?: string;
}

interface McpOAuthState {
  email: string;
  serverId: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier: string;
  redirectUri: string;
  tokenEndpoint: string;
  resource?: string;
}

interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
}

interface OAuthAuthorizationServerMetadata {
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
}

interface DynamicClientRegistrationResponse {
  client_id?: string;
  client_secret?: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * Match the request path against our handled surface. Returns `null`
 * for non-matching paths so the main fetch chain falls through.
 */
function matchRoute(pathname: string): RouteMatch | null {
  if (pathname === ROUTE_PREFIX) return { kind: "collection" };
  if (!pathname.startsWith(`${ROUTE_PREFIX}/`)) return null;
  const tail = pathname.slice(ROUTE_PREFIX.length + 1);
  if (tail === "oauth/callback") return { kind: "oauthCallback" };
  // `/<id>` or `/<id>/health`. Reject empty id segments.
  const parts = tail.split("/");
  if (parts.length === 1 && parts[0].length > 0) {
    return { kind: "item", id: parts[0] };
  }
  if (parts.length === 2 && parts[0].length > 0 && parts[1] === "health") {
    return { kind: "health", id: parts[0] };
  }
  if (
    parts.length === 3 &&
    parts[0].length > 0 &&
    parts[1] === "oauth" &&
    parts[2] === "start"
  ) {
    return { kind: "oauthStart", id: parts[0] };
  }
  return null;
}

export async function handleMcpServers(
  request: Request,
  env: McpServersEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = matchRoute(url.pathname);
  if (!match) return null;

  const denied = requireAccessAuth(request);
  if (denied) return denied;

  // The CRUD surface is per-user. Service tokens authenticated via
  // the JWT signal don't carry an email — they can't operate against
  // a per-user store. Return 401 so the caller knows auth went
  // through but user identity is missing (vs 403 which means auth
  // failed entirely).
  const email = getAccessUserEmail(request);
  if (!email) {
    return errorResponse(
      401,
      "MCP server registry requires an interactive user identity. " +
        "Service-token contexts have no user to scope the registry against.",
    );
  }

  if (!env.MCP_SERVERS) {
    return errorResponse(
      503,
      "MCP_SERVERS KV namespace is not bound. " +
        "Add `MCP_SERVERS` to wrangler.jsonc and redeploy.",
    );
  }

  const kv = env.MCP_SERVERS;

  if (match.kind === "collection") {
    if (request.method === "GET") return handleList(kv, email);
    if (request.method === "POST") return handleCreate(request, kv, email);
    return errorResponse(405, "Method not allowed");
  }

  if (match.kind === "item") {
    if (request.method === "PATCH")
      return handleUpdate(request, kv, email, match.id!);
    if (request.method === "DELETE") return handleDelete(kv, email, match.id!);
    return errorResponse(405, "Method not allowed");
  }

  // health
  if (match.kind === "health") {
    if (request.method === "GET") return handleHealth(kv, email, match.id!);
    return errorResponse(405, "Method not allowed");
  }

  if (match.kind === "oauthStart") {
    if (request.method === "POST") {
      return handleOAuthStart(request, kv, email, match.id!);
    }
    return errorResponse(405, "Method not allowed");
  }

  if (match.kind === "oauthCallback") {
    if (request.method === "GET") return handleOAuthCallback(request, kv, email);
    return errorResponse(405, "Method not allowed");
  }

  return errorResponse(405, "Method not allowed");
}

// ── Per-endpoint handlers ──────────────────────────────────────────

async function handleList(kv: KVNamespace, email: string): Promise<Response> {
  const servers = await readServers(kv, email);
  return jsonResponse({ servers: servers.map(toPublicRecord) });
}

async function handleCreate(
  request: Request,
  kv: KVNamespace,
  email: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Request body must be valid JSON.");
  }

  const validation = validateBody(body, /* partial */ false);
  if (!validation.ok) {
    return jsonResponse({ ok: false, errors: validation.errors }, 400);
  }

  const value = validation.value;
  const newRecord: McpServerRecord = {
    id: generateId(),
    name: value.name!,
    url: value.url!,
    enabled: value.enabled ?? true,
    ...(value.bearerToken ? { bearerToken: value.bearerToken } : {}),
    ...(value.headers ? { headers: value.headers } : {}),
  };

  const existing = await readServers(kv, email);
  await writeServers(kv, email, [...existing, newRecord]);

  return jsonResponse({ server: toPublicRecord(newRecord) }, 201);
}

async function handleUpdate(
  request: Request,
  kv: KVNamespace,
  email: string,
  id: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Request body must be valid JSON.");
  }

  const validation = validateBody(body, /* partial */ true);
  if (!validation.ok) {
    return jsonResponse({ ok: false, errors: validation.errors }, 400);
  }

  const existing = await readServers(kv, email);
  const idx = existing.findIndex((s) => s.id === id);
  if (idx < 0) {
    return errorResponse(404, "MCP server not found.");
  }

  const current = existing[idx];
  const updated: McpServerRecord = {
    ...current,
    ...(validation.value.name !== undefined
      ? { name: validation.value.name }
      : {}),
    ...(validation.value.url !== undefined
      ? { url: validation.value.url }
      : {}),
    ...(validation.value.enabled !== undefined
      ? { enabled: validation.value.enabled }
      : {}),
    ...(validation.value.headers !== undefined
      ? { headers: validation.value.headers }
      : {}),
  };
  // Bearer token: only update if the request explicitly addressed it.
  // (Empty / null in the body clears it via validateBody; absence
  // preserves the existing value.)
  if ("bearerToken" in validation.value) {
    if (validation.value.bearerToken === undefined) {
      delete updated.bearerToken;
    } else {
      updated.bearerToken = validation.value.bearerToken;
    }
  }

  const next = [...existing];
  next[idx] = updated;
  await writeServers(kv, email, next);

  return jsonResponse({ server: toPublicRecord(updated) });
}

async function handleDelete(
  kv: KVNamespace,
  email: string,
  id: string,
): Promise<Response> {
  const existing = await readServers(kv, email);
  const idx = existing.findIndex((s) => s.id === id);
  if (idx < 0) {
    return errorResponse(404, "MCP server not found.");
  }

  const next = existing.filter((s) => s.id !== id);
  await writeServers(kv, email, next);

  return jsonResponse({ ok: true, deleted: id });
}

async function handleHealth(
  kv: KVNamespace,
  email: string,
  id: string,
): Promise<Response> {
  const existing = await readServers(kv, email);
  const server = existing.find((s) => s.id === id);
  if (!server) {
    return errorResponse(404, "MCP server not found.");
  }

  const config = {
    url: server.url,
    ...(server.bearerToken ? { bearerToken: server.bearerToken } : {}),
    ...(server.headers ? { headers: server.headers } : {}),
  };

  const result = await probeHealth(config);
  return jsonResponse(result);
}

function oauthCallbackHtml(status: number, title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
  <body style="font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5;">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return ch;
    }
  });
}

function fallbackResourceMetadataUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}

async function fetchJsonObject<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}: ${text || res.statusText}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${url} did not return JSON.`);
  }
}

function randomBase64Url(bytes: number = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64Url(arr);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

async function handleOAuthStart(
  request: Request,
  kv: KVNamespace,
  email: string,
  id: string,
): Promise<Response> {
  const existing = await readServers(kv, email);
  const server = existing.find((s) => s.id === id);
  if (!server) return errorResponse(404, "MCP server not found.");

  const health = await probeHealth({
    url: server.url,
    ...(server.bearerToken ? { bearerToken: server.bearerToken } : {}),
    ...(server.headers ? { headers: server.headers } : {}),
  });
  if (health.ok) {
    return errorResponse(400, "MCP server is already reachable; OAuth is not required.");
  }
  if (!health.oauthRequired) {
    return errorResponse(
      400,
      health.error || "MCP server did not advertise an OAuth authorization flow.",
    );
  }

  const resourceMetadataUrl =
    health.resourceMetadataUrl ?? fallbackResourceMetadataUrl(server.url);
  let protectedResource: ProtectedResourceMetadata;
  try {
    protectedResource = await fetchJsonObject<ProtectedResourceMetadata>(
      resourceMetadataUrl,
    );
  } catch (err) {
    return errorResponse(
      502,
      err instanceof Error ? err.message : String(err),
    );
  }

  const authorizationServer = protectedResource.authorization_servers?.[0];
  if (!authorizationServer) {
    return errorResponse(
      502,
      "MCP OAuth metadata did not include an authorization server.",
    );
  }

  let authMetadata: OAuthAuthorizationServerMetadata;
  try {
    authMetadata = await fetchJsonObject<OAuthAuthorizationServerMetadata>(
      `${authorizationServer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
    );
  } catch (err) {
    return errorResponse(
      502,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (
    !authMetadata.authorization_endpoint ||
    !authMetadata.token_endpoint ||
    !authMetadata.registration_endpoint
  ) {
    return errorResponse(
      502,
      "MCP OAuth authorization server metadata is incomplete.",
    );
  }

  const redirectUri = new URL(
    `${ROUTE_PREFIX}/oauth/callback`,
    new URL(request.url).origin,
  ).toString();
  let registration: DynamicClientRegistrationResponse;
  try {
    registration = await fetchJsonObject<DynamicClientRegistrationResponse>(
      authMetadata.registration_endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Slide of Hand",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      },
    );
  } catch (err) {
    return errorResponse(
      502,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!registration.client_id) {
    return errorResponse(502, "MCP OAuth client registration returned no client_id.");
  }

  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = await codeChallengeFor(codeVerifier);
  const oauthState: McpOAuthState = {
    email,
    serverId: id,
    clientId: registration.client_id,
    ...(registration.client_secret
      ? { clientSecret: registration.client_secret }
      : {}),
    codeVerifier,
    redirectUri,
    tokenEndpoint: authMetadata.token_endpoint,
    ...(protectedResource.resource ? { resource: protectedResource.resource } : {}),
  };
  await kv.put(OAUTH_STATE_KEY(state), JSON.stringify(oauthState), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });

  const authUrl = new URL(authMetadata.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", registration.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (protectedResource.resource) {
    authUrl.searchParams.set("resource", protectedResource.resource);
  }

  return jsonResponse({ ok: true, authUrl: authUrl.toString() });
}

async function handleOAuthCallback(
  request: Request,
  kv: KVNamespace,
  email: string,
): Promise<Response> {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return oauthCallbackHtml(
      400,
      "MCP connection failed",
      url.searchParams.get("error_description") ?? error,
    );
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return oauthCallbackHtml(
      400,
      "MCP connection failed",
      "The OAuth callback was missing its state or code.",
    );
  }

  const stored = await kv.get(OAUTH_STATE_KEY(state), "json");
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return oauthCallbackHtml(
      400,
      "MCP connection expired",
      "Start the MCP connection again from Settings.",
    );
  }
  const oauthState = stored as McpOAuthState;
  if (oauthState.email !== email) {
    return oauthCallbackHtml(
      403,
      "MCP connection failed",
      "This OAuth callback belongs to a different user.",
    );
  }

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: oauthState.redirectUri,
    client_id: oauthState.clientId,
    code_verifier: oauthState.codeVerifier,
  });
  if (oauthState.clientSecret) {
    tokenBody.set("client_secret", oauthState.clientSecret);
  }
  if (oauthState.resource) tokenBody.set("resource", oauthState.resource);

  let token: OAuthTokenResponse;
  try {
    token = await fetchJsonObject<OAuthTokenResponse>(oauthState.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
  } catch (err) {
    return oauthCallbackHtml(
      502,
      "MCP connection failed",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!token.access_token) {
    return oauthCallbackHtml(
      502,
      "MCP connection failed",
      "The OAuth token endpoint returned no access token.",
    );
  }

  const existing = await readServers(kv, email);
  const idx = existing.findIndex((s) => s.id === oauthState.serverId);
  if (idx < 0) {
    return oauthCallbackHtml(
      404,
      "MCP connection failed",
      "The MCP server was removed before OAuth completed.",
    );
  }
  const next = [...existing];
  next[idx] = { ...next[idx], bearerToken: token.access_token };
  await writeServers(kv, email, next);
  await kv.delete(OAUTH_STATE_KEY(state));

  return oauthCallbackHtml(
    200,
    "MCP server connected",
    "Return to Slide of Hand and run Probe again. You can close this tab.",
  );
}
