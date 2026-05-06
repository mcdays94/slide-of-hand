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
import type { ElementOverride } from "./useElementOverrides";

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
