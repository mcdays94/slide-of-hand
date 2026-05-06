/**
 * Surface-level tests for `<ElementInspector>`. We stub the parent
 * callbacks (`onApplyDraft`, `onSave`, etc.) and assert the structural
 * contract the rest of the slice depends on:
 *
 *   - Empty state when no selection is set
 *   - Color radios render from TAILWIND_TOKENS' `color` category
 *   - Picking a color mutates the live element's class AND pushes a
 *     draft override
 *   - Save calls onSave with the applied list
 *   - Close reverts the live mutation AND clears the draft
 *   - Reset reverts to the original class
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

  it("renders the selection label and the color radio list", () => {
    const sel = makeSelection({ initialClass: "text-cf-orange" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);

    expect(screen.getByTestId("element-inspector-target").textContent).toBe(
      "H1.text-cf-orange",
    );
    expect(
      screen.getByTestId("element-inspector-color-text-cf-orange"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("element-inspector-color-text-cf-blue"),
    ).not.toBeNull();
    // Currently-applied class is the seed value of the radio group.
    expect(
      (
        screen.getByTestId(
          "element-inspector-color-text-cf-orange",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("shows 'no curated class' when the element has none of the tokens", () => {
    const sel = makeSelection({ initialClass: "font-medium" });
    render(<ElementInspector {...makeProps({ selection: sel })} />);
    expect(screen.queryByTestId("element-inspector-original")).toBeNull();
    // All radios disabled.
    const radio = screen.getByTestId(
      "element-inspector-color-text-cf-orange",
    ) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
  });

  it("picking a color mutates the live element's classList and pushes a draft", () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
    const props = makeProps({ selection: sel });
    render(<ElementInspector {...props} />);

    const orangeRadio = screen.getByTestId(
      "element-inspector-color-text-cf-orange",
    );
    fireEvent.click(orangeRadio);

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

  it("picking a different color twice chains the mutation correctly (from→intermediate→latest)", () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
    // We lift state — feed each onApplyDraft back as the new applied list.
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
      screen.getByTestId("element-inspector-color-text-cf-orange"),
    );
    rerender(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );

    fireEvent.click(
      screen.getByTestId("element-inspector-color-text-cf-blue"),
    );

    // Final classList only carries the latest pick, not the intermediate.
    expect(sel.element.classList.contains("text-cf-blue")).toBe(true);
    expect(sel.element.classList.contains("text-cf-orange")).toBe(false);
    expect(sel.element.classList.contains("text-cf-text")).toBe(false);

    // Override list still records the swap from ORIGINAL → latest, not
    // intermediate → latest. This is the contract: `from` is the source
    // class authored in code; `to` is the user's final choice.
    expect(applied).toHaveLength(1);
    expect(applied[0].classOverrides).toEqual([
      { from: "text-cf-text", to: "text-cf-blue" },
    ]);
  });

  it("Reset reverts the live mutation and drops the draft entry", () => {
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
      screen.getByTestId("element-inspector-color-text-cf-orange"),
    );
    rerender(
      <ElementInspector
        {...makeProps({ selection: sel })}
        applied={applied}
        onApplyDraft={onApplyDraft}
      />,
    );

    fireEvent.click(screen.getByTestId("element-inspector-reset"));
    expect(sel.element.classList.contains("text-cf-text")).toBe(true);
    expect(sel.element.classList.contains("text-cf-orange")).toBe(false);
    // Draft list is empty after the reset push.
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

  it("Close reverts the live mutation AND calls onClose + onClearDraft", () => {
    const sel = makeSelection({ initialClass: "text-cf-text" });
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
      screen.getByTestId("element-inspector-color-text-cf-orange"),
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
    expect(sel.element.classList.contains("text-cf-orange")).toBe(false);
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
    // Wait for the async resolution.
    await screen.findByText(/Save failed \(403\)/);
  });
});
