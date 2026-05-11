/**
 * MCP tool merger — `fetchMcpTools(env, userEmail)` (issue #168 Wave 6,
 * Worker C — final missing piece before the agent.ts hook).
 *
 * ## What this module owns
 *
 * Reads the calling user's MCP server registry from KV, calls
 * `listTools` against each ENABLED server, and wraps each remote tool
 * as a runtime-typed AI SDK `dynamicTool`. The returned record is
 * suitable for direct merging into the tool set passed to
 * `streamText({ tools: { ...local, ...mcp } })` inside the agent's
 * `onChatMessage` override.
 *
 * ## Why `dynamicTool` (not `tool`)
 *
 * The schema for each MCP tool isn't known until the per-turn
 * `listTools` call returns. `tool()` is strict-typed (`INPUT` /
 * `OUTPUT` generics inferred from a Zod schema); `dynamicTool()` is
 * designed for exactly this runtime-known case. The chat UI
 * (`<StudioAgentPanel>`) already has fallback handling for the
 * `dynamic-tool` part type, so model emissions render correctly.
 *
 * ## Naming
 *
 * Each MCP tool is namespaced as `mcp__${serverId}__${toolName}` so:
 *
 *   - Two MCP servers can each expose a `search` tool without
 *     collision.
 *   - An MCP server can never collide with built-in tools (which use
 *     plain names like `readDeck`, `proposePatch`, etc.).
 *
 * The model sees the prefixed name; that's fine because tools are
 * surfaced to the model via the system prompt + the AI SDK's tool
 * metadata, both of which carry the description and the input
 * schema, so the model doesn't care about exact naming.
 *
 * ## Graceful failure
 *
 * If a server's `listTools` throws (network down, server misconfigured,
 * etc.), we log + skip it. The chat turn proceeds with the remaining
 * tools. This matches the standard "one MCP server going dark
 * shouldn't break the whole chat" UX seen in other MCP clients.
 *
 * ## User isolation
 *
 * The KV read uses `mcp-servers:<userEmail>` — only this user's
 * servers are touched. Cross-user leakage is structurally impossible
 * (we never read any other key).
 */

import { dynamicTool, jsonSchema, type Tool } from "ai";
import {
  listTools,
  callTool,
  type McpServerConfig,
} from "./mcp-client";
import type { McpServerRecord } from "./mcp-servers";

/**
 * Env subset the merger needs. `MCP_SERVERS` is OPTIONAL so the agent
 * can call this function before the binding is wired in
 * `wrangler.jsonc` — the function returns an empty record and the
 * agent continues with just its built-in tools.
 */
export interface FetchMcpToolsEnv {
  MCP_SERVERS?: KVNamespace;
}

const KV_KEY = (email: string) => `mcp-servers:${email}`;

/**
 * Compose a namespaced tool key for an MCP-sourced tool.
 *
 * Exposed so tests + the agent's tool-call dispatch logic (Worker C's
 * future hook) can use the same naming convention.
 */
export function mcpToolKey(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`;
}

/**
 * Build the merged tool record for the calling user. Always returns
 * a value (never throws); failures from individual MCP servers are
 * logged + the server is skipped.
 *
 * Cost per call: 1 KV read + 1 HTTP request per ENABLED server. For
 * the agent's chat-turn flow this is called once per turn — so an
 * unresponsive MCP server adds at most the `mcp-client` probe
 * timeout (`DEFAULT_PROBE_TIMEOUT_MS = 5s`) to chat latency, since
 * `listTools` shares the same fetch + AbortSignal pattern as
 * `probeHealth`. Worker C's hook can wrap the call in a tighter
 * timeout if that proves too slow in practice.
 */
export async function fetchMcpTools(
  env: FetchMcpToolsEnv,
  userEmail: string,
): Promise<Record<string, Tool>> {
  if (!env.MCP_SERVERS) return {};

  const stored = await env.MCP_SERVERS.get(KV_KEY(userEmail), "json");
  if (!stored || !Array.isArray(stored)) return {};
  const servers = stored as McpServerRecord[];

  const result: Record<string, Tool> = {};

  for (const server of servers) {
    if (!server.enabled) continue;

    const config: McpServerConfig = {
      url: server.url,
      ...(server.bearerToken ? { bearerToken: server.bearerToken } : {}),
      ...(server.headers ? { headers: server.headers } : {}),
    };

    let mcpTools;
    try {
      mcpTools = await listTools(config);
    } catch (err) {
      // Don't crash the whole chat turn. Other servers may still
      // succeed, and built-in tools continue to work regardless.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mcp-tools] Failed to list tools from server "${server.name}" (${server.url}): ${message}`,
      );
      continue;
    }

    for (const mcpTool of mcpTools) {
      const key = mcpToolKey(server.id, mcpTool.name);
      result[key] = dynamicTool({
        description: mcpTool.description,
        inputSchema: jsonSchema(
          mcpTool.inputSchema as Parameters<typeof jsonSchema>[0],
        ),
        execute: async (args) => {
          return callTool(config, mcpTool.name, args);
        },
      });
    }
  }

  return result;
}
