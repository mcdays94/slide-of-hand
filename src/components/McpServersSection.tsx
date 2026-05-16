/**
 * `<McpServersSection>` — the Settings-modal subsection that lets an
 * admin add / remove / probe per-user MCP servers (issue #168 Wave 6).
 *
 * Mounts inside the admin-gated block of `<SettingsModal>` alongside
 * `<GitHubConnectRow>`. Surfaces:
 *
 *   - The current list of configured servers (one card per).
 *   - A health badge per card — clicking the badge runs a fresh
 *     probe against the server's `tools/list`.
 *   - A "Remove" button per card.
 *   - An "Add server" expandable form with name + URL + optional
 *     bearer token + optional headers.
 *
 * Out of scope for v1: editing existing servers (delete + re-add
 * instead), toggling enabled/disabled (always-enabled for now), and
 * surfacing live probe results without a manual click. Follow-ups
 * can layer those on without changing the public shape.
 *
 * Bearer tokens are NEVER read back from the server — the list
 * endpoint returns only a `hasBearerToken` boolean. The Add form's
 * token field is write-only.
 */
import { useState } from "react";
import { useMcpServers, type McpServerInput, type McpHealthResult } from "@/lib/use-mcp-servers";

interface McpServersSectionProps {
  /** Optional override for tests + Playwright snaps. */
  testId?: string;
}

interface AddFormState {
  open: boolean;
  name: string;
  url: string;
  bearerToken: string;
  submitting: boolean;
  error: string | null;
}

const initialFormState: AddFormState = {
  open: false,
  name: "",
  url: "",
  bearerToken: "",
  submitting: false,
  error: null,
};

export function McpServersSection({
  testId = "settings-modal-mcp-servers",
}: McpServersSectionProps) {
  const mcp = useMcpServers();
  const [form, setForm] = useState<AddFormState>(initialFormState);
  const [healthById, setHealthById] = useState<
    Record<string, McpHealthResult | "probing">
  >({});
  const [oauthById, setOauthById] = useState<Record<string, "starting">>({});

  function resetForm() {
    setForm(initialFormState);
  }

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.submitting) return;

    const input: McpServerInput = {
      name: form.name.trim(),
      url: form.url.trim(),
    };
    if (form.bearerToken.trim().length > 0) {
      input.bearerToken = form.bearerToken.trim();
    }

    if (!input.name) {
      setForm((s) => ({ ...s, error: "Name is required." }));
      return;
    }
    if (!input.url) {
      setForm((s) => ({ ...s, error: "URL is required." }));
      return;
    }
    try {
      new URL(input.url);
    } catch {
      setForm((s) => ({ ...s, error: "URL is not a valid URL." }));
      return;
    }

    setForm((s) => ({ ...s, submitting: true, error: null }));
    const result = await mcp.addServer(input);
    if (!result.ok) {
      setForm((s) => ({
        ...s,
        submitting: false,
        error: result.error ?? "Failed to add server.",
      }));
      return;
    }
    resetForm();
  }

  async function handleProbe(id: string) {
    setHealthById((prev) => ({ ...prev, [id]: "probing" }));
    const result = await mcp.probeHealth(id);
    setHealthById((prev) => ({ ...prev, [id]: result }));
  }

  async function handleStartOAuth(id: string) {
    setOauthById((prev) => ({ ...prev, [id]: "starting" }));
    const result = await mcp.startOAuth(id);
    setOauthById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (!result.ok || !result.authUrl) {
      setHealthById((prev) => ({
        ...prev,
        [id]: { ok: false, error: result.error ?? "Could not start OAuth." },
      }));
      return;
    }
    window.open(result.authUrl, "_blank", "noopener,noreferrer");
  }

  async function handleDelete(id: string) {
    const result = await mcp.deleteServer(id);
    if (!result.ok) {
      // Keep things minimal in this v1 — surface the error via
      // the section-level error display (rare, expected to be 503
      // or a stale id).
      // eslint-disable-next-line no-console
      console.warn(`Failed to delete MCP server ${id}: ${result.error}`);
    } else {
      setHealthById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  return (
    <div className="py-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-cf-text">MCP servers</p>
          <p className="mt-1 text-xs text-cf-text-muted">
            External tool providers (Model Context Protocol) the in-Studio AI
            assistant can call alongside its built-in tools. Each server's
            tools are namespaced as <code>mcp__&lt;id&gt;__&lt;tool&gt;</code>{" "}
            so they can't collide with built-ins. Only Streamable HTTP
            transport is supported in v1.
          </p>
        </div>
      </div>

      {mcp.error && (
        <p
          className="mt-3 rounded border border-cf-orange/40 bg-cf-orange/5 px-3 py-2 text-xs text-cf-orange"
          data-testid={`${testId}-error`}
        >
          {mcp.error}
        </p>
      )}

      {!mcp.isLoading && mcp.servers.length === 0 && !mcp.error && (
        <p
          className="mt-3 text-xs italic text-cf-text-muted"
          data-testid={`${testId}-empty`}
        >
          No MCP servers configured yet.
        </p>
      )}

      {mcp.servers.length > 0 && (
        <ul
          className="mt-3 space-y-2"
          data-testid={`${testId}-list`}
        >
          {mcp.servers.map((server) => {
            const health = healthById[server.id];
            return (
              <li
                key={server.id}
                className="rounded border border-cf-border bg-cf-bg-50 px-3 py-2"
                data-testid={`${testId}-row-${server.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-cf-text">
                      {server.name}
                    </p>
                    <p
                      className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-cf-text-muted"
                      title={server.url}
                    >
                      {server.url}
                    </p>
                    {server.hasBearerToken && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded border border-cf-border bg-cf-bg-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-cf-text-muted">
                        <span aria-hidden="true">🔒</span>
                        <span>Bearer token configured</span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {health && health !== "probing" && (
                      <HealthBadge
                        result={health}
                        testId={`${testId}-row-${server.id}-health`}
                      />
                    )}
                    {health &&
                      health !== "probing" &&
                      health.oauthRequired && (
                        <button
                          type="button"
                          onClick={() => void handleStartOAuth(server.id)}
                          className="rounded border border-cf-orange/40 bg-cf-orange/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-orange hover:border-dashed"
                          data-testid={`${testId}-row-${server.id}-oauth`}
                          data-interactive
                          disabled={oauthById[server.id] === "starting"}
                        >
                          {oauthById[server.id] === "starting"
                            ? "Opening..."
                            : "Connect"}
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => void handleProbe(server.id)}
                      className="rounded border border-cf-border bg-cf-bg-100 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-text hover:border-dashed"
                      data-testid={`${testId}-row-${server.id}-probe`}
                      data-interactive
                      disabled={health === "probing"}
                    >
                      {health === "probing" ? "..." : "Probe"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(server.id)}
                      className="rounded border border-cf-border bg-cf-bg-100 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-text hover:border-dashed"
                      data-testid={`${testId}-row-${server.id}-delete`}
                      data-interactive
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!form.open ? (
        <button
          type="button"
          onClick={() => setForm({ ...initialFormState, open: true })}
          className="mt-3 rounded border border-cf-border bg-cf-bg-100 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-text hover:border-dashed"
          data-testid={`${testId}-add-button`}
          data-interactive
        >
          + Add server
        </button>
      ) : (
        <form
          onSubmit={(e) => void handleAdd(e)}
          className="mt-3 space-y-2 rounded border border-cf-border bg-cf-bg-50 p-3"
          data-testid={`${testId}-add-form`}
          data-no-advance
        >
          <label className="block text-xs font-medium text-cf-text">
            <span>Name</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) =>
                setForm((s) => ({ ...s, name: e.target.value, error: null }))
              }
              required
              maxLength={100}
              placeholder="e.g. Internal docs"
              className="mt-1 block w-full rounded border border-cf-border bg-cf-bg-100 px-2 py-1 text-sm text-cf-text focus:border-cf-orange focus:outline-none"
              data-testid={`${testId}-add-form-name`}
              data-interactive
            />
          </label>

          <label className="block text-xs font-medium text-cf-text">
            <span>Streamable HTTP URL</span>
            <input
              type="url"
              value={form.url}
              onChange={(e) =>
                setForm((s) => ({ ...s, url: e.target.value, error: null }))
              }
              required
              placeholder="https://mcp.example.com"
              className="mt-1 block w-full rounded border border-cf-border bg-cf-bg-100 px-2 py-1 font-mono text-xs text-cf-text focus:border-cf-orange focus:outline-none"
              data-testid={`${testId}-add-form-url`}
              data-interactive
            />
          </label>

          <label className="block text-xs font-medium text-cf-text">
            <span>Bearer token (optional)</span>
            <input
              type="password"
              value={form.bearerToken}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  bearerToken: e.target.value,
                  error: null,
                }))
              }
              placeholder="art_v1_..."
              autoComplete="off"
              className="mt-1 block w-full rounded border border-cf-border bg-cf-bg-100 px-2 py-1 font-mono text-xs text-cf-text focus:border-cf-orange focus:outline-none"
              data-testid={`${testId}-add-form-bearer`}
              data-interactive
            />
          </label>

          {form.error && (
            <p
              className="text-xs text-cf-orange"
              data-testid={`${testId}-add-form-error`}
            >
              {form.error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={form.submitting}
              className="rounded border border-cf-border bg-cf-bg-100 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-text hover:border-dashed disabled:opacity-50"
              data-testid={`${testId}-add-form-submit`}
              data-interactive
            >
              {form.submitting ? "Adding..." : "Add"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded border border-cf-border bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-text-muted hover:border-dashed hover:text-cf-text"
              data-testid={`${testId}-add-form-cancel`}
              data-interactive
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

interface HealthBadgeProps {
  result: McpHealthResult;
  testId: string;
}

function HealthBadge({ result, testId }: HealthBadgeProps) {
  if (result.ok) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-cf-orange/40 bg-cf-orange/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-orange"
        data-testid={testId}
      >
        <span aria-hidden="true">✓</span>
        <span>{result.toolCount ?? "?"} tools</span>
      </span>
    );
  }
  const message = result.oauthRequired
    ? "OAuth required"
    : (result.error ?? "Probe failed");
  const shortMessage =
    message.length > 72 ? `${message.slice(0, 69)}...` : message;
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-cf-border bg-cf-bg-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-cf-text-muted"
      data-testid={testId}
      title={result.error ?? "Probe failed"}
    >
      <span aria-hidden="true">×</span>
      <span>{shortMessage}</span>
    </span>
  );
}
