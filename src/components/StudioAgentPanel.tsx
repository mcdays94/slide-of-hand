/**
 * `<StudioAgentPanel>` — slide-out chat panel for the in-Studio AI
 * agent (issue #131 phase 1).
 *
 * Anchored to the right edge of EditMode, this is the user-facing
 * surface for the `DeckAuthorAgent` Durable Object. It opens a
 * WebSocket via `useAgent` and renders the conversation via
 * `useAgentChat`. The agent instance is keyed by `deckSlug` — see
 * `worker/agent.ts` for why per-deck (not per-user-per-deck) for
 * phase 1.
 *
 * ## Lazy-loaded
 *
 * This module pulls in `agents/react`, `@cloudflare/ai-chat/react`,
 * `ai`, and `@ai-sdk/react`. Together they're ~300 KB minified —
 * heavy enough that the audience-side deck route should NOT pay for
 * them. EditMode mounts this component behind a `React.lazy()` +
 * `<Suspense>` boundary so the chat chunk only downloads when the
 * user actually opens the panel. Mirrors the pattern PR #134
 * established for `NotesEditor` / TipTap.
 *
 * ## URL routing
 *
 * `useAgent`'s default URL is `/agents/<class>/<name>`. We override
 * to `/api/admin/agents/...` so the Cloudflare Access app's existing
 * `/api/admin/*` rules cover the WebSocket upgrade. The server side
 * (`worker/agent.ts`) sets `routeAgentRequest`'s matching `prefix`
 * option. See that module's header for why prefix beats URL rewrite.
 *
 * ## Phase 1 scope guardrails
 *
 *   - No tool calls. The agent talks; it can't read or modify the
 *     deck. The intro message says so explicitly.
 *   - No "Apply changes" button (that's phase 2 — `proposePatch`).
 *   - No model picker (phase 4).
 *   - No markdown rendering yet. Streaming tokens render as plain
 *     text in monospace. Markdown lands when there's a deck-context
 *     phase that produces structured suggestions.
 */
import { Sparkles, X } from "lucide-react";
import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
} from "framer-motion";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { easeEntrance, easeStandard } from "@/lib/motion";
import { useSettings } from "@/framework/viewer/useSettings";

export interface StudioAgentPanelProps {
  /** Slug of the deck this conversation belongs to. */
  deckSlug: string;
  /** Called when the user dismisses the panel (Esc, X button, etc). */
  onClose: () => void;
}

/**
 * Build the dev-only auth query for `useAgent`. Returns
 * `{ "cf-access-auth-email": "dev@local" }` on a localhost host so
 * the WebSocket upgrade clears `requireAccessAuth` during
 * `wrangler dev`; returns `{}` in production where Access at the
 * edge handles auth out-of-band. See `src/lib/admin-fetch.ts` for
 * the matching pattern on the HTTP-write side.
 */
function getDevAuthQuery(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const host = window.location.hostname;
  const isLocalhost =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host.endsWith(".localhost");
  return isLocalhost ? { "cf-access-auth-email": "dev@local" } : {};
}

const panelMotion: HTMLMotionProps<"aside"> = {
  initial: { x: 40, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: 40, opacity: 0 },
  transition: { duration: 0.25, ease: easeEntrance },
};

const backdropMotion: HTMLMotionProps<"div"> = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15, ease: easeStandard },
};

export function StudioAgentPanel({ deckSlug, onClose }: StudioAgentPanelProps) {
  // Mount-time animation gating — we want the slide-in / slide-out
  // to play even though the parent renders us conditionally. So we
  // mount in "visible=true" immediately, and rely on `<AnimatePresence>`
  // around our own children for the closing animation. The parent
  // unmounts us once `onClose` resolves.
  const [visible, setVisible] = useState(true);

  // Esc closes the panel. Scoped to mount lifetime; cleaned up by
  // the effect's return so re-mounts don't leak listeners.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setVisible(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AnimatePresence
      onExitComplete={() => {
        // After the exit animation finishes, tell the parent to
        // unmount us. Without this the close animation would clip.
        if (!visible) onClose();
      }}
    >
      {visible && (
        <PanelInner
          deckSlug={deckSlug}
          onRequestClose={() => setVisible(false)}
        />
      )}
    </AnimatePresence>
  );
}

interface PanelInnerProps {
  deckSlug: string;
  onRequestClose: () => void;
}

function PanelInner({ deckSlug, onRequestClose }: PanelInnerProps) {
  // `useAgent` opens the WebSocket. Setting `prefix` here lines up
  // with `routeAgentRequest({ prefix: "api/admin/agents" })` on the
  // worker side so the WebSocket reaches our Access-gated route.
  // `name = deckSlug` is the per-deck conversation instance. See
  // worker/agent.ts header for the instance-naming rationale.
  //
  // The `query` option carries a dev-only `cf-access-auth-email`
  // param on localhost so the WebSocket upgrade can clear our
  // defense-in-depth Access check on `wrangler dev` (which doesn't
  // have real Access in front). Browsers cannot set custom headers
  // on WebSocket upgrades, so the query-string fallback is the only
  // workable path here. The worker side parses this ONLY for
  // localhost hostnames — see `worker/agent.ts`'s `handleAgent`.
  const agent = useAgent({
    agent: "DeckAuthorAgent",
    name: deckSlug,
    prefix: "api/admin/agents",
    query: getDevAuthQuery(),
  });

  // Read the user's selected AI model from settings so we can hand it
  // to the server on every chat turn (issue #131 item A). Falls back
  // to DEFAULT_SETTINGS via `useSettings`'s no-provider safety branch
  // — see `src/framework/viewer/useSettings.ts`. The server allow-list-
  // validates the value before invoking Workers AI, so it's safe to
  // forward whatever the user has selected.
  const { settings } = useSettings();

  const { messages, sendMessage, status, clearHistory } = useAgentChat({
    agent,
    // `body` is forwarded to `onChatMessage`'s `options.body` on the
    // server every turn. See `worker/agent.ts`'s
    // `resolveAiAssistantModel(options.body)` call.
    body: { model: settings.aiAssistantModel },
  });

  // Local form state — we don't use uncontrolled inputs because the
  // streaming-token UI needs to keep the input cleared after submit.
  const [input, setInput] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages. The list scrolls within
  // a fixed-height container; without this the user would have to
  // chase the latest token by hand.
  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  const isBusy = status === "submitted" || status === "streaming";

  return (
    <>
      {/* Backdrop — light dimming so the panel reads as modal-ish
          without blocking the deck preview entirely. Clicking the
          backdrop closes the panel.

          `data-no-advance` opts the backdrop out of the viewer's
          click-to-advance handler in `Deck.tsx`. Without it, clicking
          the backdrop would BOTH close the panel AND advance the
          slide in one gesture. See issue #131 item C. */}
      <motion.div
        {...backdropMotion}
        data-testid="studio-agent-backdrop"
        data-no-advance
        className="fixed inset-0 z-40 bg-cf-text/10"
        onClick={onRequestClose}
        aria-hidden="true"
      />
      {/* Panel root — `data-no-advance` blankets the entire chat
          surface so any click inside (including the tool-card
          `<details>` / `<summary>` expanders, which the viewer's
          suppressor selector does not list natively) is opted out
          of slide advance. Broad-and-stable beats sprinkling
          `data-interactive` on every future control we add here. */}
      <motion.aside
        {...panelMotion}
        role="dialog"
        aria-label="AI assistant"
        data-testid="studio-agent-panel"
        data-no-advance
        className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-[400px] flex-col border-l border-cf-border bg-cf-bg-100 text-cf-text shadow-xl"
      >
        {/* Header */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-cf-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles
              size={14}
              className="text-cf-orange"
              aria-hidden="true"
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cf-orange">
              AI assistant
            </p>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                type="button"
                data-interactive
                data-testid="studio-agent-clear"
                onClick={() => clearHistory()}
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle transition-colors hover:text-cf-text"
                aria-label="Clear conversation"
                title="Clear conversation"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              data-interactive
              data-testid="studio-agent-close"
              onClick={onRequestClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-cf-border text-cf-text-muted transition-colors hover:border-dashed hover:text-cf-text"
              aria-label="Close AI assistant"
              title="Close (Esc)"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Message list */}
        <div
          ref={messageListRef}
          data-testid="studio-agent-messages"
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
        >
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            // Cast through `UiMessageLike` because the SDK's full
            // `UIMessage` part union includes reasoning / source /
            // file parts we don't render. `MessageBubble` narrows by
            // `type` at runtime, so structurally we only read fields
            // that exist on the parts we care about.
            messages.map((m) => (
              <MessageBubble key={m.id} message={m as unknown as UiMessageLike} />
            ))
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          data-testid="studio-agent-form"
          className="flex flex-shrink-0 flex-col gap-2 border-t border-cf-border px-5 py-4"
        >
          <textarea
            data-interactive
            data-testid="studio-agent-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline. Mirrors
              // the convention every chat app uses; users expect it.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                // Submit the form imperatively — this branch is
                // outside React's synthetic-event submission path.
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask anything about your deck…"
            rows={2}
            disabled={isBusy}
            aria-label="Message"
            className="resize-none rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text placeholder:text-cf-text-subtle focus:border-cf-orange focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle">
              {isBusy ? "Thinking…" : "Enter to send · Shift+Enter for newline"}
            </p>
            <button
              type="submit"
              data-interactive
              data-testid="studio-agent-send"
              disabled={isBusy || input.trim().length === 0}
              className="cf-btn-primary disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </form>
      </motion.aside>
    </>
  );
}

/**
 * Empty-state message shown before the first send. Tells the user
 * what the agent can and can't do, so phase 1's scope honesty lives
 * in the UI as well as the system prompt.
 */
function EmptyState() {
  return (
    <div
      data-testid="studio-agent-empty"
      className="flex flex-1 flex-col justify-center gap-3 text-sm text-cf-text-muted"
    >
      <p className="font-medium tracking-[-0.01em] text-cf-text">
        Ask me anything about your deck.
      </p>
      <p>
        I can suggest copy, sketch slide structures, or talk through your
        approach.
      </p>
      <p className="text-cf-text-subtle">
        I can&rsquo;t read or edit the deck itself yet &mdash; that&rsquo;s
        coming in a future phase.
      </p>
    </div>
  );
}

/**
 * Renders a single UI message bubble.
 *
 * The AI SDK's `UIMessage.parts` is a heterogeneous array of text,
 * reasoning, tool calls, tool results, etc. Phase 2 renders three
 * kinds inline:
 *
 *   - `type === "text"` — plain text concatenated into one bubble.
 *   - `type === "tool-<name>"` (`ToolUIPart`) — tool call + result,
 *     rendered as a structured pill with the input/output collapsible.
 *   - `type === "dynamic-tool"` — same as above for runtime-defined
 *     tools (we don't ship any in phase 2, but render defensively so
 *     a future MCP-style addition doesn't crash the UI).
 *
 * Everything else (reasoning, sources, files) is filtered out for
 * now — those parts land when the matching SDK feature is exercised.
 */

/** Local typings — narrow enough to render without pulling the SDK's full UIMessage type into the JSX layer. */
interface BasePart {
  type: string;
}
interface TextPart extends BasePart {
  type: "text";
  text?: string;
}
interface ToolPart extends BasePart {
  /** `tool-<name>` for static tools, `dynamic-tool` for runtime tools. */
  type: string;
  /** Tool name, only populated on dynamic-tool parts. */
  toolName?: string;
  toolCallId?: string;
  state?:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied";
  input?: unknown;
  output?: unknown;
  errorText?: string;
}
type AnyPart = TextPart | ToolPart;

interface UiMessageLike {
  id: string;
  role: "user" | "assistant" | "system";
  parts: Array<AnyPart>;
}

/**
 * `tool-<name>` is the canonical type prefix for static tools. We
 * detect both that and the `dynamic-tool` shape so future MCP-style
 * additions render without code changes.
 */
function isToolPart(p: AnyPart): p is ToolPart {
  return (
    typeof p.type === "string" &&
    (p.type === "dynamic-tool" || p.type.startsWith("tool-"))
  );
}

function getToolNameFromPart(p: ToolPart): string {
  if (p.type === "dynamic-tool") return p.toolName ?? "tool";
  // `tool-readDeck` → `readDeck`
  return p.type.startsWith("tool-") ? p.type.slice(5) : p.type;
}

function MessageBubble({ message }: { message: UiMessageLike }) {
  const isUser = message.role === "user";

  // Group consecutive text parts together so the bubble doesn't
  // render with awkward gaps; tool parts get their own row.
  const text = message.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
  const toolParts = message.parts.filter(isToolPart);

  // A message can be:
  //   - pure text (most user messages, most assistant text responses)
  //   - text + tool calls (assistant explaining what it's about to do
  //     or summarising results)
  //   - tool calls only (assistant mid-turn between text deltas)
  // Render text bubble first if present, then each tool part, so the
  // visual order matches the assistant's narrative.

  return (
    <div
      data-testid="studio-agent-message"
      data-role={message.role}
      className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cf-text-subtle">
        {isUser ? "You" : "Assistant"}
      </p>
      {text && (
        <div
          data-testid="studio-agent-text"
          className={`max-w-[90%] whitespace-pre-wrap rounded-md border px-3 py-2 text-sm leading-relaxed ${
            isUser
              ? "border-cf-orange/30 bg-cf-orange/5 text-cf-text"
              : "border-cf-border bg-cf-bg-200 text-cf-text"
          }`}
        >
          {text}
        </div>
      )}
      {toolParts.length > 0 && (
        <div className="flex w-full max-w-[90%] flex-col gap-2">
          {toolParts.map((part, idx) => (
            <ToolPartCard
              key={part.toolCallId ?? `${part.type}-${idx}`}
              part={part}
            />
          ))}
        </div>
      )}
      {!text && toolParts.length === 0 && (
        <div className="max-w-[90%] rounded-md border border-cf-border bg-cf-bg-200 px-3 py-2 text-sm">
          <span className="text-cf-text-subtle italic">…</span>
        </div>
      )}
    </div>
  );
}

/**
 * Renders a single tool-call part. Visual states:
 *
 *   - `input-streaming` / `input-available` — "🛠 Calling <name>…"
 *     pill with a soft pulse so the user knows the agent is mid-tool.
 *   - `output-available` — collapsed summary line plus an expandable
 *     `<details>` showing the raw input + output JSON. Specialised
 *     summaries for `readDeck` and `proposePatch` give a friendlier
 *     first read than raw JSON.
 *   - `output-error` / `output-denied` — red-bordered card with the
 *     error text.
 *
 * The expander is `<details>` (native browser disclosure) rather than
 * a custom toggle — cheap, accessible, keyboard-navigable, and a
 * future polish pass can replace it with a designed component without
 * changing the semantics.
 */
function ToolPartCard({ part }: { part: ToolPart }) {
  const toolName = getToolNameFromPart(part);
  const state = part.state ?? "input-streaming";

  if (state === "output-error" || state === "output-denied") {
    return (
      <div
        data-testid="studio-agent-tool-part"
        data-tool={toolName}
        data-state={state}
        className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-cf-text"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-red-500">
          {state === "output-denied" ? "Denied" : "Tool error"} · {toolName}
        </p>
        <p className="mt-1 text-cf-text">
          {part.errorText ?? "Tool call failed."}
        </p>
        {part.input !== undefined && (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle">
              Input
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-cf-border bg-cf-bg-100 px-2 py-1 text-[11px] leading-snug">
              {safeStringify(part.input)}
            </pre>
          </details>
        )}
      </div>
    );
  }

  if (state === "input-streaming" || state === "input-available") {
    return (
      <div
        data-testid="studio-agent-tool-part"
        data-tool={toolName}
        data-state={state}
        className="flex items-center gap-2 rounded-md border border-cf-border bg-cf-bg-200 px-3 py-2 text-sm text-cf-text-muted"
      >
        <span aria-hidden="true">🛠</span>
        <span className="font-mono text-[11px] tracking-[0.05em]">
          Calling <span className="text-cf-text">{toolName}</span>…
        </span>
        <span className="ml-auto inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-cf-orange" />
      </div>
    );
  }

  // state === "output-available" (or any approval state, which we
  // render as if input is staged).
  const summary = summariseToolOutput(toolName, part.output);
  return (
    <div
      data-testid="studio-agent-tool-part"
      data-tool={toolName}
      data-state={state}
      className="rounded-md border border-cf-border bg-cf-bg-200 px-3 py-2 text-sm text-cf-text"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-orange">
        {summary.icon} {summary.label} · {toolName}
      </p>
      {summary.detail && (
        <p className="mt-1 text-cf-text">{summary.detail}</p>
      )}
      {summary.href && (
        // The "View →" link is for tools whose result includes a
        // canonical URL the user wants to follow (issue #131 phase
        // 3c: `proposeSourceEdit` returns a PR URL). `data-interactive`
        // keeps it from triggering slide advance via Deck's click-to-
        // advance handler; `target=_blank` because the chat panel is
        // inside the deck viewer and we don't want to navigate away.
        <a
          data-interactive
          data-testid="studio-agent-tool-link"
          href={summary.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-orange transition-colors hover:text-cf-text"
        >
          View →
        </a>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle">
          Show JSON
        </summary>
        <div className="mt-1 flex flex-col gap-2">
          {part.input !== undefined && (
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cf-text-subtle">
                Input
              </p>
              <pre className="max-h-48 overflow-auto rounded border border-cf-border bg-cf-bg-100 px-2 py-1 text-[11px] leading-snug">
                {safeStringify(part.input)}
              </pre>
            </div>
          )}
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cf-text-subtle">
              Output
            </p>
            <pre
              data-testid="studio-agent-tool-output-json"
              className="max-h-64 overflow-auto rounded border border-cf-border bg-cf-bg-100 px-2 py-1 text-[11px] leading-snug"
            >
              {safeStringify(part.output)}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}

/**
 * Friendly one-line summary for each known tool's result. Falls back
 * to a generic "Result" pill for unknown tools (so a future MCP tool
 * renders sensibly without code changes here).
 *
 * The optional `href` field is for tools whose result includes a
 * canonical URL (e.g. `proposeSourceEdit` returns a PR URL). The
 * card renders it as a small "View →" button so the user doesn't
 * have to dig into the JSON to find the link.
 */
function summariseToolOutput(
  toolName: string,
  output: unknown,
): { icon: string; label: string; detail?: string; href?: string } {
  if (toolName === "readDeck" && output && typeof output === "object") {
    const o = output as {
      found?: boolean;
      reason?: string;
      error?: string;
      deck?: { meta?: { title?: string }; slides?: unknown[] };
    };
    if (o.found === true && o.deck) {
      const slideCount = Array.isArray(o.deck.slides)
        ? o.deck.slides.length
        : 0;
      const title = o.deck.meta?.title ?? "(untitled)";
      return {
        icon: "📖",
        label: "Read deck",
        detail: `“${title}” · ${slideCount} slide${slideCount === 1 ? "" : "s"}`,
      };
    }
    if (o.found === false) {
      return {
        icon: "📖",
        label: "Read deck",
        detail: o.reason ?? o.error ?? "Deck not available.",
      };
    }
  }
  if (toolName === "proposePatch" && output && typeof output === "object") {
    const o = output as {
      ok?: boolean;
      errors?: string[];
      error?: string;
      dryRun?: { meta?: { title?: string }; slides?: unknown[] };
    };
    if (o.ok === true && o.dryRun) {
      const slideCount = Array.isArray(o.dryRun.slides)
        ? o.dryRun.slides.length
        : 0;
      const title = o.dryRun.meta?.title ?? "(untitled)";
      return {
        icon: "📝",
        label: "Proposed change (dry-run)",
        detail: `“${title}” · ${slideCount} slide${slideCount === 1 ? "" : "s"} · not saved yet`,
      };
    }
    if (o.ok === false) {
      const msg = o.errors?.join("; ") ?? o.error ?? "Validation failed.";
      return {
        icon: "⚠️",
        label: "Proposed change rejected",
        detail: msg,
      };
    }
  }
  if (toolName === "commitPatch" && output && typeof output === "object") {
    const o = output as {
      ok?: boolean;
      errors?: string[];
      error?: string;
      persistedToKv?: boolean;
      deck?: { meta?: { title?: string }; slides?: unknown[] };
      githubCommit?:
        | { ok: true; commitSha: string; commitHtmlUrl: string }
        | { ok: false; reason: string };
    };
    if (o.ok === true && o.deck) {
      const slideCount = Array.isArray(o.deck.slides)
        ? o.deck.slides.length
        : 0;
      const title = o.deck.meta?.title ?? "(untitled)";
      const ghDetail =
        o.githubCommit && o.githubCommit.ok
          ? ` · committed to GitHub (${o.githubCommit.commitSha.slice(0, 7)})`
          : "";
      return {
        icon: "💾",
        label: "Saved",
        detail: `“${title}” · ${slideCount} slide${slideCount === 1 ? "" : "s"}${ghDetail}`,
      };
    }
    if (o.ok === false) {
      const msg = o.errors?.join("; ") ?? o.error ?? "Commit failed.";
      return { icon: "⚠️", label: "Commit failed", detail: msg };
    }
  }
  if (toolName === "listSourceTree" && output && typeof output === "object") {
    const o = output as {
      ok?: boolean;
      error?: string;
      path?: string;
      items?: Array<{ name: string; type: string }>;
    };
    if (o.ok === true) {
      const count = o.items?.length ?? 0;
      return {
        icon: "📂",
        label: "Listed source tree",
        detail: `${o.path || "(root)"} · ${count} item${count === 1 ? "" : "s"}`,
      };
    }
    if (o.ok === false) {
      return {
        icon: "⚠️",
        label: "List failed",
        detail: o.error ?? "Could not read directory.",
      };
    }
  }
  if (toolName === "readSource" && output && typeof output === "object") {
    const o = output as {
      ok?: boolean;
      error?: string;
      path?: string;
      size?: number;
    };
    if (o.ok === true) {
      const sizeLabel =
        typeof o.size === "number" ? ` · ${formatBytes(o.size)}` : "";
      return {
        icon: "📄",
        label: "Read source",
        detail: `${o.path ?? "(unknown path)"}${sizeLabel}`,
      };
    }
    if (o.ok === false) {
      return {
        icon: "⚠️",
        label: "Read failed",
        detail: o.error ?? "Could not read file.",
      };
    }
  }
  if (
    toolName === "proposeSourceEdit" &&
    output &&
    typeof output === "object"
  ) {
    // Issue #131 phase 3c. Discriminated union — the success branch
    // carries the PR URL, the failure branch carries a `phase` that
    // explains where in the pipeline we stopped.
    const o = output as {
      ok?: boolean;
      prNumber?: number;
      prHtmlUrl?: string;
      branch?: string;
      phase?: string;
      error?: string;
      noEffectiveChanges?: boolean;
      failedTestGatePhase?: string;
      failedPath?: string;
    };
    if (
      o.ok === true &&
      typeof o.prNumber === "number" &&
      typeof o.prHtmlUrl === "string"
    ) {
      return {
        icon: "🚀",
        label: "Opened draft PR",
        detail: `#${o.prNumber}${o.branch ? ` · ${o.branch}` : ""}`,
        href: o.prHtmlUrl,
      };
    }
    if (o.ok === false) {
      // Phase-aware error labels so the user (and the model) can
      // tell at a glance whether this is recoverable (typecheck red)
      // or terminal (no GitHub connection).
      const reasonByPhase: Record<string, string> = {
        auth: "Auth missing",
        github_token: "GitHub not connected",
        clone: "Clone failed",
        apply: "File edit rejected",
        test_gate: "Test gate failed",
        commit_push: o.noEffectiveChanges
          ? "No effective changes"
          : "Commit/push failed",
        open_pr: "PR open failed",
      };
      const phaseLabel = reasonByPhase[o.phase ?? ""] ?? "Source edit failed";
      const detail =
        o.failedTestGatePhase
          ? `${o.error ?? ""}${o.error ? " · " : ""}Failed phase: ${o.failedTestGatePhase}`
          : o.failedPath
            ? `${o.error ?? ""}${o.error ? " · " : ""}Path: ${o.failedPath}`
            : o.error;
      return { icon: "⚠️", label: phaseLabel, detail };
    }
  }
  return { icon: "🔧", label: "Tool result" };
}

/** Format byte counts as B / KB / MB. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Stringify with a depth-limited fallback. JSON.stringify can throw
 * on circular structures or BigInt; we'd rather render "<unprintable>"
 * than crash the message list.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "<unprintable value>";
  }
}
