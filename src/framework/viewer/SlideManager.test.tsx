/**
 * Behavioural tests for `<SlideManager>`.
 *
 * Drag-and-drop is not exercised here — `@dnd-kit` is hard to drive
 * from JSDOM/happy-dom and the visual probe protocol covers the actual
 * drag UX. We focus on:
 *   - rendering the source slide list
 *   - hidden toggle propagates to draft
 *   - title edit propagates
 *   - notes editor expands and persists into draft
 *   - Save calls the correct API
 *   - Reset calls the correct API
 *   - Close calls the callback
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SlideManager } from "./SlideManager";
import { richtextProseClasses } from "@/templates/richtext-prose";
import type { SlideDef } from "./types";
import type { UseDeckManifestResult } from "./useDeckManifest";
import type { Manifest } from "@/lib/manifest";

function s(id: string, title?: string): SlideDef {
  return { id, title: title ?? id, render: () => null };
}

const sourceSlides: SlideDef[] = [
  s("title", "Title"),
  s("intro", "Intro"),
  s("end", "End"),
];

function makeManifestHook(
  overrides: Partial<UseDeckManifestResult> = {},
): UseDeckManifestResult {
  return {
    manifest: null,
    updatedAt: null,
    isLoading: false,
    applied: null,
    applyDraft: vi.fn(),
    clearDraft: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        manifest: null,
      }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<SlideManager>", () => {
  it("does not render when closed", () => {
    render(
      <SlideManager
        open={false}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId("slide-manager")).not.toBeInTheDocument();
  });

  it("renders the source slide list when open", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("slide-manager")).toBeInTheDocument();
    // Each slide should appear in a row.
    expect(screen.getByDisplayValue("Title")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Intro")).toBeInTheDocument();
    expect(screen.getByDisplayValue("End")).toBeInTheDocument();
  });

  it("editing a title input pushes a draft via applyDraft", () => {
    const applyDraft = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({ applyDraft })}
        onClose={() => {}}
      />,
    );
    const introInput = screen.getByDisplayValue("Intro");
    fireEvent.change(introInput, { target: { value: "Renamed Intro" } });
    expect(applyDraft).toHaveBeenCalled();
    const last = applyDraft.mock.calls.at(-1)?.[0] as Manifest;
    expect(last.overrides.intro?.title).toBe("Renamed Intro");
  });

  it("toggling hidden propagates to applyDraft", () => {
    const applyDraft = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({ applyDraft })}
        onClose={() => {}}
      />,
    );
    const toggle = screen.getAllByTestId("slide-manager-toggle-hidden")[1];
    fireEvent.click(toggle);
    const last = applyDraft.mock.calls.at(-1)?.[0] as Manifest;
    expect(last.overrides.intro?.hidden).toBe(true);
  });

  it("expanding a notes button reveals a textarea, edits propagate", () => {
    const applyDraft = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({ applyDraft })}
        onClose={() => {}}
      />,
    );
    const notesButton = screen.getAllByTestId("slide-manager-toggle-notes")[1];
    fireEvent.click(notesButton);
    const textarea = screen.getByTestId("slide-manager-notes-editor");
    fireEvent.change(textarea, { target: { value: "**bold**" } });
    const last = applyDraft.mock.calls.at(-1)?.[0] as Manifest;
    expect(last.overrides.intro?.notes).toBe("**bold**");
  });

  it("renders notes preview with the canonical richtextProseClasses helper", () => {
    // The notes preview pane and the public viewer share the same prose
    // styling contract via `richtextProseClasses` (#90). Inert
    // `prose prose-sm` strings would silently no-op without
    // `@tailwindcss/typography` installed, so we assert the helper's
    // tokens are present on the rendered preview container — guarding
    // against future regressions back to the inert classes.
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({
          manifest: {
            version: 1,
            order: ["title", "intro", "end"],
            overrides: { intro: { notes: "- one\n- two" } },
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
        })}
        onClose={() => {}}
      />,
    );
    // Open the notes editor for the intro row, then switch to preview.
    fireEvent.click(screen.getAllByTestId("slide-manager-toggle-notes")[1]);
    fireEvent.click(screen.getByTestId("slide-manager-notes-tab-preview"));
    const preview = screen.getByTestId("slide-manager-notes-preview");
    const className = preview.className;
    // Spot-check several distinctive tokens from the helper.
    expect(className).toContain("[&_ul]:list-disc");
    expect(className).toContain("[&_li]:marker:text-cf-orange");
    expect(className).toContain("[&_strong]:font-medium");
    expect(className).toContain("[&_code]:font-mono");
    // Belt-and-braces: the full helper string should be a substring.
    expect(className).toContain(richtextProseClasses);
    // The inert Tailwind-typography classes must be gone — they silently
    // no-op without the plugin installed.
    expect(className).not.toMatch(/(^|\s)prose(\s|$)/);
    expect(className).not.toMatch(/(^|\s)prose-sm(\s|$)/);
  });

  it("Save POSTs to the admin API and refetches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ manifest: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const refetch = vi.fn().mockResolvedValue(undefined);

    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({ refetch })}
        onClose={() => {}}
      />,
    );

    // Make a change so Save isn't disabled.
    const introInput = screen.getByDisplayValue("Intro");
    fireEvent.change(introInput, { target: { value: "Renamed" } });

    fireEvent.click(screen.getByTestId("slide-manager-save"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/manifests/hello");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.order).toEqual(["title", "intro", "end"]);
    expect(body.overrides.intro.title).toBe("Renamed");
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("Reset DELETEs the manifest and clears the draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    const refetch = vi.fn().mockResolvedValue(undefined);
    const clearDraft = vi.fn();

    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({
          manifest: {
            version: 1,
            order: ["title", "intro", "end"],
            overrides: {},
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
          refetch,
          clearDraft,
        })}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("slide-manager-reset"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/manifests/hello");
    expect(init.method).toBe("DELETE");
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(clearDraft).toHaveBeenCalled();
  });

  it("Close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("slide-manager-close"));
    expect(onClose).toHaveBeenCalled();
  });

  // ── ToC nav row click (#207) ──────────────────────────────────────
  // The admin sidebar lets the author click any row — including a
  // Hidden one — to jump the deck cursor to that slide's effective
  // index. Per ADR 0003, the cursor is keyed against the effective
  // slides list (Hidden included), so clicking a Hidden row navigates
  // WITHOUT un-hiding it.

  it("clicking a non-hidden row calls onNavigateToSlide with its effective index", () => {
    const onNavigateToSlide = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        onNavigateToSlide={onNavigateToSlide}
      />,
    );
    const rows = screen.getAllByTestId("slide-manager-row");
    // Click the second row's container directly (not via an inner control).
    fireEvent.click(rows[1]);
    expect(onNavigateToSlide).toHaveBeenCalledTimes(1);
    expect(onNavigateToSlide).toHaveBeenCalledWith(1);
  });

  it("clicking a Hidden row navigates AND keeps the manifest hidden flag", () => {
    const onNavigateToSlide = vi.fn();
    const applyDraft = vi.fn();
    const applied: Manifest = {
      version: 1,
      order: ["title", "intro", "end"],
      overrides: { intro: { hidden: true } },
      updatedAt: "2026-05-14T00:00:00.000Z",
    };
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({ manifest: applied, applied, applyDraft })}
        onClose={() => {}}
        onNavigateToSlide={onNavigateToSlide}
      />,
    );

    // applyDraft fires once on mount with the seeded rows; capture the
    // baseline call count so we can prove the row click did not push a
    // fresh draft that mutates the hidden flag.
    const baselineDraftCalls = applyDraft.mock.calls.length;

    const rows = screen.getAllByTestId("slide-manager-row");
    // intro is index 1 in the applied manifest order.
    const hiddenRow = rows[1];
    expect(hiddenRow).toHaveAttribute("data-hidden", "true");

    fireEvent.click(hiddenRow);

    expect(onNavigateToSlide).toHaveBeenCalledTimes(1);
    expect(onNavigateToSlide).toHaveBeenCalledWith(1);
    // Click must NOT push a manifest draft (would mean the hidden flag
    // mutated as a side-effect of nav).
    expect(applyDraft.mock.calls.length).toBe(baselineDraftCalls);
  });

  it("clicking the rename input focuses it without navigating", () => {
    const onNavigateToSlide = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        onNavigateToSlide={onNavigateToSlide}
      />,
    );
    const input = screen.getByDisplayValue("Intro");
    fireEvent.click(input);
    expect(onNavigateToSlide).not.toHaveBeenCalled();
  });

  it("clicking the Hide button toggles hidden without navigating", () => {
    const onNavigateToSlide = vi.fn();
    const applyDraft = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({ applyDraft })}
        onClose={() => {}}
        onNavigateToSlide={onNavigateToSlide}
      />,
    );
    const hideButton = screen.getAllByTestId("slide-manager-toggle-hidden")[1];
    fireEvent.click(hideButton);
    expect(onNavigateToSlide).not.toHaveBeenCalled();
    const last = applyDraft.mock.calls.at(-1)?.[0] as Manifest;
    expect(last.overrides.intro?.hidden).toBe(true);
  });

  it("clicking the Notes button expands notes without navigating", () => {
    const onNavigateToSlide = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        onNavigateToSlide={onNavigateToSlide}
      />,
    );
    const notesButton = screen.getAllByTestId("slide-manager-toggle-notes")[1];
    fireEvent.click(notesButton);
    expect(onNavigateToSlide).not.toHaveBeenCalled();
    expect(screen.getByTestId("slide-manager-notes-editor")).toBeInTheDocument();
  });

  it("clicking the drag handle does not navigate", () => {
    const onNavigateToSlide = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        onNavigateToSlide={onNavigateToSlide}
      />,
    );
    const dragHandle = screen.getAllByTestId("slide-manager-drag-handle")[1];
    fireEvent.click(dragHandle);
    expect(onNavigateToSlide).not.toHaveBeenCalled();
  });

  it("renders rows with no navigate affordance when onNavigateToSlide is omitted", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    const rows = screen.getAllByTestId("slide-manager-row");
    // No role="button" / aria-label when nav isn't wired.
    expect(rows[0]).not.toHaveAttribute("role", "button");
    // Click should be a no-op (no crash, no callback to call).
    fireEvent.click(rows[0]);
  });

  it("hidden rows get muted text + line-through styling on the title", () => {
    const applied: Manifest = {
      version: 1,
      order: ["title", "intro", "end"],
      overrides: { intro: { hidden: true } },
      updatedAt: "2026-05-14T00:00:00.000Z",
    };
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({ manifest: applied, applied })}
        onClose={() => {}}
      />,
    );
    const rows = screen.getAllByTestId("slide-manager-row");
    expect(rows[0]).not.toHaveAttribute("data-hidden");
    expect(rows[1]).toHaveAttribute("data-hidden", "true");
    // The row itself carries the muted color; line-through is scoped
    // to the title input so HIDE / NOTES buttons stay readable.
    expect(rows[1].className).toContain("text-cf-text-subtle");

    const inputs = screen.getAllByTestId("slide-manager-title-input");
    expect(inputs[1].className).toContain("line-through");
    expect(inputs[1].className).toContain("text-cf-text-subtle");
    // Non-hidden rows keep the default text-cf-text color, no strike.
    expect(inputs[0].className).not.toContain("line-through");
    expect(inputs[0].className).toContain("text-cf-text");
  });

  it("source-level Hidden slides (no manifest override) are also rendered muted", () => {
    const sourceWithHidden: SlideDef[] = [
      s("title", "Title"),
      { ...s("intro", "Intro"), hidden: true },
      s("end", "End"),
    ];
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceWithHidden}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    const rows = screen.getAllByTestId("slide-manager-row");
    expect(rows[1]).toHaveAttribute("data-hidden", "true");
    expect(rows[1].className).toContain("text-cf-text-subtle");
    const inputs = screen.getAllByTestId("slide-manager-title-input");
    expect(inputs[1].className).toContain("line-through");
  });

  it("renders applied manifest order when one exists", () => {
    const applied: Manifest = {
      version: 1,
      order: ["end", "title", "intro"],
      overrides: { title: { title: "Renamed" } },
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook({ manifest: applied, applied })}
        onClose={() => {}}
      />,
    );
    const inputs = screen.getAllByTestId("slide-manager-title-input");
    // Order should be end, title, intro per the applied manifest.
    // (title row is overridden to "Renamed".)
    expect((inputs[0] as HTMLInputElement).value).toBe("End");
    expect((inputs[1] as HTMLInputElement).value).toBe("Renamed");
    expect((inputs[2] as HTMLInputElement).value).toBe("Intro");
  });
});
