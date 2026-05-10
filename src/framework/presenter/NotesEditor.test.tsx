/**
 * Tests for the speaker-notes auth gate (issue #120).
 *
 * The presenter view is public, so the speaker-notes editor needs to
 * downgrade to a read-only view when the visitor doesn't have a valid
 * Cloudflare Access session. These tests pin the contract:
 *
 *   - while the auth probe is in flight (status="checking"), the
 *     editor renders read-only (no flash of editable UI).
 *   - status="unauthenticated" → no formatting toolbar, no reset
 *     button, contentEditable=false, textarea readOnly, and a
 *     "sign in via /admin" banner.
 *   - status="authenticated" → full editor (today's behaviour).
 *
 * The auth probe is mocked via `globalThis.fetch`. Each test sets up
 * its own response so the hook's `useEffect` resolves predictably.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NotesEditor } from "./NotesEditor";

const SLUG = "test-deck";
const SLIDE_INDEX = 0;

function mockAuthFetch(
  outcome:
    | { kind: "authenticated" }
    | { kind: "unauthenticated-redirect" }
    | { kind: "unauthenticated-403" }
    | { kind: "never-resolves" },
) {
  if (outcome.kind === "never-resolves") {
    globalThis.fetch = vi.fn(
      () => new Promise<Response>(() => {}),
    ) as unknown as typeof fetch;
    return;
  }
  globalThis.fetch = vi.fn(async () => {
    if (outcome.kind === "authenticated") {
      return new Response(
        JSON.stringify({ authenticated: true, email: "a@cloudflare.com" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (outcome.kind === "unauthenticated-redirect") {
      const r = new Response(null, { status: 0 });
      return Object.assign(r, { type: "opaqueredirect" as ResponseType });
    }
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("<NotesEditor> auth gate (#120)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    window.localStorage.clear();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders read-only by default while the auth probe is in flight", () => {
    mockAuthFetch({ kind: "never-resolves" });
    render(
      <NotesEditor
        slug={SLUG}
        slideIndex={SLIDE_INDEX}
        defaultNotes={<p>Default notes here.</p>}
        fontSizeClass="text-sm"
      />,
    );
    const editor = screen.getByTestId("notes-editor");
    expect(editor.getAttribute("data-auth-status")).toBe("checking");
    expect(editor.getAttribute("data-can-edit")).toBe("false");
    // Formatting toolbar is hidden during checking.
    expect(screen.queryByTestId("notes-toolbar-bold")).toBeNull();
    expect(screen.queryByTestId("notes-toolbar-italic")).toBeNull();
    // The rich editor is contenteditable=false.
    const rich = screen.getByTestId("notes-rich-editor");
    expect(rich.getAttribute("contenteditable")).toBe("false");
  });

  it("renders read-only with sign-in banner when unauthenticated (Access redirect)", async () => {
    mockAuthFetch({ kind: "unauthenticated-redirect" });
    render(
      <NotesEditor
        slug={SLUG}
        slideIndex={SLIDE_INDEX}
        defaultNotes={<p>Default notes here.</p>}
        fontSizeClass="text-sm"
      />,
    );
    await waitFor(() => {
      const editor = screen.getByTestId("notes-editor");
      expect(editor.getAttribute("data-auth-status")).toBe("unauthenticated");
    });
    expect(screen.getByTestId("notes-readonly-banner")).toBeTruthy();
    const link = screen.getByTestId("notes-readonly-signin-link");
    expect(link.getAttribute("href")).toBe("/admin");
    // Toolbar hidden, reset button hidden.
    expect(screen.queryByTestId("notes-toolbar-bold")).toBeNull();
    expect(screen.queryByTestId("notes-reset")).toBeNull();
    // Editor disabled.
    const rich = screen.getByTestId("notes-rich-editor");
    expect(rich.getAttribute("contenteditable")).toBe("false");
    expect(rich.getAttribute("aria-readonly")).toBe("true");
  });

  it("renders read-only when the probe returns 403 (Access misconfig defense-in-depth)", async () => {
    mockAuthFetch({ kind: "unauthenticated-403" });
    render(
      <NotesEditor
        slug={SLUG}
        slideIndex={SLIDE_INDEX}
        defaultNotes={<p>Default.</p>}
        fontSizeClass="text-sm"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("notes-editor").getAttribute("data-auth-status"),
      ).toBe("unauthenticated"),
    );
    expect(screen.getByTestId("notes-readonly-banner")).toBeTruthy();
  });

  it("renders the full editor (toolbar visible, contenteditable=true) when authenticated", async () => {
    mockAuthFetch({ kind: "authenticated" });
    render(
      <NotesEditor
        slug={SLUG}
        slideIndex={SLIDE_INDEX}
        defaultNotes={<p>Default.</p>}
        fontSizeClass="text-sm"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("notes-editor").getAttribute("data-auth-status"),
      ).toBe("authenticated"),
    );
    // No banner.
    expect(screen.queryByTestId("notes-readonly-banner")).toBeNull();
    // Formatting toolbar visible.
    expect(screen.getByTestId("notes-toolbar-bold")).toBeTruthy();
    expect(screen.getByTestId("notes-toolbar-italic")).toBeTruthy();
    expect(screen.getByTestId("notes-toolbar-h2")).toBeTruthy();
    // contentEditable=true.
    const rich = screen.getByTestId("notes-rich-editor");
    expect(rich.getAttribute("contenteditable")).toBe("true");
  });

  it("does not show the reset button to unauthenticated callers even with a localStorage override present", async () => {
    // Seed an override directly so the editor would normally show the
    // reset button.
    window.localStorage.setItem(
      `slide-of-hand-notes:${SLUG}:${SLIDE_INDEX}`,
      "edited markdown",
    );
    mockAuthFetch({ kind: "unauthenticated-redirect" });
    render(
      <NotesEditor
        slug={SLUG}
        slideIndex={SLIDE_INDEX}
        defaultNotes={<p>Default.</p>}
        fontSizeClass="text-sm"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("notes-editor").getAttribute("data-auth-status"),
      ).toBe("unauthenticated"),
    );
    expect(screen.queryByTestId("notes-reset")).toBeNull();
  });

  it("shows the markdown textarea as readOnly when unauthenticated", async () => {
    mockAuthFetch({ kind: "unauthenticated-redirect" });
    render(
      <NotesEditor
        slug={SLUG}
        slideIndex={SLIDE_INDEX}
        defaultNotes={<p>Default.</p>}
        fontSizeClass="text-sm"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("notes-editor").getAttribute("data-auth-status"),
      ).toBe("unauthenticated"),
    );
    // Switch to markdown mode (toggle is always available).
    const mdToggle = screen.getByTestId("notes-mode-markdown");
    act(() => {
      mdToggle.click();
    });
    const textarea = screen.getByTestId("notes-markdown-editor");
    expect(textarea.hasAttribute("readonly")).toBe(true);
  });
});
