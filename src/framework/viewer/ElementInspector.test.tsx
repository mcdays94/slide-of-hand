/**
 * Surface-level tests for `<ElementInspector>` (slice 4 — full token
 * catalog). We stub the parent callbacks (`onApplyDraft`, `onSave`, …)
 * and assert the structural contract the rest of the slice depends on:
 *
 *   - Empty state when no selection is set
 *   - All 6 categories from `TAILWIND_TOKENS` render as collapsible
 *     sections.
 *   - On selection, the section containing the element's first matching
 *     class auto-opens; other sections are collapsed.
 *   - Picking a token mutates the live element's class AND pushes a
 *     draft override.
 *   - Drafts across DIFFERENT categories on the same element accumulate
 *     into ONE override entry (single Save → single classOverrides
 *     array with one entry per category).
 *   - Save calls onSave with the applied list.
 *   - Reset reverts ALL in-session live mutations and drops the entry.
 *   - Close reverts the live mutations AND calls onClose + onClearDraft.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  ElementInspector,
  buildSelectionLabel,
  type InspectorSelection,
} from "./ElementInspector";
import type {
  AppliedOverride,
  ElementOverride,
} from "./useElementOverrides";

afterEach(() => {
  cleanup();
});

function makeSelection(opts?: {
  initialClass?: string;
  tag?: string;
  text?: string;
  selector?: string;
  slideId?: string;
}): InspectorSelection {
  const tagName = opts?.tag ?? "h1";
  const el = document.createElement(tagName);
  el.textContent = opts?.text ?? "Hello, world";
  if (opts?.initialClass !== undefined) {
    el.className = opts.initialClass;
  } else {
    el.className = "text-cf-text";
  }
  document.body.appendChild(el);
  return {
    element: el,
    slideId: opts?.slideId ?? "title",
    selector: opts?.selector ?? "h1:nth-child(1)",
    fingerprint: { tag: tagName, text: el.textContent ?? "" },
  };
}

function makeProps(overrides: Partial<{
  open: boolean;
  selection: InspectorSelection | null;
  applied: ElementOverride[];
}> = {}) {
  return {
    open: overrides.open ?? true,
    slug: "hello",
    selection: overrides.selection ?? null,
    applied: overrides.applied ?? [],
    onApplyDraft: vi.fn(),
    onClearDraft: vi.fn(),
    onSave: vi.fn().mockResolvedValue({ ok: true }),
    onClose: vi.fn(),
  };
}

/**
 * Click the section header to expand a collapsed category. Use when the
 * test needs to inspect a section that wasn't auto-opened by the
 * selection.
 */
function expandSection(category: string) {
  fireEvent.click(
    screen.getByTestId(`element-inspector-section-toggle-${category}`),
  );
}

describe("buildSelectionLabel", () => {
  it("formats tag + class as upper-case dot-prefixed badge", () => {
    expect(
      buildSelectionLabel({ tag: "h1" }, "text-cf-orange"),
    ).toBe("H1.text-cf-orange");
  });

  it("falls back to just the tag when no class is matched", () => {
    expect(buildSelectionLabel({ tag: "p" }, null)).toBe("P");
  });
});

describe("<ElementInspector>", () => {
  it("does not render when open is false", () => {
    render(<ElementInspector {...makeProps({ open: false })} />);
    expect(screen.queryByTestId("element-inspector")).toBeNull();
  });

  it("renders empty state when no selection is set", () => {
    render(<ElementInspector {...makeProps()} />);
    expect(screen.getByTestId("element-inspector-empty")).not.toBeNull();
  });

  it("renders all 6 token category sections", () => {
    const sel = makeSelection({ initialClass: "text-cf-orange" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    for (const category of [
      "color",
      "background",
      "typography",
      "spacing",
      "border",
      "sizing",
    ]) {
      expect(
        screen.getByTestId(`element-inspector-section-${category}`),
      ).not.toBeNull();
    }
  });

  it("auto-opens the Color section when the element has a text-cf-* class", () => {
    const sel = makeSelection({ initialClass: "text-cf-orange" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    expect(
      screen
        .getByTestId("element-inspector-section-color")
        .getAttribute("data-open"),
    ).toBe("true");
    // Other sections are collapsed.
    expect(
      screen
        .getByTestId("element-inspector-section-background")
        .getAttribute("data-open"),
    ).toBe("false");
  });

  it("auto-opens the Background section when the element has a bg-cf-* class but no curated text-color", () => {
    const sel = makeSelection({ initialClass: "bg-cf-bg-100" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    expect(
      screen
        .getByTestId("element-inspector-section-background")
        .getAttribute("data-open"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("element-inspector-section-color")
        .getAttribute("data-open"),
    ).toBe("false");
  });

  it("auto-opens the Typography section when the element has only a typography class", () => {
    const sel = makeSelection({ initialClass: "font-medium" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    expect(
      screen
        .getByTestId("element-inspector-section-typography")
        .getAttribute("data-open"),
    ).toBe("true");
  });

  it("renders the selection label using the element's color class", () => {
    const sel = makeSelection({ initialClass: "text-cf-orange" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    expect(screen.getByTestId("element-inspector-target").textContent).toBe(
      "H1.text-cf-orange",
    );
    // Color radios are visible because Color is auto-opened.
    expect(
      screen.getByTestId("element-inspector-token-text-cf-orange"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("element-inspector-token-text-cf-blue"),
    ).not.toBeNull();
    expect(
      (
        screen.getByTestId(
          "element-inspector-token-text-cf-orange",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("section with no matching original disables every token in that section", () => {
    const sel = makeSelection({ initialClass: "font-medium" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    // Color section had no match — expand it manually and check.
    expandSection("color");
    expect(
      screen.queryByTestId("element-inspector-original-color"),
    ).toBeNull();
    const radio = screen.getByTestId(
      "element-inspector-token-text-cf-orange",
    ) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
  });

  it("section with a matching original enables every token AND sets the radio for the current class", () => {
    const sel = makeSelection({ initialClass: "font-medium" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    // Typography section was auto-opened; assert seed is correct.
    expect(
      (
        screen.getByTestId(
          "element-inspector-token-font-medium",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByTestId(
          "element-inspector-token-text-2xl",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(false);
  });

  it("picking a color mutates the live element's classList and pushes a draft", () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
    const props = makeProps({ selection: sel });
    render(<ElementInspector {...props} />);

    fireEvent.click(
      screen.getByTestId("element-inspector-token-text-cf-orange"),
    );

    // Live DOM mutation
    expect(sel.element.classList.contains("text-cf-orange")).toBe(true);
    expect(sel.element.classList.contains("text-cf-text")).toBe(false);

    // Draft override pushed up
    expect(props.onApplyDraft).toHaveBeenCalledTimes(1);
    const pushed = props.onApplyDraft.mock.calls[0][0];
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      slideId: "title",
      selector: "h1:nth-child(1)",
      classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
    });
  });

  it("picking a typography token swaps it correctly", () => {
    const sel = makeSelection({ initialClass: "text-2xl" });
    const props = makeProps({ selection: sel });
    render(<ElementInspector {...props} />);
    fireEvent.click(
      screen.getByTestId("element-inspector-token-text-4xl"),
    );
    expect(sel.element.classList.contains("text-4xl")).toBe(true);
    expect(sel.element.classList.contains("text-2xl")).toBe(false);
    const pushed = props.onApplyDraft.mock.calls[0][0];
    expect(pushed[0].classOverrides).toEqual([
      { from: "text-2xl", to: "text-4xl" },
    ]);
  });

  it("picking a background token swaps it correctly", () => {
    const sel = makeSelection({
      tag: "section",
      initialClass: "bg-cf-bg-100",
      selector: "section:nth-child(1)",
    });
    const props = makeProps({ selection: sel });
    render(<ElementInspector {...props} />);
    fireEvent.click(
      screen.getByTestId("element-inspector-token-bg-cf-bg-200"),
    );
    expect(sel.element.classList.contains("bg-cf-bg-200")).toBe(true);
    expect(sel.element.classList.contains("bg-cf-bg-100")).toBe(false);
    const pushed = props.onApplyDraft.mock.calls[0][0];
    expect(pushed[0].classOverrides).toEqual([
      { from: "bg-cf-bg-100", to: "bg-cf-bg-200" },
    ]);
  });

  it("picking the same color twice chains the live mutation correctly (from→intermediate→latest)", () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
    let applied: ElementOverride[] = [];
    const onApplyDraft = vi.fn((next: ElementOverride[]) => {
      applied = next;
    });

    const { rerender } = render(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );

    fireEvent.click(
      screen.getByTestId("element-inspector-token-text-cf-orange"),
    );
    rerender(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );

    fireEvent.click(
      screen.getByTestId("element-inspector-token-text-cf-blue"),
    );

    // Final classList only carries the latest pick, not the intermediate.
    expect(sel.element.classList.contains("text-cf-blue")).toBe(true);
    expect(sel.element.classList.contains("text-cf-orange")).toBe(false);
    expect(sel.element.classList.contains("text-cf-text")).toBe(false);

    // The persisted swap is original → latest, not intermediate → latest.
    expect(applied).toHaveLength(1);
    expect(applied[0].classOverrides).toEqual([
      { from: "text-cf-text", to: "text-cf-blue" },
    ]);
  });

  it("multi-category drafts on the same element accumulate into ONE override entry", () => {
    const sel = makeSelection({
      tag: "section",
      initialClass: "text-cf-text bg-cf-bg-100 text-2xl",
      selector: "section:nth-child(1)",
    });
    let applied: ElementOverride[] = [];
    const onApplyDraft = vi.fn((next: ElementOverride[]) => {
      applied = next;
    });

    const { rerender } = render(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );

    // Color is auto-opened. Pick a new text color.
    fireEvent.click(
      screen.getByTestId("element-inspector-token-text-cf-orange"),
    );
    rerender(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );
    // Expand Background and pick a new background.
    expandSection("background");
    fireEvent.click(
      screen.getByTestId("element-inspector-token-bg-cf-bg-200"),
    );
    rerender(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );
    // Expand Typography and pick a new size.
    expandSection("typography");
    fireEvent.click(
      screen.getByTestId("element-inspector-token-text-4xl"),
    );

    expect(applied).toHaveLength(1);
    expect(applied[0].slideId).toBe("title");
    expect(applied[0].classOverrides).toEqual(
      expect.arrayContaining([
        { from: "text-cf-text", to: "text-cf-orange" },
        { from: "bg-cf-bg-100", to: "bg-cf-bg-200" },
        { from: "text-2xl", to: "text-4xl" },
      ]),
    );
    expect(applied[0].classOverrides).toHaveLength(3);

    // Live element wears all three new classes.
    expect(sel.element.classList.contains("text-cf-orange")).toBe(true);
    expect(sel.element.classList.contains("bg-cf-bg-200")).toBe(true);
    expect(sel.element.classList.contains("text-4xl")).toBe(true);
  });

  it("Reset reverts every in-session live mutation across all categories AND drops the entry", () => {
    const sel = makeSelection({
      tag: "section",
      initialClass: "text-cf-text bg-cf-bg-100",
      selector: "section:nth-child(1)",
    });
    let applied: ElementOverride[] = [];
    const onApplyDraft = vi.fn((next: ElementOverride[]) => {
      applied = next;
    });

    const { rerender } = render(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );

    fireEvent.click(
      screen.getByTestId("element-inspector-token-text-cf-orange"),
    );
    rerender(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );
    expandSection("background");
    fireEvent.click(
      screen.getByTestId("element-inspector-token-bg-cf-bg-300"),
    );
    rerender(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );

    fireEvent.click(screen.getByTestId("element-inspector-reset"));
    // Both categories restored to originals.
    expect(sel.element.classList.contains("text-cf-text")).toBe(true);
    expect(sel.element.classList.contains("bg-cf-bg-100")).toBe(true);
    expect(sel.element.classList.contains("text-cf-orange")).toBe(false);
    expect(sel.element.classList.contains("bg-cf-bg-300")).toBe(false);
    // Override entry dropped from the list.
    expect(applied).toEqual([]);
  });

  it("Save passes the applied list to onSave", async () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
    const override: ElementOverride = {
      slideId: "title",
      selector: "h1:nth-child(1)",
      fingerprint: { tag: "h1", text: "Hello, world" },
      classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
    };
    const props = makeProps({ selection: sel, applied: [override] });
    render(<ElementInspector {...props} />);

    fireEvent.click(screen.getByTestId("element-inspector-save"));
    expect(props.onSave).toHaveBeenCalledWith([override]);
  });

  it("Close reverts every live mutation AND calls onClose + onClearDraft", () => {
    const sel = makeSelection({
      tag: "section",
      initialClass: "text-cf-text bg-cf-bg-100",
      selector: "section:nth-child(1)",
    });
    let applied: ElementOverride[] = [];
    const onApplyDraft = vi.fn((next: ElementOverride[]) => {
      applied = next;
    });
    const onClearDraft = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
        onClearDraft={onClearDraft}
        onClose={onClose}
      />,
    );

    fireEvent.click(
      screen.getByTestId("element-inspector-token-text-cf-orange"),
    );
    rerender(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
        onClearDraft={onClearDraft}
        onClose={onClose}
      />,
    );
    expandSection("background");
    fireEvent.click(
      screen.getByTestId("element-inspector-token-bg-cf-bg-200"),
    );
    rerender(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
        onClearDraft={onClearDraft}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId("element-inspector-close"));
    expect(sel.element.classList.contains("text-cf-text")).toBe(true);
    expect(sel.element.classList.contains("bg-cf-bg-100")).toBe(true);
    expect(sel.element.classList.contains("text-cf-orange")).toBe(false);
    expect(sel.element.classList.contains("bg-cf-bg-200")).toBe(false);
    expect(onClearDraft).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Save button is disabled when no draft exists", () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
    render(<ElementInspector {...makeProps({ selection: sel, applied: [] })} />);
    const saveBtn = screen.getByTestId(
      "element-inspector-save",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("Reset button is disabled when no in-session swap exists", () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    const resetBtn = screen.getByTestId(
      "element-inspector-reset",
    ) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
  });

  it("dirty indicator appears when an override is applied for this selection", () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
    const override: ElementOverride = {
      slideId: "title",
      selector: "h1:nth-child(1)",
      fingerprint: { tag: "h1", text: "Hello, world" },
      classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
    };
    render(
      <ElementInspector
        {...makeProps({ selection: sel, applied: [override] })}
      />,
    );
    expect(
      screen.queryByTestId("element-inspector-dirty-indicator"),
    ).not.toBeNull();
  });

  it("Save shows an error message on failure", async () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
    const override: ElementOverride = {
      slideId: "title",
      selector: "h1:nth-child(1)",
      fingerprint: { tag: "h1", text: "Hello, world" },
      classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
    };
    const onSave = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    render(
      <ElementInspector
        {...makeProps({ selection: sel, applied: [override] })}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId("element-inspector-save"));
    await screen.findByText(/Save failed \(403\)/);
  });

  it("section toggle expands a collapsed category", () => {
    const sel = makeSelection({ initialClass: "text-cf-orange" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    // Background starts collapsed.
    expect(
      screen
        .getByTestId("element-inspector-section-background")
        .getAttribute("data-open"),
    ).toBe("false");
    expandSection("background");
    expect(
      screen
        .getByTestId("element-inspector-section-background")
        .getAttribute("data-open"),
    ).toBe("true");
    // Token list is now in the DOM.
    expect(
      screen.getByTestId("element-inspector-token-list-background"),
    ).not.toBeNull();
  });
});

// ── Slice 5 (#47): override-list view ─────────────────────────────────

const titleOverride: ElementOverride = {
  slideId: "title",
  selector: "h1:nth-child(1)",
  fingerprint: { tag: "h1", text: "Hello, Slide of Hand" },
  classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
};

const secondOverride: ElementOverride = {
  slideId: "second",
  selector: "p:nth-child(1)",
  fingerprint: { tag: "p", text: "JSX-first slides." },
  classOverrides: [{ from: "text-cf-text-muted", to: "text-cf-blue" }],
};

const multiSwapOverride: ElementOverride = {
  slideId: "third",
  selector: "section:nth-child(1)",
  fingerprint: { tag: "section", text: "Multi" },
  classOverrides: [
    { from: "bg-cf-bg-100", to: "bg-cf-bg-200" },
    { from: "text-cf-text", to: "text-cf-orange" },
    { from: "text-2xl", to: "text-4xl" },
  ],
};

function makeListProps(
  appliedWithStatus: AppliedOverride[],
  extras: Partial<{
    onRemoveOne: ReturnType<typeof vi.fn>;
    onClearOrphaned: ReturnType<typeof vi.fn>;
    onNavigate: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const applied = appliedWithStatus.map((e) => e.override);
  return {
    open: true,
    slug: "hello",
    selection: null,
    applied,
    appliedWithStatus,
    onApplyDraft: vi.fn(),
    onClearDraft: vi.fn(),
    onSave: vi.fn().mockResolvedValue({ ok: true }),
    onRemoveOne:
      extras.onRemoveOne ?? vi.fn().mockResolvedValue({ ok: true }),
    onClearOrphaned:
      extras.onClearOrphaned ?? vi.fn().mockResolvedValue({ ok: true }),
    onNavigate: extras.onNavigate ?? vi.fn(),
    onClose: vi.fn(),
  };
}

describe("<ElementInspector> override-list view (slice 5)", () => {
  it("renders the empty-state copy when no selection AND no overrides", () => {
    render(<ElementInspector {...makeProps()} />);
    expect(screen.getByTestId("element-inspector-empty")).not.toBeNull();
    expect(screen.queryByTestId("element-inspector-list")).toBeNull();
  });

  it("renders the override-list view when no selection AND at least one override", () => {
    const props = makeListProps([
      { override: titleOverride, status: "matched" },
      { override: secondOverride, status: "matched" },
    ]);
    render(<ElementInspector {...props} />);
    expect(screen.queryByTestId("element-inspector-empty")).toBeNull();
    expect(screen.getByTestId("element-inspector-list")).not.toBeNull();
    // Both rows present with their slideIds visible.
    expect(screen.getByText("title")).not.toBeNull();
    expect(screen.getByText("second")).not.toBeNull();
  });

  it("formats each row as `slideId · TAG.from → to`", () => {
    const props = makeListProps([
      { override: titleOverride, status: "matched" },
    ]);
    render(<ElementInspector {...props} />);
    expect(
      screen.getByText("H1.text-cf-text → text-cf-orange"),
    ).not.toBeNull();
  });

  it("multi-swap overrides show a `+N more` suffix on the row", () => {
    const props = makeListProps([
      { override: multiSwapOverride, status: "matched" },
    ]);
    render(<ElementInspector {...props} />);
    // First swap is the bg pair; the other 2 collapse to "+2 more".
    expect(
      screen.getByText("SECTION.bg-cf-bg-100 → bg-cf-bg-200"),
    ).not.toBeNull();
    expect(screen.getByText("+2 more")).not.toBeNull();
  });

  it("× per-row calls onRemoveOne with that override", () => {
    const onRemoveOne = vi.fn().mockResolvedValue({ ok: true });
    const props = makeListProps(
      [
        { override: titleOverride, status: "matched" },
        { override: secondOverride, status: "matched" },
      ],
      { onRemoveOne },
    );
    render(<ElementInspector {...props} />);
    fireEvent.click(
      screen.getByTestId(
        `element-inspector-list-row-remove-${titleOverride.slideId}-${titleOverride.selector}`,
      ),
    );
    expect(onRemoveOne).toHaveBeenCalledTimes(1);
    expect(onRemoveOne).toHaveBeenCalledWith(titleOverride);
  });

  it("× hides when onRemoveOne is not provided", () => {
    const props = {
      open: true,
      slug: "hello",
      selection: null,
      applied: [titleOverride],
      appliedWithStatus: [{ override: titleOverride, status: "matched" as const }],
      onApplyDraft: vi.fn(),
      onClearDraft: vi.fn(),
      onSave: vi.fn().mockResolvedValue({ ok: true }),
      onClose: vi.fn(),
    };
    render(<ElementInspector {...props} />);
    expect(
      screen.queryByTestId(
        `element-inspector-list-row-remove-${titleOverride.slideId}-${titleOverride.selector}`,
      ),
    ).toBeNull();
  });

  it("clicking the row body calls onNavigate with the slideId", () => {
    const onNavigate = vi.fn();
    const props = makeListProps(
      [
        { override: titleOverride, status: "matched" },
        { override: secondOverride, status: "matched" },
      ],
      { onNavigate },
    );
    render(<ElementInspector {...props} />);
    fireEvent.click(
      screen.getByTestId(
        `element-inspector-list-row-button-${secondOverride.slideId}-${secondOverride.selector}`,
      ),
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("second");
  });

  it("orphaned entries render a ⚠ icon next to the row", () => {
    const props = makeListProps([
      { override: titleOverride, status: "matched" },
      { override: secondOverride, status: "orphaned" },
    ]);
    render(<ElementInspector {...props} />);
    // Matched row: no warn icon.
    expect(
      screen.queryByTestId(
        `element-inspector-list-row-warn-${titleOverride.slideId}-${titleOverride.selector}`,
      ),
    ).toBeNull();
    // Orphaned row: warn icon present.
    expect(
      screen.getByTestId(
        `element-inspector-list-row-warn-${secondOverride.slideId}-${secondOverride.selector}`,
      ),
    ).not.toBeNull();
  });

  it("missing entries also render the ⚠ icon (any non-matched status)", () => {
    const props = makeListProps([
      { override: titleOverride, status: "missing" },
    ]);
    render(<ElementInspector {...props} />);
    expect(
      screen.getByTestId(
        `element-inspector-list-row-warn-${titleOverride.slideId}-${titleOverride.selector}`,
      ),
    ).not.toBeNull();
  });

  it("orphaned rows mark the li with data-status=orphaned", () => {
    const props = makeListProps([
      { override: titleOverride, status: "orphaned" },
    ]);
    render(<ElementInspector {...props} />);
    const row = screen.getByTestId(
      `element-inspector-list-row-${titleOverride.slideId}-${titleOverride.selector}`,
    );
    expect(row.getAttribute("data-status")).toBe("orphaned");
  });

  it("'Clear all orphaned' is hidden when every entry is matched", () => {
    const props = makeListProps([
      { override: titleOverride, status: "matched" },
      { override: secondOverride, status: "matched" },
    ]);
    render(<ElementInspector {...props} />);
    expect(
      screen.queryByTestId("element-inspector-clear-orphaned"),
    ).toBeNull();
  });

  it("'Clear all orphaned' shows when at least one entry is orphaned/missing", () => {
    const props = makeListProps([
      { override: titleOverride, status: "matched" },
      { override: secondOverride, status: "orphaned" },
    ]);
    render(<ElementInspector {...props} />);
    expect(
      screen.getByTestId("element-inspector-clear-orphaned"),
    ).not.toBeNull();
    // Count appears in the label.
    expect(screen.getByText(/Clear all orphaned \(1\)/)).not.toBeNull();
  });

  it("'Clear all orphaned' calls onClearOrphaned when clicked", () => {
    const onClearOrphaned = vi.fn().mockResolvedValue({ ok: true });
    const props = makeListProps(
      [
        { override: titleOverride, status: "matched" },
        { override: secondOverride, status: "orphaned" },
        { override: multiSwapOverride, status: "missing" },
      ],
      { onClearOrphaned },
    );
    render(<ElementInspector {...props} />);
    fireEvent.click(screen.getByTestId("element-inspector-clear-orphaned"));
    expect(onClearOrphaned).toHaveBeenCalledTimes(1);
  });

  it("Save / Reset footer is hidden when no element is selected (list view active)", () => {
    const props = makeListProps([
      { override: titleOverride, status: "matched" },
    ]);
    render(<ElementInspector {...props} />);
    expect(screen.queryByTestId("element-inspector-save")).toBeNull();
    expect(screen.queryByTestId("element-inspector-reset")).toBeNull();
  });

  it("falls back to status='matched' for every entry when appliedWithStatus is omitted", () => {
    // Backwards-compat: a parent that doesn't pass appliedWithStatus
    // still gets a working list view (no warnings, no clear-orphaned).
    const props = {
      open: true,
      slug: "hello",
      selection: null,
      applied: [titleOverride, secondOverride],
      onApplyDraft: vi.fn(),
      onClearDraft: vi.fn(),
      onSave: vi.fn().mockResolvedValue({ ok: true }),
      onClose: vi.fn(),
    };
    render(<ElementInspector {...props} />);
    expect(screen.getByTestId("element-inspector-list")).not.toBeNull();
    expect(
      screen.queryByTestId("element-inspector-clear-orphaned"),
    ).toBeNull();
  });
});
