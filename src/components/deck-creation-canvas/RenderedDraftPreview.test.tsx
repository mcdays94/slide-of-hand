/**
 * Tests for `<RenderedDraftPreview>` — the rendered-preview pane that
 * appears in the left column of `/admin/decks/new` once the draft's
 * Artifacts commit has landed and the preview-bundle build (issue
 * #271) reports its status alongside the deck-creation snapshot or
 * final lean tool result.
 *
 * The component is a pure rendering of the four meaningful states:
 *
 *   - no status yet (preview not attempted / pre-build)
 *   - "building" — bundle build in flight
 *   - "error"    — build failed; the draft itself may still be ok
 *   - "ready"    — bundle uploaded; render an iframe pointing at
 *                  the Access-gated `/preview/<id>/<sha>/*` URL
 *
 * Security: the iframe MUST use a minimal sandbox. `allow-scripts`
 * is required (the bundled deck is a React SPA). `allow-same-origin`
 * is NOT applied by default — that would let the framed bundle
 * read the parent's cookies / localStorage / origin, which we
 * explicitly don't want even though the preview lives on the same
 * origin behind Access. The iframe is treated as untrusted content.
 *
 * Issue #272.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { RenderedDraftPreview } from "./RenderedDraftPreview";

afterEach(() => {
  cleanup();
});

describe("<RenderedDraftPreview> — empty / pre-build state", () => {
  it("renders an idle explainer when no previewStatus is set", () => {
    render(<RenderedDraftPreview />);
    const pane = screen.getByTestId("rendered-draft-preview");
    expect(pane.getAttribute("data-state")).toBe("idle");
    // No iframe yet.
    expect(screen.queryByTestId("rendered-draft-preview-iframe")).toBeNull();
    // Explainer copy mentions that the preview will appear after the
    // first build. Keep it short — the route also handles this case
    // upstream, but the component must stand on its own.
    expect(pane.textContent ?? "").toMatch(/preview/i);
    expect(pane.textContent ?? "").toMatch(/build/i);
  });

  it("treats previewStatus === 'ready' but no previewUrl as idle (defensive)", () => {
    // Defensive degradation: the lean tool-result shape allows a
    // "ready" status without `previewUrl` to be set (shouldn't
    // happen in production, but the component is robust to it).
    render(<RenderedDraftPreview previewStatus="ready" />);
    const pane = screen.getByTestId("rendered-draft-preview");
    expect(pane.getAttribute("data-state")).toBe("idle");
    expect(screen.queryByTestId("rendered-draft-preview-iframe")).toBeNull();
  });
});

describe("<RenderedDraftPreview> — building", () => {
  it("renders a quiet building state with a pulse / spinner cue", () => {
    render(<RenderedDraftPreview previewStatus="building" />);
    const pane = screen.getByTestId("rendered-draft-preview");
    expect(pane.getAttribute("data-state")).toBe("building");
    // Visible building copy — used by tests and as the live-region
    // label so screen-reader users know what's happening.
    expect(
      screen.getByTestId("rendered-draft-preview-building"),
    ).toBeDefined();
    expect(pane.textContent ?? "").toMatch(/building/i);
    // No iframe rendered while the bundle is still being built —
    // pointing at an in-flight preview URL would 404.
    expect(screen.queryByTestId("rendered-draft-preview-iframe")).toBeNull();
  });
});

describe("<RenderedDraftPreview> — error", () => {
  it("renders the preview error message and clarifies the draft itself may still exist", () => {
    render(
      <RenderedDraftPreview
        previewStatus="error"
        previewError="esbuild failed: Unexpected token at slide.tsx:14"
      />,
    );
    const pane = screen.getByTestId("rendered-draft-preview");
    expect(pane.getAttribute("data-state")).toBe("error");
    const err = screen.getByTestId("rendered-draft-preview-error");
    expect(err.textContent ?? "").toMatch(/esbuild failed/);
    // The pane copy should make clear the draft itself may still be
    // fine — preview failure is non-destructive. This is important
    // for user trust: a red "error" without context reads as "your
    // work was lost".
    expect(pane.textContent ?? "").toMatch(/draft/i);
    expect(screen.queryByTestId("rendered-draft-preview-iframe")).toBeNull();
  });

  it("falls back to a generic message when previewError is omitted", () => {
    render(<RenderedDraftPreview previewStatus="error" />);
    const err = screen.getByTestId("rendered-draft-preview-error");
    // Some generic copy; the exact wording isn't load-bearing —
    // what matters is that we don't render an empty string.
    expect((err.textContent ?? "").trim().length).toBeGreaterThan(0);
  });
});

describe("<RenderedDraftPreview> — ready with iframe", () => {
  it("renders an iframe pointing at the preview URL when ready", () => {
    render(
      <RenderedDraftPreview
        previewStatus="ready"
        previewUrl="/preview/test-com-hello/abcd123/index.html"
      />,
    );
    const pane = screen.getByTestId("rendered-draft-preview");
    expect(pane.getAttribute("data-state")).toBe("ready");
    const iframe = screen.getByTestId(
      "rendered-draft-preview-iframe",
    ) as HTMLIFrameElement;
    expect(iframe.tagName.toLowerCase()).toBe("iframe");
    expect(iframe.getAttribute("src")).toBe(
      "/preview/test-com-hello/abcd123/index.html",
    );
  });

  it("uses a minimal sandbox: allow-scripts only, NO allow-same-origin by default", () => {
    render(
      <RenderedDraftPreview
        previewStatus="ready"
        previewUrl="/preview/x/y/index.html"
      />,
    );
    const iframe = screen.getByTestId(
      "rendered-draft-preview-iframe",
    ) as HTMLIFrameElement;
    const sandbox = iframe.getAttribute("sandbox");
    // Must be present (sandbox absence = full privileges; never allow that).
    expect(sandbox).not.toBeNull();
    // Must include allow-scripts — otherwise the React bundle can't
    // hydrate and the preview is dead.
    expect((sandbox ?? "").split(/\s+/)).toContain("allow-scripts");
    // Must NOT include allow-same-origin — the framed bundle is
    // treated as untrusted content. Even though it lives behind
    // Access on the same origin, we don't want it reading cookies
    // / localStorage / sessionStorage from the parent admin window.
    expect((sandbox ?? "").split(/\s+/)).not.toContain("allow-same-origin");
  });

  it("gives the iframe a descriptive title for accessibility", () => {
    render(
      <RenderedDraftPreview
        previewStatus="ready"
        previewUrl="/preview/x/y/index.html"
      />,
    );
    const iframe = screen.getByTestId(
      "rendered-draft-preview-iframe",
    ) as HTMLIFrameElement;
    // Title attribute is what screen readers announce.
    const title = iframe.getAttribute("title") ?? "";
    expect(title.length).toBeGreaterThan(0);
    expect(title.toLowerCase()).toMatch(/preview/);
  });
});
