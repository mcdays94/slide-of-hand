/**
 * `/api/admin/mcp-servers` — per-user MCP server registry CRUD
 * scaffolding for issue #168 Wave 6 (Worker C's full implementation
 * lands here).
 *
 * ## Status: SCAFFOLD ONLY
 *
 * `handleMcpServers` returns `null` for non-matching paths and a 501
 * for matching paths. Worker C fills in the body once `MCP_SERVERS`
 * KV is added to `wrangler.jsonc` (user-approved diff).
 *
 * ## What this module owns once filled in
 *
 * Per-user MCP server config stored in KV under
 * `mcp-servers:<userEmail>` → JSON array of:
 *
 * ```ts
 * interface McpServerConfig {
 *   id: string;                 // uuid
 *   name: string;               // user-supplied display label
 *   url: string;                // Streamable HTTP endpoint URL
 *   bearerToken?: string;       // optional auth header
 *   headers?: Record<string, string>;
 *   enabled: boolean;
 * }
 * ```
 *
 * CRUD endpoints:
 *
 *   - `GET    /api/admin/mcp-servers` — list current user's servers
 *   - `POST   /api/admin/mcp-servers` — add a server
 *   - `PATCH  /api/admin/mcp-servers/:id` — toggle / update a server
 *   - `DELETE /api/admin/mcp-servers/:id` — remove a server
 *   - `GET    /api/admin/mcp-servers/:id/health` — live probe of
 *     a server's `tools/list` to surface a green/yellow/red status
 *     in the Settings UI.
 *
 * All endpoints are Access-gated via `requireAccessAuth` and scope
 * reads/writes by the Access-issued user email. Servers added by one
 * user are never readable by another.
 *
 * ## Why per-user, not per-deck
 *
 * MCP servers are author-level tools (search the docs, search Jira,
 * fetch a URL, etc.) — they don't change between decks. Per-user
 * scoping matches the existing GitHub OAuth token pattern (`github-
 * token:<email>`) and keeps the Settings UI a single global section
 * rather than per-deck.
 *
 * ## Tool merge integration
 *
 * The actual tool merging into the agent's toolset happens in
 * `worker/agent.ts` (Worker C adds the hook in `onChatMessage` between
 * `buildTools(...)` and `streamText(...)`). The server registry CRUD
 * lives here; the run-time tool query lives in `worker/mcp-client.ts`.
 */

/**
 * Env subset the CRUD endpoints need. `MCP_SERVERS` KV is OPTIONAL on
 * the stub — Worker C makes it required when filling in the
 * implementation.
 */
export interface McpServersEnv {
  MCP_SERVERS?: KVNamespace;
}

const ROUTE_PREFIX = "/api/admin/mcp-servers";

export async function handleMcpServers(
  request: Request,
  _env: McpServersEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== ROUTE_PREFIX &&
    !url.pathname.startsWith(`${ROUTE_PREFIX}/`)
  ) {
    return null;
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error:
        "MCP server registry is not implemented yet (issue #168 Wave 6 / Worker C). " +
        "Add the MCP_SERVERS KV binding to wrangler.jsonc and fill in handleMcpServers.",
    }),
    {
      status: 501,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}
