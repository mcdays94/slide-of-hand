/**
 * Component tests for `<RichTextSlotEditor>`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { RichTextSlotEditor } from "./RichTextSlotEditor";
import { richtextProseClasses } from "@/templates/richtext-prose";
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

  it("applies the canonical richtextProseClasses helper to the preview pane", () => {
    // The preview pane and the public viewer share the same prose styling
    // contract via `richtextProseClasses` (#90). Inert `prose prose-sm`
    // strings would silently no-op without `@tailwindcss/typography`
    // installed, so we assert the helper's tokens are present on the
    // rendered preview container — guarding against future regressions
    // back to the inert classes.
    render(
      <RichTextSlotEditor
        name="body"
        spec={baseSpec}
        value={{ kind: "richtext", value: "- one\n- two" }}
        onChange={() => {}}
      />,
    );
    const preview = screen.getByTestId("slot-preview-body");
    const className = preview.className;
    // Spot-check several distinctive tokens from the helper (lists,
    // emphasis, inline code) — full equality would be brittle.
    expect(className).toContain("[&_ul]:list-disc");
    expect(className).toContain("[&_li]:marker:text-cf-orange");
    expect(className).toContain("[&_strong]:font-medium");
    expect(className).toContain("[&_code]:font-mono");
    // Belt-and-braces: the entire helper string should be a substring,
    // since the swap preserves surrounding non-prose classes around it.
    expect(className).toContain(richtextProseClasses);
    // The inert Tailwind-typography classes that this swap removes must
    // be gone — they silently no-op without the plugin installed.
    expect(className).not.toMatch(/(^|\s)prose(\s|$)/);
    expect(className).not.toMatch(/(^|\s)prose-sm(\s|$)/);
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
