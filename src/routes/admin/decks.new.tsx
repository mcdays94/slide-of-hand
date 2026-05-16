/**
 * `/admin/decks/new` — AI-first new-deck creator.
 *
 * Replaces the historic `<NewDeckModal>` (deleted in #171). Instead
 * of a "type a title + click save" empty-shell wizard, this surface
 * is a chat with the in-Studio AI agent: the user describes the
 * deck they want, the model picks an appropriate slug, calls the
 * `createDeckDraft` tool, and the agent forks the `deck-starter`
 * Cloudflare Artifacts repo into a per-user draft `${email}-${slug}`
 * with AI-generated JSX files.
 *
 * Draft visibility caveat (acknowledged on the page itself): the
 * `/preview/<draft-id>/<sha>/*` route is currently stubbed (see
 * `worker/preview-route.ts`). Drafts are created in Artifacts but
 * the user cannot yet see the rendered output from this surface;
 * they iterate via chat until preview lands. Filed as future
 * follow-up on the same issue.
 *
 * ## Why a per-tab DO instance name
 *
 * The `DeckAuthorAgent` Durable Object is keyed by the `name` we
 * pass to `useAgent`. For existing decks we use the slug, so
 * multiple authors editing the same deck share a conversation
 * thread (intentional collaboration). For NEW-deck creation there's
 * no shared context — each user is creating their own draft, and
 * sharing a thread would be confusing. We generate a per-tab UUID
 * (stable across hot-reloads via `useState` lazy init, fresh on
 * page reload) so each new-deck attempt is its own conversation.
 *
 * The DRAFT slug (the thing that becomes `${email}-${slug}` in
 * Artifacts) is separate from this DO instance name — the model
 * picks it from the user's prompt and passes it as the
 * `createDeckDraft({ slug })` tool argument. Tab UUID names the
 * conversation; the model names the draft.
 *
 * ## Why `variant="page"`
 *
 * The historic `StudioAgentPanel` is a fixed-position slide-out
 * with a dimming backdrop — meant to overlay an underlying deck
 * preview. On this route there's no underlying surface; the panel
 * IS the page. The `variant="page"` prop (added in #171) drops
 * the backdrop + slide-in animation and renders the panel as a
 * centred card inside the AdminLayout's content area. See
 * `src/components/StudioAgentPanel.tsx`.
 */

import { Suspense, lazy, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Globe, Lock } from "lucide-react";
import { DeckCreationCanvas } from "@/components/deck-creation-canvas";
import { DraftAssetShelf } from "@/components/deck-creation-canvas/DraftAssetShelf";
import { RenderedDraftPreview } from "@/components/deck-creation-canvas/RenderedDraftPreview";
import {
  extractLatestDeckCreationCall,
  findLastUserPromptText,
  type DeckCreationCall,
} from "@/components/deck-creation-canvas/extractLatestCall";
import type { PreviewStatus } from "@/lib/deck-creation-snapshot";

// Lazy-load to keep the agent SDK + ai-chat off the first paint of
// the static admin routes. Same pattern as the existing mounts in
// Deck.tsx and EditMode.tsx.
const StudioAgentPanel = lazy(() =>
  import("@/components/StudioAgentPanel").then((m) => ({
    default: m.StudioAgentPanel,
  })),
);

/**
 * Build the DO instance name for this tab. Stable for the tab's
 * lifetime, fresh on hard reload. We prefix with `new-deck-` so
 * the name is self-describing in Workers logs / wrangler tail.
 *
 * `crypto.randomUUID()` is universally available in modern browsers
 * and in the test-env's happy-dom shim. Tests that mount this
 * component multiple times in the same `describe` block will see
 * different UUIDs per mount, but per render the value is stable
 * (lazy `useState` initializer).
 */
function makeNewDeckAgentName(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `new-deck-${crypto.randomUUID()}`;
  }
  // Fallback for any environment without crypto.randomUUID (very
  // old browsers, partial polyfills). Random-enough for per-tab
  // isolation — collision risk negligible.
  return `new-deck-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

/**
 * The deck's intended visibility once published. Captured on the
 * new-deck creator and threaded through to the generated `meta.ts`
 * so the draft is born with the right value.
 *
 * Drafts in Cloudflare Artifacts are per-user and inherently
 * private at the storage layer — this value matters at PUBLISH
 * time (when the draft becomes a KV deck or a `deck/<slug>` PR
 * against the source repo). Capturing the choice up-front means
 * the model can include it in the generated metadata and the
 * publish flow doesn't have to ask later.
 */
type DeckVisibility = "public" | "private";

export default function NewDeckRoute() {
  const navigate = useNavigate();
  // Lazy init so the UUID is computed exactly once per mount.
  const [agentName] = useState(makeNewDeckAgentName);
  // Default to private — most drafts won't get published, and
  // private-by-default is a safer floor than the reverse. Threaded
  // through `useAgentChat({ body })` so the agent sees the current
  // selection on every turn and can pass it to `createDeckDraft`.
  const [visibility, setVisibility] = useState<DeckVisibility>("private");
  // Mirrors the panel's internal split-layout state via the panel's
  // `onPivotChange` callback (issue #178 polish). Once the model
  // fires its first deck-creation tool-call the panel pivots to a
  // two-column layout AND we replace the interactive visibility
  // selector with a static chip — the choice has already been baked
  // into the in-flight draft, so further toggling would just be a
  // confusing no-op.
  const [hasPivoted, setHasPivoted] = useState(false);

  return (
    <main
      data-testid="new-deck-route"
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8"
    >
      {/* Sub-header: back-link + page title. The AdminLayout already
          renders the top-level chrome; this is the page's own header
          and slots beneath it. */}
      <div className="flex flex-col gap-3">
        <Link
          to="/admin"
          className="inline-flex w-fit items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-muted transition-colors hover:text-cf-text"
        >
          <ArrowLeft size={12} aria-hidden="true" />
          Back to decks
        </Link>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <p className="cf-tag">New deck</p>
            {/* Alpha pill (#215). The AI deck creator is functional but
                output quality varies and certain model picks fail mid-run;
                signal that openly. `title` doubles as the screen-reader
                description; the visible label is a single word. */}
            <span
              data-testid="ai-deck-creator-alpha-pill"
              aria-label="Alpha — this feature is experimental"
              title="This feature is in alpha. Output quality varies, some model picks may fail mid-run, and the rendered-preview path is still stubbed. Not recommended for production-critical decks yet."
              className="inline-flex items-center rounded-full border border-cf-orange/40 bg-cf-orange-light px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-cf-orange"
            >
              Alpha
            </span>
          </div>
          <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
            Build a deck with AI
          </h1>
          <p className="max-w-2xl text-sm text-cf-text-muted">
            Describe the deck you want — a topic, an audience, a desired
            length. The AI picks a slug, drafts the JSX, and saves the
            result to your personal Cloudflare Artifacts scratch space.
            You can iterate on the draft from this same conversation.
          </p>
        </div>
      </div>

      {/* Visibility selector. Two-button segmented control — same
          visual language as `<SettingsSegmentedRow>` in the Settings
          modal so the affordance reads as "pick one". The chosen
          value rides along on every chat turn via `body.visibility`
          (see useAgentChat wiring in StudioAgentPanel.tsx) and lands
          on the generated `meta.ts.visibility` field.

          Post-pivot (the canvas has materialized — a deck-creation
          tool-call exists in chat history) the selector is replaced
          with a static chip showing the chosen value. The draft was
          already created with that visibility; toggling it from the
          UI wouldn't propagate. The chip is a read-only summary, not
          a control. */}
      {hasPivoted ? (
        <VisibilityChip value={visibility} />
      ) : (
        <VisibilitySelector value={visibility} onChange={setVisibility} />
      )}

      {/* The panel. `flex-1` so it fills the rest of the viewport
          below the page header. The lazy boundary mirrors the
          existing mounts in Deck.tsx / EditMode.tsx — the bundle is
          ~300 KB and we don't want it in the initial paint of
          static admin pages.
          
          `renderLeftPane` is the canvas slot (issue #178 sub-pieces
          1 + 3). The panel calls it on every render with the live
          chat state; when the model fires its first deck-creation
          tool call, the panel pivots its layout to two columns and
          the canvas renders here. Before the first tool call, the
          slot is unmounted and the panel renders full-width. */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Suspense fallback={null}>
          <StudioAgentPanel
            deckSlug={agentName}
            variant="page"
            // `body` is forwarded to `onChatMessage`'s
            // `options.body` on every turn. The agent reads
            // `body.visibility` and (a) injects it into the
            // system-prompt context for the model, (b) defaults
            // any `createDeckDraft` call without an explicit
            // visibility to this value. So the toggle deterministically
            // wins unless the user types "make it public" in chat.
            body={{ visibility }}
            emptyState={{
              title: "What deck would you like to build?",
              description:
                "Describe a topic in plain language — e.g. \"a deck about CRDT collaborative editing for an engineering audience, ~25 min, five slides.\" I'll pick a slug, write the slides, and save the result to your scratch space.",
            }}
            onClose={() => navigate("/admin")}
            renderLeftPane={({ messages, sendMessage }) => {
              // Wire the canvas's Retry button to re-send the most
              // recent user prompt. If for some reason there's an
              // error overlay but no preceding user message (e.g.
              // history was truncated), `lastPrompt` is null and we
              // omit `onRetry` entirely — the canvas hides the
              // button when the prop is absent.
              const lastPrompt = findLastUserPromptText(messages);
              const retryProps = lastPrompt
                ? { onRetry: () => sendMessage({ text: lastPrompt }) }
                : {};
              // Issue #235 — surface the draft asset shelf as soon
              // as the model has committed to a slug. The slug
              // arrives on `part.input.slug` BEFORE the first
              // generated file (often by ~30-60s) so users can
              // upload speaker photos / logos while the model is
              // still composing, then reference the returned URLs
              // in a follow-up iteration prompt.
              //
              // We fall back to inferring the slug from the first
              // emitted file path (the same heuristic the canvas
              // itself uses) so the shelf still shows up if the
              // input-slug surface is empty for any reason — e.g.
              // model retried mid-stream and the partial input
              // never re-populated.
              const call = extractLatestDeckCreationCall(messages);
              const inferredSlug = call?.inputSlug ?? inferSlugFromCall(call);
              // Issue #272 — pull the preview-build status off the
              // latest snapshot or lean tool result. Both shapes
              // carry `previewStatus` / `previewUrl` / `previewError`
              // (since #271); a single helper handles the union.
              const previewFields = extractPreviewFields(call);
              return (
                <NewDeckLeftPane
                  call={call}
                  inferredSlug={inferredSlug}
                  previewFields={previewFields}
                  retryProps={retryProps}
                  messages={messages}
                />
              );
            }}
            // Mirror the panel's internal pivot state up to the
            // route so we can swap the visibility selector for a
            // static chip. Fires after the panel has actually
            // pivoted (useEffect inside the panel), so the chip
            // appears on the same frame as the canvas.
            onPivotChange={setHasPivoted}
          />
        </Suspense>
      </div>
    </main>
  );
}

/**
 * Fallback slug inference for the asset shelf (#235). The model's
 * `input.slug` is the canonical source — surfaced as `call.inputSlug`
 * by `extractLatestDeckCreationCall`. If for any reason that's empty
 * (e.g. partial streaming state, replayed history), peek at the
 * first emitted file's path: deck-creation tool yields use
 * `src/decks/public/<slug>/...`, and the slug segment is stable across
 * the whole run.
 *
 * Returns `undefined` when no slug can be derived; the shelf renders
 * nothing in that state.
 */
function inferSlugFromCall(
  call: ReturnType<typeof extractLatestDeckCreationCall>,
): string | undefined {
  if (!call) return undefined;
  const out = call.output;
  if (!out || typeof out !== "object") return undefined;
  // Lean tool result carries `draftId` (shape `${email}-${slug}`),
  // not a clean slug — we don't reach for that here. Snapshot files
  // are the reliable source.
  if (!("files" in out) || !Array.isArray(out.files)) return undefined;
  for (const f of out.files) {
    const m = f?.path?.match?.(/^src\/decks\/public\/([^/]+)\//);
    if (m && m[1]) return m[1];
  }
  return undefined;
}

/**
 * Pull preview-bundle fields off the latest deck-creation call's
 * output (issue #272). Both the intermediate `DeckCreationSnapshot`
 * and the final lean `DeckDraftToolSuccess` shape carry
 * `previewStatus` / `previewUrl` / `previewError` since #271, so a
 * single helper handles the union without re-narrowing each shape.
 *
 * Returns an empty object when no preview status has been reported
 * yet — the `<RenderedDraftPreview>` component then renders its
 * idle explainer.
 */
interface PreviewFields {
  previewStatus?: PreviewStatus;
  previewUrl?: string;
  previewError?: string;
}

function extractPreviewFields(call: DeckCreationCall | null): PreviewFields {
  if (!call) return {};
  const out = call.output;
  if (!out || typeof out !== "object") return {};
  const obj = out as unknown as Record<string, unknown>;
  const result: PreviewFields = {};
  const status = obj.previewStatus;
  if (status === "building" || status === "ready" || status === "error") {
    result.previewStatus = status;
  }
  if (typeof obj.previewUrl === "string" && obj.previewUrl.length > 0) {
    result.previewUrl = obj.previewUrl;
  }
  if (typeof obj.previewError === "string" && obj.previewError.length > 0) {
    result.previewError = obj.previewError;
  }
  return result;
}

/**
 * Left-pane container for `/admin/decks/new` (#272). Before any
 * deck-creation tool-call has landed (`call === null`), there's
 * nothing to preview — render the canvas + asset shelf stack
 * directly, matching the wave-2 / wave-3 layout. Once a call
 * exists, layer in a Source / Preview tab switcher.
 *
 * Both tab contents stay mounted across tab switches via CSS
 * visibility-toggling… actually no, we conditionally render each
 * tab's children so the canvas's streaming-aware state doesn't
 * keep firing layout work when off-screen. The iframe inside
 * `<RenderedDraftPreview>` uses `loading="lazy"` so its network
 * fetch only kicks off when it becomes visible.
 */
type PaneTab = "source" | "preview";

interface NewDeckLeftPaneProps {
  call: DeckCreationCall | null;
  inferredSlug: string | undefined;
  previewFields: PreviewFields;
  retryProps: { onRetry?: () => void };
  messages: ReadonlyArray<{
    id?: string;
    parts: Array<{ type: string; [k: string]: unknown }>;
  }>;
}

function NewDeckLeftPane({
  call,
  inferredSlug,
  previewFields,
  retryProps,
  messages,
}: NewDeckLeftPaneProps) {
  const [tab, setTab] = useState<PaneTab>("source");

  const hasCall = call !== null;

  // Pre-tool-call: no tabs, just the legacy stack. Avoids gratuitous
  // chrome before the user has even seen the model commit to a draft.
  if (!hasCall) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto">
        <DeckCreationCanvas
          messages={messages as Parameters<typeof DeckCreationCanvas>[0]["messages"]}
          {...retryProps}
        />
        <DraftAssetShelf slug={inferredSlug} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PaneTabs active={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "source" ? (
          <div className="flex h-full flex-col gap-4">
            <DeckCreationCanvas
              messages={messages as Parameters<typeof DeckCreationCanvas>[0]["messages"]}
              {...retryProps}
            />
            <DraftAssetShelf slug={inferredSlug} />
          </div>
        ) : (
          <div className="flex h-full flex-col p-1">
            <RenderedDraftPreview {...previewFields} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * SOURCE / PREVIEW tab switcher (#272). Mono caps labels in the
 * existing Studio voice. Uses `role="tablist"` / `role="tab"` so
 * screen readers announce it as a tab control; the panes themselves
 * are conditionally rendered (not always-mounted with `aria-hidden`)
 * so we don't bother with `tabpanel` wiring.
 */
function PaneTabs({
  active,
  onChange,
}: {
  active: PaneTab;
  onChange: (next: PaneTab) => void;
}) {
  const TABS: Array<{ value: PaneTab; label: string }> = [
    { value: "source", label: "Source" },
    { value: "preview", label: "Preview" },
  ];
  return (
    <div
      data-testid="new-deck-pane-tabs"
      role="tablist"
      aria-label="Draft view"
      className="flex items-center gap-1 self-start rounded-md border border-cf-border bg-cf-bg-200 p-0.5"
    >
      {TABS.map((t) => {
        const isActive = t.value === active;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            data-testid={`new-deck-pane-tab-${t.value}`}
            aria-selected={isActive}
            data-interactive
            onClick={() => onChange(t.value)}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
              isActive
                ? "bg-cf-orange text-cf-bg-100"
                : "text-cf-text-muted hover:text-cf-text"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Two-button segmented control for picking the new deck's
 * visibility. Visually mirrors the `<SettingsSegmentedRow>` style
 * (mono caps labels, orange-fill active, dashed-border hover)
 * so it reads as part of the same UI family.
 *
 * Kept inline rather than reused from `SettingsModal.tsx` because
 * that one is a row-shaped container; this one is a standalone
 * control on its own row with a visible header label.
 */
function VisibilitySelector({
  value,
  onChange,
}: {
  value: DeckVisibility;
  onChange: (next: DeckVisibility) => void;
}) {
  const OPTIONS: Array<{
    value: DeckVisibility;
    label: string;
    icon: typeof Globe;
    helper: string;
  }> = [
    {
      value: "private",
      label: "Private",
      icon: Lock,
      helper: "Only you can see this deck once published.",
    },
    {
      value: "public",
      label: "Public",
      icon: Globe,
      helper: "Anyone with the link can see this deck once published.",
    },
  ];

  return (
    <div
      data-testid="new-deck-visibility"
      className="flex flex-col gap-2"
      role="radiogroup"
      aria-label="Deck visibility"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-muted">
        Visibility
      </p>
      <div className="flex items-center gap-1 self-start rounded-md border border-cf-border bg-cf-bg-200 p-0.5">
        {OPTIONS.map((opt) => {
          const isActive = opt.value === value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              data-testid={`new-deck-visibility-${opt.value}`}
              onClick={() => onChange(opt.value)}
              title={opt.helper}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                isActive
                  ? "bg-cf-orange text-cf-bg-100"
                  : "text-cf-text-muted hover:text-cf-text"
              }`}
            >
              <Icon size={11} aria-hidden="true" />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Static chip that replaces the interactive `<VisibilitySelector>`
 * once the deck-creation canvas pivots in (issue #178 polish). Purely
 * informational — no role, no button, no click handler. Shows the
 * chosen visibility so the user can still see what they picked, but
 * makes clear it's no longer changeable from this surface.
 *
 * Visually distinct from the active state of the segmented control:
 * a muted pill (border + muted text) rather than the orange fill, so
 * the eye reads it as "summary" not "active choice in a control".
 */
function VisibilityChip({ value }: { value: DeckVisibility }) {
  const Icon = value === "private" ? Lock : Globe;
  const label = value === "private" ? "Private" : "Public";
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-muted">
        Visibility
      </p>
      <span
        data-testid="new-deck-visibility-chip"
        data-value={value}
        className="inline-flex w-fit items-center gap-1.5 rounded-md border border-cf-border bg-cf-bg-200 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-muted"
      >
        <Icon size={11} aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}
