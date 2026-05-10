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

  const { messages, sendMessage, status, clearHistory } = useAgentChat({
    agent,
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
          backdrop closes the panel. */}
      <motion.div
        {...backdropMotion}
        data-testid="studio-agent-backdrop"
        className="fixed inset-0 z-40 bg-cf-text/10"
        onClick={onRequestClose}
        aria-hidden="true"
      />
      <motion.aside
        {...panelMotion}
        role="dialog"
        aria-label="AI assistant"
        data-testid="studio-agent-panel"
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
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
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
 * Renders a single UI message bubble. We pull the text out of the
 * AI SDK's `parts` array — phase 1 only handles plain `text` parts.
 * Other part kinds (tool calls, reasoning) get filtered out for
 * now; they show up in later phases when tools land.
 */
interface UiMessageLike {
  id: string;
  role: "user" | "assistant" | "system";
  parts: Array<{ type: string; text?: string }>;
}

function MessageBubble({ message }: { message: UiMessageLike }) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");

  return (
    <div
      data-testid="studio-agent-message"
      data-role={message.role}
      className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cf-text-subtle">
        {isUser ? "You" : "Assistant"}
      </p>
      <div
        className={`max-w-[90%] whitespace-pre-wrap rounded-md border px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "border-cf-orange/30 bg-cf-orange/5 text-cf-text"
            : "border-cf-border bg-cf-bg-200 text-cf-text"
        }`}
      >
        {text || (
          <span className="text-cf-text-subtle italic">…</span>
        )}
      </div>
    </div>
  );
}
