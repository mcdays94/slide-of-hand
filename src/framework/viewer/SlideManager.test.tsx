/**
 * Behavioural tests for `<SlideManager>` (a.k.a. ToC sidebar).
 *
 * Drag-and-drop is not exercised here — `@dnd-kit` is hard to drive
 * from JSDOM/happy-dom and the visual probe protocol covers the actual
 * drag UX. We focus on:
 *   - rendering the source slide list (titles as spans)
 *   - hidden toggle propagates to draft
 *   - pencil → input swap; title edit propagates; Enter / Esc / blur
 *   - notes editor expands and persists into draft (accordion)
 *   - Save calls the correct API
 *   - Reset calls the correct API
 *   - Close calls the callback
 *   - ToC nav row click — including suppression on inner affordances
 *   - Hidden row styling (muted text + line-through on the title)
 *   - Hover affordance cluster — DOM presence + ARIA wiring
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

/**
 * Helper: click the pencil affordance for the row at `rowIndex` to flip
 * it into title-edit mode, then return the now-rendered <input>.
 *
 * In the new (#208) layout the rename input is no longer always-present;
 * the row renders a span by default and an input only after the pencil
 * is clicked. Tests that exercise rename behaviour go through this.
 */
function openTitleEditor(rowIndex: number): HTMLInputElement {
  const pencils = screen.getAllByTestId("slide-manager-edit-title");
  fireEvent.click(pencils[rowIndex]);
  return screen.getByTestId("slide-manager-title-input") as HTMLInputElement;
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
    // Each slide should appear in a row, rendered as a title span by default.
    const titles = screen.getAllByTestId("slide-manager-title-display");
    expect(titles).toHaveLength(3);
    expect(titles[0]).toHaveTextContent("Title");
    expect(titles[1]).toHaveTextContent("Intro");
    expect(titles[2]).toHaveTextContent("End");
    // No rename input is mounted by default.
    expect(
      screen.queryByTestId("slide-manager-title-input"),
    ).not.toBeInTheDocument();
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
    // Click the pencil for the intro row to flip the title into an input.
    const introInput = openTitleEditor(1);
    expect(introInput.value).toBe("Intro");
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

    // Make a change so Save isn't disabled — go through the pencil flow.
    const introInput = openTitleEditor(1);
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
    // Enter title-edit mode for the intro row, then click the input.
    const input = openTitleEditor(1);
    // The pencil click itself uses `data-interactive` so it doesn't
    // bubble to the row's nav; reset the spy after the pencil click so
    // we're specifically asserting the input-click is also suppressed.
    onNavigateToSlide.mockClear();
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
    // to the title span/input so HIDE / NOTES buttons stay readable.
    expect(rows[1].className).toContain("text-cf-text-subtle");

    const titles = screen.getAllByTestId("slide-manager-title-display");
    expect(titles[1].className).toContain("line-through");
    expect(titles[1].className).toContain("text-cf-text-subtle");
    // Non-hidden rows keep the default text-cf-text color, no strike.
    expect(titles[0].className).not.toContain("line-through");
    expect(titles[0].className).toContain("text-cf-text");
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
    const titles = screen.getAllByTestId("slide-manager-title-display");
    expect(titles[1].className).toContain("line-through");
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
    const titles = screen.getAllByTestId("slide-manager-title-display");
    // Order should be end, title, intro per the applied manifest.
    // (title row is overridden to "Renamed".)
    expect(titles[0]).toHaveTextContent("End");
    expect(titles[1]).toHaveTextContent("Renamed");
    expect(titles[2]).toHaveTextContent("Intro");
  });

  // ── #208: hover-revealed affordance cluster + inline rename flow ─────

  it("does not render a rename input by default — only a title span", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    // Span exists for every row.
    expect(screen.getAllByTestId("slide-manager-title-display")).toHaveLength(3);
    // No input is mounted (the new layout's signature change).
    expect(
      screen.queryByTestId("slide-manager-title-input"),
    ).not.toBeInTheDocument();
  });

  it("clicking the pencil opens the inline rename input for that row", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    const pencils = screen.getAllByTestId("slide-manager-edit-title");
    // intro row.
    fireEvent.click(pencils[1]);

    const input = screen.getByTestId("slide-manager-title-input");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("Intro");
    // The row carries a data attribute so visual tests can target the
    // edit-active state without relying on input presence alone.
    const rows = screen.getAllByTestId("slide-manager-row");
    expect(rows[1]).toHaveAttribute("data-editing-title", "true");
    expect(rows[0]).not.toHaveAttribute("data-editing-title");
  });

  it("Enter commits the rename and dismisses the input", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    const input = openTitleEditor(1);
    fireEvent.change(input, { target: { value: "Renamed via Enter" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Input goes away; span shows the committed value.
    expect(
      screen.queryByTestId("slide-manager-title-input"),
    ).not.toBeInTheDocument();
    const titles = screen.getAllByTestId("slide-manager-title-display");
    expect(titles[1]).toHaveTextContent("Renamed via Enter");
  });

  it("blur commits the rename and dismisses the input", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    const input = openTitleEditor(1);
    fireEvent.change(input, { target: { value: "Renamed via Blur" } });
    fireEvent.blur(input);

    expect(
      screen.queryByTestId("slide-manager-title-input"),
    ).not.toBeInTheDocument();
    const titles = screen.getAllByTestId("slide-manager-title-display");
    expect(titles[1]).toHaveTextContent("Renamed via Blur");
  });

  it("Esc cancels the rename, reverts the title, and dismisses the input", () => {
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
    const input = openTitleEditor(1);
    fireEvent.change(input, { target: { value: "Throwaway edit" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // Input gone, span back to the original title.
    expect(
      screen.queryByTestId("slide-manager-title-input"),
    ).not.toBeInTheDocument();
    const titles = screen.getAllByTestId("slide-manager-title-display");
    expect(titles[1]).toHaveTextContent("Intro");

    // The last applyDraft must reflect the reverted state (no override on
    // intro's title). The intermediate "Throwaway edit" call is fine —
    // we care about the final committed manifest after Esc.
    const last = applyDraft.mock.calls.at(-1)?.[0] as Manifest;
    expect(last.overrides.intro?.title).toBeUndefined();
  });

  it("only one row can be in title-edit mode at a time", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    const pencils = screen.getAllByTestId("slide-manager-edit-title");
    fireEvent.click(pencils[0]);
    fireEvent.click(pencils[2]);

    const inputs = screen.getAllByTestId("slide-manager-title-input");
    // Only one input mounted at any time.
    expect(inputs).toHaveLength(1);
    const rows = screen.getAllByTestId("slide-manager-row");
    expect(rows[2]).toHaveAttribute("data-editing-title", "true");
    expect(rows[0]).not.toHaveAttribute("data-editing-title");
  });

  it("the notes accordion is rendered below the row (after the row's main flex)", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getAllByTestId("slide-manager-toggle-notes")[1]);
    const accordion = screen.getByTestId("slide-manager-notes-accordion");
    const rows = screen.getAllByTestId("slide-manager-row");
    // The accordion is a descendant of the intro row.
    expect(rows[1].contains(accordion)).toBe(true);
    // And it sits AFTER the title-row flex (the first child of the row).
    expect(rows[1].firstElementChild?.contains(accordion)).toBe(false);
  });

  it("the affordance cluster mounts for every row + carries the row's id", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    // One affordance cluster per row.
    const clusters = screen.getAllByTestId("slide-manager-affordances");
    expect(clusters).toHaveLength(3);
    // Each row contains its own cluster.
    const rows = screen.getAllByTestId("slide-manager-row");
    rows.forEach((row, i) => {
      expect(row.contains(clusters[i])).toBe(true);
    });
    // Each cluster contains the four expected affordances: grip, eye,
    // pencil, note. Per-row, in that order.
    rows.forEach((row) => {
      expect(
        row.querySelector("[data-testid='slide-manager-drag-handle']"),
      ).not.toBeNull();
      expect(
        row.querySelector("[data-testid='slide-manager-toggle-hidden']"),
      ).not.toBeNull();
      expect(
        row.querySelector("[data-testid='slide-manager-edit-title']"),
      ).not.toBeNull();
      expect(
        row.querySelector("[data-testid='slide-manager-toggle-notes']"),
      ).not.toBeNull();
    });
  });

  it("clicking the pencil does NOT bubble up to row-level navigation", () => {
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
    const pencil = screen.getAllByTestId("slide-manager-edit-title")[1];
    fireEvent.click(pencil);
    expect(onNavigateToSlide).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("slide-manager-title-input"),
    ).toBeInTheDocument();
  });
});

// ── #209: audience role ─────────────────────────────────────────────────
//
// On the public route the `<Deck>` mounts `<SlideManager role="audience">`
// for everyone. The sidebar shows a read-only ToC: rows of
// `[NN] [thumb] title` clickable for nav. Hidden slides are filtered out
// entirely. None of the admin affordances (drag handle, eye toggle,
// pencil, note icon) render — even on hover — and there is no save /
// reset footer.

describe("<SlideManager role='audience'>", () => {
  it("renders all source slides as rows when none are hidden", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        role="audience"
      />,
    );
    const rows = screen.getAllByTestId("slide-manager-row");
    expect(rows).toHaveLength(3);
    const titles = screen.getAllByTestId("slide-manager-title-display");
    expect(titles[0]).toHaveTextContent("Title");
    expect(titles[1]).toHaveTextContent("Intro");
    expect(titles[2]).toHaveTextContent("End");
    // The aside still mounts.
    expect(screen.getByTestId("slide-manager")).toHaveAttribute(
      "data-audience",
    );
  });

  it("filters out source-level Hidden slides entirely", () => {
    const withHidden: SlideDef[] = [
      s("title", "Title"),
      { ...s("intro", "Intro"), hidden: true },
      s("end", "End"),
    ];
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={withHidden}
        manifest={makeManifestHook()}
        onClose={() => {}}
        role="audience"
      />,
    );
    const rows = screen.getAllByTestId("slide-manager-row");
    expect(rows).toHaveLength(2);
    const titles = screen.getAllByTestId("slide-manager-title-display");
    expect(titles[0]).toHaveTextContent("Title");
    expect(titles[1]).toHaveTextContent("End");
    // Hidden row's id is absent.
    expect(
      rows.find((r) => r.getAttribute("data-slide-id") === "intro"),
    ).toBeUndefined();
  });

  it("filters out manifest-Hidden slides entirely", () => {
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
        role="audience"
      />,
    );
    const rows = screen.getAllByTestId("slide-manager-row");
    expect(rows).toHaveLength(2);
    expect(
      rows.find((r) => r.getAttribute("data-slide-id") === "intro"),
    ).toBeUndefined();
  });

  it("does NOT render any admin affordances (drag, eye, pencil, note)", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        role="audience"
      />,
    );
    expect(screen.queryByTestId("slide-manager-affordances")).toBeNull();
    expect(screen.queryByTestId("slide-manager-drag-handle")).toBeNull();
    expect(screen.queryByTestId("slide-manager-toggle-hidden")).toBeNull();
    expect(screen.queryByTestId("slide-manager-edit-title")).toBeNull();
    expect(screen.queryByTestId("slide-manager-toggle-notes")).toBeNull();
    // No save / reset footer either.
    expect(screen.queryByTestId("slide-manager-save")).toBeNull();
    expect(screen.queryByTestId("slide-manager-reset")).toBeNull();
  });

  it("clicking an audience row calls onNavigateToSlide with the slide's effective index", () => {
    const onNavigateToSlide = vi.fn();
    const withHidden: SlideDef[] = [
      s("title", "Title"),
      { ...s("intro", "Intro"), hidden: true },
      s("end", "End"),
    ];
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={withHidden}
        manifest={makeManifestHook()}
        onClose={() => {}}
        onNavigateToSlide={onNavigateToSlide}
        role="audience"
      />,
    );
    const rows = screen.getAllByTestId("slide-manager-row");
    // Row 0 is the "title" slide → effective index 0.
    fireEvent.click(rows[0]);
    expect(onNavigateToSlide).toHaveBeenLastCalledWith(0);
    // Row 1 is the "end" slide — its effective index is 2 (intro at 1
    // is hidden and was filtered out of the audience row list).
    fireEvent.click(rows[1]);
    expect(onNavigateToSlide).toHaveBeenLastCalledWith(2);
  });

  it("does not call onNavigateToSlide when the callback is omitted", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        role="audience"
      />,
    );
    // Sanity — no role="button" assigned when nav isn't wired.
    const rows = screen.getAllByTestId("slide-manager-row");
    expect(rows[0]).not.toHaveAttribute("role", "button");
    fireEvent.click(rows[0]); // Should not throw.
  });

  it("Close button calls onClose (audience)", () => {
    const onClose = vi.fn();
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={onClose}
        role="audience"
      />,
    );
    fireEvent.click(screen.getByTestId("slide-manager-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when closed (audience)", () => {
    render(
      <SlideManager
        open={false}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        role="audience"
      />,
    );
    expect(screen.queryByTestId("slide-manager")).not.toBeInTheDocument();
  });
});

// ── side prop (#210) ─────────────────────────────────────────────────────
//
// `side` controls which edge the sidebar anchors to. Default `"right"`
// preserves the original behaviour. `"left"` flips the positioning +
// border so the sidebar slides in from the left for the matching edge
// handle (`<ToCEdgeHandle side="left">`).

describe("<SlideManager side> (admin)", () => {
  it("defaults to side='right' (right-anchored, left border)", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
      />,
    );
    const aside = screen.getByTestId("slide-manager");
    expect(aside.getAttribute("data-side")).toBe("right");
    expect(aside.className).toMatch(/right-0/);
    expect(aside.className).toMatch(/border-l/);
    expect(aside.className).not.toMatch(/left-0/);
  });

  it("anchors to the left when side='left' (left border)", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        side="left"
      />,
    );
    const aside = screen.getByTestId("slide-manager");
    expect(aside.getAttribute("data-side")).toBe("left");
    expect(aside.className).toMatch(/left-0/);
    expect(aside.className).toMatch(/border-r/);
    expect(aside.className).not.toMatch(/right-0/);
  });
});

describe("<SlideManager side> (audience)", () => {
  it("defaults to side='right'", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        role="audience"
      />,
    );
    const aside = screen.getByTestId("slide-manager");
    expect(aside.getAttribute("data-side")).toBe("right");
    expect(aside.className).toMatch(/right-0/);
  });

  it("anchors to the left when side='left'", () => {
    render(
      <SlideManager
        open={true}
        slug="hello"
        sourceSlides={sourceSlides}
        manifest={makeManifestHook()}
        onClose={() => {}}
        role="audience"
        side="left"
      />,
    );
    const aside = screen.getByTestId("slide-manager");
    expect(aside.getAttribute("data-side")).toBe("left");
    expect(aside.className).toMatch(/left-0/);
    expect(aside.className).toMatch(/border-r/);
  });
});
