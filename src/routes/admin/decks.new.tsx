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
import { ArrowLeft } from "lucide-react";

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

export default function NewDeckRoute() {
  const navigate = useNavigate();
  // Lazy init so the UUID is computed exactly once per mount.
  const [agentName] = useState(makeNewDeckAgentName);

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
          <p className="cf-tag">New deck</p>
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

      {/* The panel. `flex-1` so it fills the rest of the viewport
          below the page header. The lazy boundary mirrors the
          existing mounts in Deck.tsx / EditMode.tsx — the bundle is
          ~300 KB and we don't want it in the initial paint of
          static admin pages. */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Suspense fallback={null}>
          <StudioAgentPanel
            deckSlug={agentName}
            variant="page"
            emptyState={{
              title: "What deck would you like to build?",
              description:
                "Describe a topic in plain language — e.g. \"a deck about CRDT collaborative editing for an engineering audience, ~25 min, five slides.\" I'll pick a slug, write the slides, and save the result to your scratch space.",
            }}
            onClose={() => navigate("/admin")}
          />
        </Suspense>
      </div>
    </main>
  );
}
