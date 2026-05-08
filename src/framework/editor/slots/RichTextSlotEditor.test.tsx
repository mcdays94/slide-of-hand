/**
 * Component tests for `<RichTextSlotEditor>`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { RichTextSlotEditor } from "./RichTextSlotEditor";
import type { SlotSpec } from "@/lib/template-types";

afterEach(() => cleanup());

const baseSpec: SlotSpec = {
  kind: "richtext",
  label: "Body",
  required: true,
  maxLength: 4000,
  placeholder: "Markdown here…",
  description: "Markdown supported.",
};

describe("<RichTextSlotEditor>", () => {
  it("renders the label, textarea, and preview pane", () => {
    render(
      <RichTextSlotEditor
        name="body"
        spec={baseSpec}
        value={{ kind: "richtext", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Body")).toBeDefined();
    expect(screen.getByTestId("slot-textarea-body")).toBeDefined();
    expect(screen.getByTestId("slot-preview-body")).toBeDefined();
  });

  it("emits a fresh richtext SlotValue on change", () => {
    const onChange = vi.fn();
    render(
      <RichTextSlotEditor
        name="body"
        spec={baseSpec}
        value={{ kind: "richtext", value: "" }}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByTestId(
      "slot-textarea-body",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "## Hi" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "richtext",
      value: "## Hi",
    });
  });

  it("renders markdown headings in the preview", () => {
    render(
      <RichTextSlotEditor
        name="body"
        spec={baseSpec}
        value={{ kind: "richtext", value: "## Hello" }}
        onChange={() => {}}
      />,
    );
    const preview = screen.getByTestId("slot-preview-body");
    // react-markdown renders `## Hello` as an <h2>.
    expect(preview.querySelector("h2")?.textContent).toBe("Hello");
  });

  it("renders bold / italic / code in the preview", () => {
    render(
      <RichTextSlotEditor
        name="body"
        spec={baseSpec}
        value={{
          kind: "richtext",
          value: "**bold** _italic_ `code`",
        }}
        onChange={() => {}}
      />,
    );
    const preview = screen.getByTestId("slot-preview-body");
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
    expect(preview.querySelector("em")?.textContent).toBe("italic");
    expect(preview.querySelector("code")?.textContent).toBe("code");
  });

  it("shows a placeholder hint when value is empty", () => {
    render(
      <RichTextSlotEditor
        name="body"
        spec={baseSpec}
        value={{ kind: "richtext", value: "" }}
        onChange={() => {}}
      />,
    );
    const preview = screen.getByTestId("slot-preview-body");
    expect(preview.textContent).toContain("Preview");
  });

  it("preserves revealAt across changes", () => {
    const onChange = vi.fn();
    render(
      <RichTextSlotEditor
        name="body"
        spec={baseSpec}
        value={{ kind: "richtext", value: "", revealAt: 1 }}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByTestId(
      "slot-textarea-body",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "X" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "richtext",
      value: "X",
      revealAt: 1,
    });
  });

  it("forwards spec.maxLength to the underlying textarea", () => {
    render(
      <RichTextSlotEditor
        name="body"
        spec={{ ...baseSpec, maxLength: 50 }}
        value={{ kind: "richtext", value: "" }}
        onChange={() => {}}
      />,
    );
    const textarea = screen.getByTestId(
      "slot-textarea-body",
    ) as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(50);
  });
});
