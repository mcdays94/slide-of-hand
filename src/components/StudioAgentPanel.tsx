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
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import ReactMarkdown from "react-markdown";
import { easeEntrance, easeStandard } from "@/lib/motion";
import { useSettings } from "@/framework/viewer/useSettings";
import { useAccessAuth } from "@/lib/use-access-auth";
import { extractLatestDeckCreationCall } from "@/components/deck-creation-canvas/extractLatestCall";

export interface StudioAgentPanelProps {
  /** Slug of the deck this conversation belongs to. */
  deckSlug: string;
  /** Called when the user dismisses the panel (Esc, X button, etc). */
  onClose: () => void;
  /**
   * Render variant. Default `side-panel` is the historic slide-out
   * overlay used on `/admin/decks/<slug>` and `/decks/<slug>` — it
   * has a backdrop + slide-in animation + fixed-positioning on the
   * right edge. The `page` variant (issue #171) drops the backdrop +
   * animation and renders inline as a card so the panel can BE the
   * primary surface of a route (e.g. the new-deck creator), not
   * just a side overlay. The Esc-to-close logic and `onClose`
   * contract are the same in both variants; in `page` mode the
   * route handler is expected to translate `onClose` into a
   * navigation back to wherever makes sense.
   */
  variant?: "side-panel" | "page";
  /**
   * Optional override of the empty-state copy (issue #171 — the
   * new-deck creator wants different language than the existing-
   * deck side panel). When unset the panel uses the historic
   * "Ask me anything about your deck" copy.
   */
  emptyState?: { title: string; description: string };
  /**
   * Extra fields to merge into `useAgentChat`'s `body` option. The
   * `body` is forwarded to `onChatMessage`'s `options.body` on the
   * server every turn — this is the channel the new-deck creator
   * uses to send the current Public/Private toggle state through
   * to the agent (issue #171 visibility toggle). The model picker
   * always merges in `model: settings.aiAssistantModel` on top of
   * this, so a caller can't accidentally clobber the model
   * selection by passing `body={ model: ... }`.
   */
  body?: Record<string, unknown>;
  /**
   * Render slot for a LEFT pane next to the chat (issue #178 sub-
   * pieces 1 + 3). When set AND `variant === "page"` AND the chat
   * history contains a deck-creation tool-call (createDeckDraft or
   * iterateOnDeckDraft), the panel renders a two-column layout:
   * this slot in the left column, the chat in the right.
   *
   * Called every render with the live chat state, so consumers can
   * pass the latest `messages` down to their canvas component. The
   * slot is NOT rendered when no deck-creation call exists yet —
   * the page is full-width chat until the model fires its first
   * tool call.
   *
   * Used by `/admin/decks/new` to mount `<DeckCreationCanvas>`.
   * No effect in `variant === "side-panel"` (which already has
   * its own underlying surface).
   */
  renderLeftPane?: (state: PanelChatState) => ReactNode;
}

/**
 * Live chat state surfaced to the `renderLeftPane` slot. Mirrors
 * the subset of `useAgentChat`'s return shape the canvas (or any
 * future left-pane content) needs.
 */
export interface PanelChatState {
  messages: ReadonlyArray<{
    id?: string;
    parts: Array<{ type: string; [k: string]: unknown }>;
  }>;
  sendMessage: (message: { text: string }) => void;
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

export function StudioAgentPanel({
  deckSlug,
  onClose,
  variant = "side-panel",
  emptyState,
  body,
  renderLeftPane,
}: StudioAgentPanelProps) {
  // Visibility state powers the slide-out exit animation in
  // `side-panel` variant. In `page` variant the visibility is
  // always true (the panel IS the page — there's nothing to
  // animate out, the route just unmounts when the user navigates
  // away).
  const [visible, setVisible] = useState(true);

  // Esc closes the slide-out variant. In page variant Esc has no
  // panel-close semantics — the page-level keydown belongs to the
  // route handler, not us — so the listener is only registered when
  // `variant === "side-panel"`. (The in-flight-cancel Esc handler
  // inside PanelInner runs in either variant; it short-circuits
  // before this effect's bubble-phase handler fires.)
  useEffect(() => {
    if (variant !== "side-panel") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setVisible(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  // `page` variant: render inner directly with no AnimatePresence
  // wrapping. Esc still works (PanelInner's own capture-phase
  // listener handles in-flight cancel; the route handler owns
  // panel-close). No backdrop, no slide-in.
  if (variant === "page") {
    return (
      <PanelInner
        deckSlug={deckSlug}
        onRequestClose={onClose}
        variant="page"
        emptyState={emptyState}
        body={body}
        {...(renderLeftPane ? { renderLeftPane } : {})}
      />
    );
  }

  // `side-panel` (historic) variant: slide-out overlay with backdrop
  // + slide-in/out animation. AnimatePresence's `onExitComplete`
  // fires once the slide-out finishes so the parent can unmount us
  // cleanly without clipping the animation.
  return (
    <AnimatePresence
      onExitComplete={() => {
        if (!visible) onClose();
      }}
    >
      {visible && (
        <PanelInner
          deckSlug={deckSlug}
          onRequestClose={() => setVisible(false)}
          variant="side-panel"
          emptyState={emptyState}
          body={body}
        />
      )}
    </AnimatePresence>
  );
}

interface PanelInnerProps {
  deckSlug: string;
  onRequestClose: () => void;
  variant: "side-panel" | "page";
  emptyState?: { title: string; description: string };
  body?: Record<string, unknown>;
  renderLeftPane?: (state: PanelChatState) => ReactNode;
}

function PanelInner({
  deckSlug,
  onRequestClose,
  variant,
  emptyState,
  body: extraBody,
  renderLeftPane,
}: PanelInnerProps) {
  const isPageVariant = variant === "page";
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

  // Probe Cloudflare Access on mount so we can detect a stale
  // CF_Authorization cookie BEFORE the user types a message into a
  // chat surface that silently won't work. Symptom we're guarding
  // against (hit in the browser on 2026-05-11): the user opens the
  // panel after their interactive Access session has expired, the
  // WebSocket upgrade gets intercepted by Access's 302 to login (or
  // CORS-blocked from `useAgentChat`'s history fetch), and the panel
  // renders with no messages and no error — just a blank empty
  // state. Reuses the same hook as NotesEditor's edit-gate (issue
  // #120); single-shot per mount, no SWR cache, returns
  // "checking" | "authenticated" | "unauthenticated".
  //
  // Mid-session expiry (cookie expires WHILE the panel is open) is
  // out of scope for this fix — the hook only probes once. Adding a
  // re-probe on `useAgentChat` error transitions is a worthwhile
  // follow-up; for now the mount-time probe addresses the actual
  // observed symptom.
  const authStatus = useAccessAuth();
  const sessionExpired = authStatus === "unauthenticated";

  const { messages, sendMessage, status, stop, clearHistory } = useAgentChat({
    agent,
    // `body` is forwarded to `onChatMessage`'s `options.body` on the
    // server every turn. See `worker/agent.ts`'s
    // `resolveAiAssistantModel(options.body)` call.
    //
    // We splat `extraBody` (caller-provided per-route fields like
    // the new-deck creator's `visibility` toggle, issue #171) BEFORE
    // the model key. That ordering means callers cannot accidentally
    // clobber the model selection by passing `body={ model: ... }` —
    // the always-spread-last `model: settings.aiAssistantModel` line
    // wins.
    body: { ...(extraBody ?? {}), model: settings.aiAssistantModel },
  });

  // "Show model thinking" — power-user opt-in for rendering the
  // assistant's `reasoning` parts in a collapsible block above each
  // turn. Off by default. Reasoning-tuned models (GPT-OSS 120B today)
  // emit reasoning parts during streaming; non-reasoning models
  // (Kimi K2.6, Llama 4 Scout) don't, so the toggle is invisible in
  // their output even when enabled.
  const showReasoning = settings.showAssistantReasoning;

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
    // Second line of defense — the textarea is disabled when the
    // session has expired, but Enter-to-submit could still fire if
    // the disabled attribute is bypassed (e.g. by a test, or by a
    // browser quirk). Gate the dispatch as well.
    if (sessionExpired) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  const isBusy = status === "submitted" || status === "streaming";
  // The composer is locked down both during a turn and when the
  // Access session has expired — a queued message would just fail at
  // the WebSocket layer, and the user would see the same silent
  // empty state that motivated this banner in the first place.
  const composerDisabled = isBusy || sessionExpired;

  // Esc-to-cancel while streaming (issue #172). Capture phase so we
  // beat `Deck.tsx`'s top-level keydown handler, which would otherwise
  // close the panel — closing doesn't stop the inference, it just
  // hides the chat. When there's no stream in flight we don't
  // intercept Esc at all, so the regular "Esc closes the panel"
  // behaviour is preserved.
  useEffect(() => {
    if (!isBusy) return;
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [isBusy, stop]);

  // When the panel hosts a left-pane slot (issue #178 sub-pieces 1
  // + 3 — `/admin/decks/new` mounts the deck-creation canvas there)
  // AND the chat history contains a deck-creation tool-call, pivot
  // to a two-column layout: left pane takes the bulk of the
  // viewport, the chat shrinks to a right rail. Once split, stays
  // split for the rest of the tab's lifetime (call always exists in
  // history once made).
  const isSplitLayout =
    isPageVariant &&
    renderLeftPane !== undefined &&
    extractLatestDeckCreationCall(messages) !== null;

  // Page-variant root is a plain block-level element (no fixed
  // positioning, no slide-in, no backdrop, no shadow). The
  // surrounding route handler owns the viewport layout — we just
  // claim the height it gave us via `h-full`. Side-panel variant is
  // unchanged.
  //
  // In the split layout the panel becomes the right rail (constrained
  // width + a left border to separate from the canvas).
  const panelClassName = isPageVariant
    ? isSplitLayout
      ? "flex h-full w-full max-w-md flex-col border-l border-cf-border bg-cf-bg-100 text-cf-text"
      : "flex h-full w-full max-w-3xl mx-auto flex-col bg-cf-bg-100 text-cf-text"
    : "fixed right-0 top-0 z-50 flex h-screen w-full max-w-[400px] flex-col border-l border-cf-border bg-cf-bg-100 text-cf-text shadow-xl";

  const panelTree = (
    <>
      {/* Backdrop — light dimming so the panel reads as modal-ish
          without blocking the deck preview entirely. Clicking the
          backdrop closes the panel.

          `data-no-advance` opts the backdrop out of the viewer's
          click-to-advance handler in `Deck.tsx`. Without it, clicking
          the backdrop would BOTH close the panel AND advance the
          slide in one gesture. See issue #131 item C.

          Backdrop is suppressed in `page` variant (issue #171) — the
          panel IS the page surface, there's no underlying content
          to dim. */}
      {!isPageVariant && (
        <motion.div
          {...backdropMotion}
          data-testid="studio-agent-backdrop"
          data-no-advance
          className="fixed inset-0 z-40 bg-cf-text/10"
          onClick={onRequestClose}
          aria-hidden="true"
        />
      )}
      {/* Panel root — `data-no-advance` blankets the entire chat
          surface so any click inside (including the tool-card
          `<details>` / `<summary>` expanders, which the viewer's
          suppressor selector does not list natively) is opted out
          of slide advance. Broad-and-stable beats sprinkling
          `data-interactive` on every future control we add here.

          In `page` variant we render an `<aside>` without
          `motion.aside`'s slide-in animation — there's nothing to
          slide in from when the panel IS the page. */}
      <motion.aside
        {...(isPageVariant ? {} : panelMotion)}
        role="dialog"
        aria-label="AI assistant"
        data-testid="studio-agent-panel"
        data-variant={variant}
        data-no-advance
        className={panelClassName}
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
              aria-label={isPageVariant ? "Back to admin" : "Close AI assistant"}
              title={isPageVariant ? "Back to admin" : "Close (Esc)"}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Access session-expiry banner. Mounted between the header
            and the message list so it never overlaps the chat content
            and is impossible to miss. Modeled after the tool-error
            card in `ToolPartCard` for visual consistency with other
            red-bordered alerts in this panel.

            `role=alert` lets screen readers announce the expiry
            without the user having to focus the banner. The Reload
            button does the simplest thing that works: a full page
            reload bounces the user back through Cloudflare Access's
            SSO redirect, which mints a fresh CF_Authorization cookie
            and brings them back to the same admin route. */}
        {sessionExpired && (
          <div
            role="alert"
            data-testid="studio-agent-auth-expired"
            className="flex flex-shrink-0 flex-col items-start gap-2 border-b border-red-500/40 bg-red-500/5 px-5 py-3"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-red-500">
              Session expired
            </p>
            <p className="text-sm text-cf-text">
              Your Cloudflare Access session may have expired. Reload to
              sign in again.
            </p>
            <button
              type="button"
              data-interactive
              data-testid="studio-agent-auth-reload"
              onClick={() => window.location.reload()}
              className="rounded border border-red-500/40 bg-red-500/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-red-500 transition-colors hover:border-dashed hover:bg-red-500/10"
            >
              Reload page
            </button>
          </div>
        )}

        {/* Message list */}
        <div
          ref={messageListRef}
          data-testid="studio-agent-messages"
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
        >
          {messages.length === 0 ? (
            <EmptyState
              title={emptyState?.title}
              description={emptyState?.description}
            />
          ) : (
            // Cast through `UiMessageLike` because the SDK's full
            // `UIMessage` part union includes reasoning / source /
            // file parts we don't render. `MessageBubble` narrows by
            // `type` at runtime, so structurally we only read fields
            // that exist on the parts we care about.
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m as unknown as UiMessageLike}
                showReasoning={showReasoning}
              />
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
            disabled={composerDisabled}
            aria-label="Message"
            className="resize-none rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text placeholder:text-cf-text-subtle focus:border-cf-orange focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2">
            {/* Status hint. While the agent is working we surface a
                pulsing dot + an Esc-to-cancel affordance so the user
                knows (a) something is happening, and (b) how to get
                out of it. Issues #172, #173. */}
            <p
              data-testid="studio-agent-status-hint"
              className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle"
            >
              {sessionExpired ? (
                "Reload to sign in"
              ) : isBusy ? (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-cf-orange"
                  />
                  <span>Thinking… · Esc or Stop to cancel</span>
                </>
              ) : (
                "Enter to send · Shift+Enter for newline"
              )}
            </p>
            {/* Send → Stop swap (issue #172). While the agent is
                streaming, the only useful affordance is "stop"; a
                send button would be ambiguous (queued? after the
                current turn? composer is disabled anyway). Two
                buttons with distinct test-ids keep tests + ARIA
                clear. Both share the cf-btn-primary visual so the
                button doesn't visually jump on swap. */}
            {isBusy ? (
              <button
                type="button"
                data-interactive
                data-testid="studio-agent-stop"
                onClick={() => stop()}
                aria-label="Stop the agent"
                className="cf-btn-primary"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                data-interactive
                data-testid="studio-agent-send"
                disabled={sessionExpired || input.trim().length === 0}
                className="cf-btn-primary disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
        </form>
      </motion.aside>
    </>
  );

  // In split layout, wrap the panel tree in a flex container with
  // the left pane. The left pane gets the larger area; the chat
  // panel becomes the right rail.
  if (isSplitLayout && renderLeftPane) {
    return (
      <div
        data-testid="studio-agent-split-layout"
        className="flex h-full w-full"
      >
        <section
          data-testid="studio-agent-left-pane"
          className="flex-1 min-w-0 overflow-hidden"
        >
          {renderLeftPane({ messages, sendMessage })}
        </section>
        {panelTree}
      </div>
    );
  }

  return panelTree;
}

/**
 * Empty-state message shown before the first send. Tells the user
 * what the agent can and can't do, so phase 1's scope honesty lives
 * in the UI as well as the system prompt.
 */
function EmptyState({
  title,
  description,
}: {
  /** Override of the default heading. Defaults to "Ask me anything about your deck." */
  title?: string;
  /** Override of the default body text. */
  description?: string;
}) {
  return (
    <div
      data-testid="studio-agent-empty"
      className="flex flex-1 flex-col justify-center gap-3 text-sm text-cf-text-muted"
    >
      <p className="font-medium tracking-[-0.01em] text-cf-text">
        {title ?? "Ask me anything about your deck."}
      </p>
      <p>
        {description ??
          "I can suggest copy, sketch slide structures, or talk through your approach."}
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
interface ReasoningPart extends BasePart {
  /**
   * The assistant's chain-of-thought, streamed by reasoning-tuned
   * models (e.g. GPT-OSS 120B). The AI SDK splits reasoning into
   * one part per token batch — we concatenate `text` across all
   * reasoning parts to render a single block per turn.
   */
  type: "reasoning";
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
type AnyPart = TextPart | ReasoningPart | ToolPart;

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

/**
 * Map internal tool names to user-readable verb phrases. Surfaced in
 * the tool-call cards so the user reads "Creating a new deck…" rather
 * than "Calling createDeckDraft…". The internal name is still
 * available as a `data-tool=` attribute on the card for tests + power
 * users who inspect the DOM. Issue #173.
 *
 * Keep this map in sync with `buildTools()` in `worker/agent-tools.ts`.
 * An unknown tool (e.g. a user-configured MCP tool) falls back to
 * "Working on <name>" so we never render a totally opaque pill.
 */
const FRIENDLY_TOOL_LABEL: Record<string, string> = {
  readDeck: "Reading the deck",
  proposePatch: "Drafting a change",
  commitPatch: "Saving the change",
  listSourceTree: "Browsing source files",
  readSource: "Reading source file",
  proposeSourceEdit: "Building a pull request",
  createDeckDraft: "Creating a new deck",
  iterateOnDeckDraft: "Updating the deck",
};

export function friendlyToolLabel(toolName: string): string {
  return FRIENDLY_TOOL_LABEL[toolName] ?? `Working on ${toolName}`;
}

function MessageBubble({
  message,
  showReasoning,
}: {
  message: UiMessageLike;
  /**
   * When true AND this is an assistant message AND the message has
   * at least one `reasoning` part with non-empty text, render the
   * concatenated reasoning above the answer in a `<details open>`
   * block. Driven by the `showAssistantReasoning` setting.
   */
  showReasoning: boolean;
}) {
  const isUser = message.role === "user";

  // Group consecutive text parts together so the bubble doesn't
  // render with awkward gaps; tool parts get their own row.
  const text = message.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
  const toolParts = message.parts.filter(isToolPart);

  // Reasoning parts only render when (a) the setting is on, (b) this
  // is an assistant turn (user messages don't have a chain-of-thought
  // even if a misbehaving tool attached one), and (c) at least one
  // reasoning part actually carries text. The SDK streams reasoning
  // as a sequence of `reasoning` parts during the model's thinking
  // phase; we join them so the user reads continuous prose rather
  // than per-token bubbles.
  const reasoningText =
    showReasoning && !isUser
      ? message.parts
          .filter((p): p is ReasoningPart => p.type === "reasoning")
          .map((p) => p.text ?? "")
          .join("")
      : "";

  // A message can be:
  //   - pure text (most user messages, most assistant text responses)
  //   - text + tool calls (assistant explaining what it's about to do
  //     or summarising results)
  //   - tool calls only (assistant mid-turn between text deltas)
  //   - reasoning + text (assistant turns from reasoning-tuned models
  //     with the "show model thinking" setting on)
  // Render reasoning first (visually above the answer), then text
  // bubble if present, then each tool part — matching the chronological
  // order the assistant produced them.

  return (
    <div
      data-testid="studio-agent-message"
      data-role={message.role}
      className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cf-text-subtle">
        {isUser ? "You" : "Assistant"}
      </p>
      {reasoningText && <ReasoningCard text={reasoningText} />}
      {text && (
        <div
          data-testid="studio-agent-text"
          className={`max-w-[90%] rounded-md border px-3 py-2 text-sm leading-relaxed ${
            isUser
              ? "whitespace-pre-wrap border-cf-orange/30 bg-cf-orange/5 text-cf-text"
              : "border-cf-border bg-cf-bg-200 text-cf-text"
          }`}
        >
          {/* User input is plain text — they don't write markdown,
              and `whitespace-pre-wrap` preserves any newlines they
              inserted with Shift+Enter. Assistant output is markdown
              from the model (bold, lists, code spans, etc.) and gets
              rendered as styled HTML so `**bold**` doesn't show as
              literal asterisks. See issue surfaced 2026-05-11. */}
          {isUser ? text : <MarkdownContent text={text} />}
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
          {state === "output-denied" ? "Denied" : "Error"} ·{" "}
          {friendlyToolLabel(toolName)}
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
        <span className="text-[12px] text-cf-text">
          {friendlyToolLabel(toolName)}…
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
        {summary.icon} {friendlyToolLabel(toolName)} · {summary.label}
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

/**
 * Renders the assistant's chain-of-thought ("thinking") for a single
 * turn, in a collapsible block above the answer bubble.
 *
 * Uses a native `<details open>` element so:
 *   - Each instance keeps its own collapse state — collapsing one
 *     turn's reasoning doesn't affect any other turn.
 *   - Keyboard + screen-reader accessibility comes for free (no
 *     custom aria-expanded wiring).
 *   - The "open by default" behavior is one HTML attribute, not a
 *     React-controlled boolean we'd have to track per turn.
 *
 * Visual style: muted background + dashed-hover summary, distinct
 * from both the answer bubble (cf-bg-200) and the tool-card variants
 * (red-bordered errors / orange-text successes). The reasoning is
 * deliberately quieter than the answer — it's supporting context,
 * not the primary content.
 *
 * Reasoning is run through the same markdown pipeline as assistant
 * text because reasoning often contains code spans, lists, and
 * inline formatting from the model.
 */
function ReasoningCard({ text }: { text: string }) {
  return (
    <details
      open
      data-testid="studio-agent-reasoning"
      className="w-full max-w-[90%] rounded-md border border-cf-border bg-cf-bg-200/60 text-cf-text-muted"
    >
      <summary
        data-interactive
        className="cursor-pointer select-none px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle transition-colors hover:border-dashed hover:text-cf-text"
      >
        Thinking
      </summary>
      <div className="border-t border-cf-border px-3 py-2 text-[13px] leading-relaxed italic">
        <MarkdownContent text={text} />
      </div>
    </details>
  );
}

/**
 * Render assistant message text as styled markdown.
 *
 * The model emits markdown — bold, ordered/unordered lists, inline
 * code, fenced code blocks, links, headings. Without this component
 * those would render as literal `**bold**` / `1. item` etc. (visible
 * in the chat panel until 2026-05-11).
 *
 * Why explicit component overrides instead of a `prose` class:
 *   - Tailwind v4 + this project don't ship `@tailwindcss/typography`.
 *   - The chat bubble's own padding + colors are already set; we
 *     only need to style the INNER markdown elements (paragraph
 *     spacing, list indents, code spans, links).
 *   - Explicit overrides also let us pin link safety
 *     (`rel="noopener noreferrer"` + `target="_blank"`) and inherit
 *     the bubble's text color rather than ReactMarkdown's defaults.
 *
 * No `rehype-raw` — react-markdown's default config escapes raw HTML
 * which is the right posture for model output we don't fully control.
 */
function MarkdownContent({ text }: { text: string }) {
  return (
    <div data-testid="studio-agent-markdown" className="space-y-2">
      <ReactMarkdown
        components={{
          p: ({ children }: { children?: ReactNode }) => (
            <p className="leading-relaxed last:mb-0">{children}</p>
          ),
          strong: ({ children }: { children?: ReactNode }) => (
            <strong className="font-semibold text-cf-text">{children}</strong>
          ),
          em: ({ children }: { children?: ReactNode }) => (
            <em className="italic">{children}</em>
          ),
          ol: ({ children }: { children?: ReactNode }) => (
            <ol className="ml-4 list-decimal space-y-1">{children}</ol>
          ),
          ul: ({ children }: { children?: ReactNode }) => (
            <ul className="ml-4 list-disc space-y-1">{children}</ul>
          ),
          li: ({ children }: { children?: ReactNode }) => (
            <li className="pl-1">{children}</li>
          ),
          code: ({ children }: { children?: ReactNode }) => (
            <code className="rounded bg-cf-bg-100 px-1 py-0.5 font-mono text-[12px]">
              {children}
            </code>
          ),
          pre: ({ children }: { children?: ReactNode }) => (
            <pre className="overflow-auto rounded bg-cf-bg-100 px-2 py-1.5 font-mono text-[12px] leading-snug">
              {children}
            </pre>
          ),
          a: ({
            children,
            href,
          }: {
            children?: ReactNode;
            href?: string;
          }) => (
            // target=_blank because the chat panel is anchored inside
            // the deck viewer — navigating away inside the same tab
            // would close the conversation. rel=noopener for opener
            // security on cross-origin links.
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cf-orange underline decoration-cf-orange/40 hover:decoration-cf-orange"
            >
              {children}
            </a>
          ),
          h1: ({ children }: { children?: ReactNode }) => (
            <p className="mt-2 font-semibold tracking-[-0.01em] text-cf-text">
              {children}
            </p>
          ),
          h2: ({ children }: { children?: ReactNode }) => (
            <p className="mt-2 font-semibold tracking-[-0.01em] text-cf-text">
              {children}
            </p>
          ),
          h3: ({ children }: { children?: ReactNode }) => (
            <p className="mt-2 font-medium tracking-[-0.01em] text-cf-text">
              {children}
            </p>
          ),
          hr: () => <hr className="my-2 border-cf-border" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
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
