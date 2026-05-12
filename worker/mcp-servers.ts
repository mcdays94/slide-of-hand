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
  kind: "collection" | "item" | "health";
  id?: string;
}

/**
 * Match the request path against our handled surface. Returns `null`
 * for non-matching paths so the main fetch chain falls through.
 */
function matchRoute(pathname: string): RouteMatch | null {
  if (pathname === ROUTE_PREFIX) return { kind: "collection" };
  if (!pathname.startsWith(`${ROUTE_PREFIX}/`)) return null;
  const tail = pathname.slice(ROUTE_PREFIX.length + 1);
  // `/<id>` or `/<id>/health`. Reject empty id segments.
  const parts = tail.split("/");
  if (parts.length === 1 && parts[0].length > 0) {
    return { kind: "item", id: parts[0] };
  }
  if (parts.length === 2 && parts[0].length > 0 && parts[1] === "health") {
    return { kind: "health", id: parts[0] };
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
  if (request.method === "GET") return handleHealth(kv, email, match.id!);
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
