/**
 * `<RenderedDraftPreview>` — left-pane Preview tab content on
 * `/admin/decks/new`. Renders one of four mutually exclusive states
 * driven by the preview-bundle build status (issue #271) that the
 * deck-creation snapshot and final lean tool result now carry
 * (`previewStatus` / `previewUrl` / `previewError`):
 *
 *   - `idle`     — no preview attempted yet. Explainer copy: the
 *                  iframe will appear after the first build.
 *   - `building` — preview build in flight. Quiet pulse cue; no
 *                  iframe (the URL would 404 mid-build).
 *   - `error`    — preview build failed. Show the redacted error
 *                  message, and clarify that the draft itself may
 *                  still be ok (preview failure is non-destructive).
 *   - `ready`    — preview bundle uploaded. Render an iframe pointing
 *                  at the Access-gated `/preview/<id>/<sha>/*` URL.
 *
 * # Iframe sandbox model
 *
 * We treat the framed deck bundle as UNTRUSTED content even though
 * it lives behind Cloudflare Access on the same origin as the admin
 * surface. Two reasons:
 *
 *   1. Defence in depth. The model wrote the JSX inside the bundle;
 *      it's our responsibility to make sure nothing the model emits
 *      can read the parent's cookies / localStorage / sessionStorage.
 *   2. Future expansion. If we ever expose this preview to non-admin
 *      viewers, the sandbox semantics already match.
 *
 * Therefore:
 *
 *   - `sandbox="allow-scripts"` is the ONLY token applied by default.
 *     The deck bundle is a React SPA; without `allow-scripts` it
 *     won't hydrate and the preview is dead.
 *   - `allow-same-origin` is deliberately omitted. That token would
 *     let the framed bundle act with the parent origin's privileges
 *     (read cookies, hit `/api/admin/*`, etc.). We never want that.
 *   - Other capabilities (`allow-forms`, `allow-popups`, …) are
 *     omitted until a specific deck primitive demands them.
 *
 * Issue #272.
 */

import type { PreviewStatus } from "@/lib/deck-creation-snapshot";

export interface RenderedDraftPreviewProps {
  /** Build-status marker; `undefined` while no preview has been attempted yet. */
  previewStatus?: PreviewStatus;
  /** Set when `previewStatus === "ready"`; the Access-gated `/preview/<id>/<sha>/index.html` URL. */
  previewUrl?: string;
  /** Set when `previewStatus === "error"`; a redacted, UI-safe message. */
  previewError?: string;
}

/**
 * Pure rendering: no fetches, no effects. The route is responsible
 * for pulling the latest preview fields off the deck-creation
 * snapshot / lean tool result and forwarding them here.
 */
export function RenderedDraftPreview({
  previewStatus,
  previewUrl,
  previewError,
}: RenderedDraftPreviewProps) {
  // Defensive: "ready" without a URL collapses to idle so we don't
  // render an `<iframe src="">` (which would resolve to the parent
  // location — a guaranteed misrender).
  const effectiveState: "idle" | "building" | "error" | "ready" =
    previewStatus === "building"
      ? "building"
      : previewStatus === "error"
      ? "error"
      : previewStatus === "ready" && previewUrl
      ? "ready"
      : "idle";

  if (effectiveState === "ready") {
    return (
      <div
        data-testid="rendered-draft-preview"
        data-state="ready"
        className="flex h-full flex-col overflow-hidden rounded-lg border border-cf-text/10 bg-cf-bg-100"
      >
        <iframe
          data-testid="rendered-draft-preview-iframe"
          src={previewUrl}
          title="Rendered draft deck preview"
          aria-label="Rendered draft deck preview"
          // SECURITY: allow-scripts ONLY. See the file-level comment
          // — never add `allow-same-origin` without a thoroughly
          // documented exception.
          sandbox="allow-scripts"
          className="h-full w-full flex-1 border-0 bg-cf-bg-100"
          // `loading="lazy"` keeps the iframe from kicking off a
          // network fetch while the Source tab is active (the
          // route mounts the preview pane unconditionally and
          // toggles visibility, so without lazy loading we'd hit
          // the preview URL on first render).
          loading="lazy"
        />
      </div>
    );
  }

  if (effectiveState === "building") {
    return (
      <div
        data-testid="rendered-draft-preview"
        data-state="building"
        className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-cf-text/10 bg-cf-bg-100 p-6 text-sm text-cf-text-muted"
        role="status"
        aria-live="polite"
      >
        <span
          data-testid="rendered-draft-preview-building"
          className="font-mono text-[11px] uppercase tracking-[0.25em] text-cf-text-muted animate-pulse"
        >
          Building rendered preview…
        </span>
        <p className="max-w-sm text-center text-xs leading-relaxed text-cf-text-muted">
          The draft has been committed. We're bundling the deck so it can
          render here in a moment.
        </p>
      </div>
    );
  }

  if (effectiveState === "error") {
    return (
      <div
        data-testid="rendered-draft-preview"
        data-state="error"
        className="flex h-full flex-col items-start gap-3 rounded-lg border border-cf-orange/40 bg-cf-orange-light p-6 text-sm text-cf-text"
        role="alert"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-cf-orange">
          Preview build failed
        </p>
        <p
          data-testid="rendered-draft-preview-error"
          className="font-mono text-xs leading-relaxed text-cf-text"
        >
          {previewError && previewError.trim().length > 0
            ? previewError
            : "The preview bundle build failed. No additional detail was reported."}
        </p>
        <p className="text-xs leading-relaxed text-cf-text-muted">
          The draft itself was committed and may still be fine — only
          the rendered preview is unavailable. Iterate in chat to
          trigger another build.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="rendered-draft-preview"
      data-state="idle"
      className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-cf-text/10 bg-cf-bg-100 p-6 text-center text-sm text-cf-text-muted"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-cf-text-muted">
        Preview
      </p>
      <p className="max-w-sm text-xs leading-relaxed text-cf-text-muted">
        The rendered preview will appear here after the first build
        completes. Until then, watch the Source tab for the generated
        files and progress.
      </p>
    </div>
  );
}
