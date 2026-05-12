/**
 * Streamable HTTP MCP client — issue #168 Wave 6 (Worker C).
 *
 * Speaks the JSON-RPC 2.0 subset of MCP needed for the in-Studio
 * agent's tool merge flow:
 *
 *   - `tools/list` — fetch a server's tool catalogue.
 *   - `tools/call` — invoke a specific tool with arguments.
 *
 * Plus a `probeHealth` helper that wraps `tools/list` for the
 * Settings UI's per-server status badge.
 *
 * ## Why pure JSON, not SSE
 *
 * The MCP Streamable HTTP spec lets servers reply with either a single
 * JSON response or open a Server-Sent Events stream for long-running
 * tool calls. For the agent's chat-turn flow we don't need streaming
 * inside the MCP call itself — the agent's overall response is already
 * streamed via the AI SDK, and each MCP tool call inside that stream
 * is a one-shot. Restricting to JSON keeps the client simple and
 * dependency-free.
 *
 * If a server insists on SSE (sets `Content-Type: text/event-stream`
 * on the response), the client throws — that's a v2 feature.
 *
 * ## Auth
 *
 * Optional `bearerToken` from the user's per-server KV config. Sent
 * as `Authorization: Bearer <token>`. Servers that don't require auth
 * (e.g. local dev MCP servers) just omit the field.
 *
 * Extra headers can be sent via `config.headers` — useful for tracing
 * or custom routing tokens that aren't bearer-style.
 *
 * ## Trust model
 *
 * MCP servers configured by the user can be anywhere on the public
 * internet. The Worker fetches them outbound; no inbound exposure.
 * Each user only sees their own configured servers (see
 * `worker/mcp-servers.ts` for the per-user KV scoping).
 *
 * Servers may return ANY JSON they like as a `tools/call` result. The
 * client does NOT validate the shape beyond "valid JSON-RPC 2.0 with
 * a `result` field." Callers downstream of this client (the agent's
 * tool merge hook in `worker/agent.ts`) are responsible for further
 * shape validation before passing results back to the model.
 */

export interface McpServerConfig {
  /** Streamable HTTP endpoint URL. */
  url: string;
  /** Optional bearer token sent as `Authorization: Bearer <token>`. */
  bearerToken?: string;
  /** Additional headers to send on every request. */
  headers?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: P;
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: R;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcError;

interface ListToolsResult {
  tools: McpTool[];
  /** Optional cursor for pagination — v1 client ignores it. */
  nextCursor?: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * Type guard for the error variant of a JSON-RPC response.
 */
export function isJsonRpcError(value: unknown): value is JsonRpcError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as { jsonrpc?: unknown; error?: unknown };
  if (obj.jsonrpc !== "2.0") return false;
  if (!obj.error || typeof obj.error !== "object") return false;
  const err = obj.error as { code?: unknown; message?: unknown };
  return typeof err.code === "number" && typeof err.message === "string";
}

/**
 * Custom error class that carries the JSON-RPC error fields for
 * downstream consumers that want to do code-based dispatch.
 */
export class McpError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "McpError";
  }
}

/**
 * Generate a per-request id. Crypto-random when available; falls back
 * to a counter that hashes the time so collisions don't matter for
 * the protocol's correlation semantics (we only ever send one
 * request per round-trip — the id is just for spec compliance).
 */
let idCounter = 0;
function nextRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  idCounter += 1;
  return `req-${Date.now()}-${idCounter}`;
}

/**
 * Send a JSON-RPC request. Internal helper used by `listTools` and
 * `callTool`. Throws `McpError` on JSON-RPC error responses and a
 * generic `Error` on transport-level failures.
 */
async function sendJsonRpc<P, R>(
  config: McpServerConfig,
  method: string,
  params: P | undefined,
  options: { signal?: AbortSignal } = {},
): Promise<R> {
  const body: JsonRpcRequest<P> = {
    jsonrpc: "2.0",
    id: nextRequestId(),
    method,
    ...(params !== undefined ? { params } : {}),
  };

  const headers = new Headers(config.headers ?? {});
  headers.set("content-type", "application/json");
  // Streamable HTTP spec — advertise both JSON and SSE so servers
  // that prefer streaming know we're a willing party. We only handle
  // JSON responses in v1; SSE responses will be rejected below.
  headers.set("accept", "application/json, text/event-stream");
  if (config.bearerToken) {
    headers.set("authorization", `Bearer ${config.bearerToken}`);
  }

  const init: RequestInit = {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  };
  if (options.signal) {
    init.signal = options.signal;
  }

  const response = await fetch(config.url, init);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `MCP server ${config.url} returned ${response.status}: ${
        text || response.statusText
      }`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (contentType.includes("text/event-stream")) {
      throw new Error(
        `MCP server ${config.url} returned an SSE stream; ` +
          "the v1 client only handles single-JSON responses.",
      );
    }
    throw new Error(
      `MCP server ${config.url} returned unexpected content-type ${contentType}; ` +
        "expected application/json.",
    );
  }

  const parsed = (await response.json()) as JsonRpcResponse<R>;

  if (isJsonRpcError(parsed)) {
    throw new McpError(parsed.error.message, parsed.error.code, parsed.error.data);
  }

  if (!("result" in parsed)) {
    throw new Error(
      `MCP server ${config.url} returned a response with neither result nor error.`,
    );
  }

  return parsed.result as R;
}

/**
 * Fetch a server's tool catalogue. The returned array is suitable for
 * direct merging into the AI SDK's `ToolSet` shape — the agent's tool
 * merge hook in `worker/agent.ts` wraps each entry with the SDK's
 * `tool()` helper.
 */
export async function listTools(
  config: McpServerConfig,
  options: { signal?: AbortSignal } = {},
): Promise<McpTool[]> {
  const result = await sendJsonRpc<undefined, ListToolsResult>(
    config,
    "tools/list",
    undefined,
    options,
  );
  return result.tools;
}

/**
 * Invoke a tool by name. Returns the full result object from the
 * server (typically `{ content: [{ type, text|json|... }, ...] }`).
 * Downstream callers shape this into the AI SDK's tool-result format.
 */
export async function callTool(
  config: McpServerConfig,
  name: string,
  args: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<unknown> {
  return sendJsonRpc<{ name: string; arguments: unknown }, unknown>(
    config,
    "tools/call",
    { name, arguments: args },
    options,
  );
}

export type ProbeHealthResult =
  | { ok: true; toolCount: number }
  | { ok: false; error: string };

/**
 * Probe an MCP server by attempting `tools/list`. Wraps the call in
 * a tight timeout (`DEFAULT_PROBE_TIMEOUT_MS`) so a misbehaving
 * server can't stall the Settings UI. Never throws — always returns
 * a discriminated-union result.
 *
 * The `callerSignal` option lets a long-lived UI cancel the probe
 * early (e.g. when the modal is closed). Internally the helper makes
 * its own AbortController for the timeout; if both signals fire, the
 * one that fires first wins.
 */
export async function probeHealth(
  config: McpServerConfig,
  options: {
    callerSignal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<ProbeHealthResult> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Propagate caller-signal aborts into the local controller.
  let cleanupCallerSignal: (() => void) | undefined;
  if (options.callerSignal) {
    if (options.callerSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      options.callerSignal.addEventListener("abort", onAbort);
      cleanupCallerSignal = () =>
        options.callerSignal?.removeEventListener("abort", onAbort);
    }
  }

  try {
    const tools = await listTools(config, { signal: controller.signal });
    return { ok: true, toolCount: tools.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
    cleanupCallerSignal?.();
  }
}
