/**
 * React hook for managing the user's per-user MCP server registry
 * (issue #168 Wave 6).
 *
 * Surfaces the four operations exposed by `/api/admin/mcp-servers*`:
 *
 *   - List the user's configured servers.
 *   - Add a server.
 *   - Delete a server.
 *   - Probe a server's health on demand.
 *
 * The list response strips bearer tokens — the backend returns a
 * boolean `hasBearerToken` indicator only. The hook surfaces that
 * verbatim so the UI can render a "auth configured" badge without
 * the token ever leaving the Worker.
 *
 * Auth: uses `adminWriteHeaders()` for state-changing requests so
 * `wrangler dev` rounds-trip cleanly without real Cloudflare Access
 * in front.
 */
import { useCallback, useEffect, useState } from "react";
import { adminWriteHeaders } from "./admin-fetch";

const LIST_PATH = "/api/admin/mcp-servers";
const itemPath = (id: string) => `${LIST_PATH}/${encodeURIComponent(id)}`;
const healthPath = (id: string) =>
  `${LIST_PATH}/${encodeURIComponent(id)}/health`;
const oauthStartPath = (id: string) =>
  `${LIST_PATH}/${encodeURIComponent(id)}/oauth/start`;

export interface McpServerPublic {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  headers?: Record<string, string>;
  /** True if the backend stored a bearer token for this server. */
  hasBearerToken?: boolean;
}

export interface McpServerInput {
  name: string;
  url: string;
  bearerToken?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface McpHealthResult {
  ok: boolean;
  toolCount?: number;
  error?: string;
  oauthRequired?: boolean;
  resourceMetadataUrl?: string;
}

export interface UseMcpServersResult {
  servers: McpServerPublic[];
  /** True until the first list fetch resolves (success or failure). */
  isLoading: boolean;
  /** Last network / response error (cleared on subsequent ok responses). */
  error: string | null;
  refetch: () => void;
  addServer: (input: McpServerInput) => Promise<{
    ok: boolean;
    server?: McpServerPublic;
    error?: string;
  }>;
  deleteServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  probeHealth: (id: string) => Promise<McpHealthResult>;
  startOAuth: (id: string) => Promise<{
    ok: boolean;
    authUrl?: string;
    error?: string;
  }>;
}

interface ListResponse {
  servers: McpServerPublic[];
}

interface AddResponse {
  server?: McpServerPublic;
  ok?: boolean;
  errors?: string[];
  error?: string;
}

export function useMcpServers(): UseMcpServersResult {
  const [servers, setServers] = useState<McpServerPublic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    let canceled = false;
    async function go() {
      try {
        setError(null);
        const res = await fetch(LIST_PATH, {
          method: "GET",
          credentials: "include",
          headers: adminWriteHeaders(),
        });
        if (canceled) return;
        if (!res.ok) {
          // 503 = binding missing; 403 = auth issue; 5xx = backend.
          // Surface the response body's error if available.
          let message = `Failed to load MCP servers (HTTP ${res.status})`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) message = body.error;
          } catch {
            // body wasn't JSON — keep the generic message.
          }
          setError(message);
          setServers([]);
          return;
        }
        const body = (await res.json()) as ListResponse;
        setServers(Array.isArray(body.servers) ? body.servers : []);
      } catch (err) {
        if (canceled) return;
        setError(err instanceof Error ? err.message : String(err));
        setServers([]);
      } finally {
        if (!canceled) setIsLoading(false);
      }
    }
    void go();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const cleanup = refetch();
    return cleanup;
  }, [refetch]);

  const addServer = useCallback(
    async (
      input: McpServerInput,
    ): Promise<{
      ok: boolean;
      server?: McpServerPublic;
      error?: string;
    }> => {
      try {
        const res = await fetch(LIST_PATH, {
          method: "POST",
          credentials: "include",
          headers: adminWriteHeaders(),
          body: JSON.stringify(input),
        });
        const body = (await res.json().catch(() => ({}))) as AddResponse;
        if (!res.ok) {
          const errMessage =
            body.error ?? body.errors?.join("; ") ?? `HTTP ${res.status}`;
          return { ok: false, error: errMessage };
        }
        if (body.server) {
          setServers((prev) => [...prev, body.server!]);
          return { ok: true, server: body.server };
        }
        return { ok: false, error: "Server returned no payload" };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [],
  );

  const deleteServer = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch(itemPath(id), {
          method: "DELETE",
          credentials: "include",
          headers: adminWriteHeaders(),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          return { ok: false, error: body.error ?? `HTTP ${res.status}` };
        }
        setServers((prev) => prev.filter((s) => s.id !== id));
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [],
  );

  const probeHealth = useCallback(
    async (id: string): Promise<McpHealthResult> => {
      try {
        const res = await fetch(healthPath(id), {
          method: "GET",
          credentials: "include",
          headers: adminWriteHeaders(),
        });
        const body = (await res.json().catch(() => ({}))) as McpHealthResult;
        if (!res.ok) {
          return {
            ok: false,
            error: body.error ?? `HTTP ${res.status}`,
          };
        }
        return body;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [],
  );

  const startOAuth = useCallback(
    async (
      id: string,
    ): Promise<{ ok: boolean; authUrl?: string; error?: string }> => {
      try {
        const res = await fetch(oauthStartPath(id), {
          method: "POST",
          credentials: "include",
          headers: adminWriteHeaders(),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          authUrl?: string;
          error?: string;
        };
        if (!res.ok || body.ok === false || !body.authUrl) {
          return { ok: false, error: body.error ?? `HTTP ${res.status}` };
        }
        return { ok: true, authUrl: body.authUrl };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [],
  );

  return {
    servers,
    isLoading,
    error,
    refetch,
    addServer,
    deleteServer,
    probeHealth,
    startOAuth,
  };
}
