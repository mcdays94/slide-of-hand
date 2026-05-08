/**
 * Component tests for `<TextSlotEditor>`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { TextSlotEditor } from "./TextSlotEditor";
import type { SlotSpec } from "@/lib/template-types";

afterEach(() => cleanup());

const baseSpec: SlotSpec = {
  kind: "text",
  label: "Title",
  required: true,
  maxLength: 120,
  placeholder: "Hello…",
};

describe("<TextSlotEditor>", () => {
  it("renders the label, placeholder, and current value", () => {
    render(
      <TextSlotEditor
        name="title"
        spec={baseSpec}
        value={{ kind: "text", value: "current" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Title")).toBeDefined();
    const input = screen.getByTestId("slot-input-title") as HTMLInputElement;
    expect(input.value).toBe("current");
    expect(input.placeholder).toBe("Hello…");
  });

  it("shows the required indicator when spec.required is true", () => {
    render(
      <TextSlotEditor
        name="title"
        spec={baseSpec}
        value={{ kind: "text", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("required")).toBeDefined();
  });

  it("hides the required indicator when spec.required is false", () => {
    render(
      <TextSlotEditor
        name="kicker"
        spec={{ ...baseSpec, required: false }}
        value={{ kind: "text", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText("required")).toBeNull();
  });

  it("emits a fresh text SlotValue on change", () => {
    const onChange = vi.fn();
    render(
      <TextSlotEditor
        name="title"
        spec={baseSpec}
        value={{ kind: "text", value: "" }}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId("slot-input-title") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "text", value: "Hello" });
  });

  it("preserves revealAt across changes", () => {
    const onChange = vi.fn();
    render(
      <TextSlotEditor
        name="title"
        spec={baseSpec}
        value={{ kind: "text", value: "", revealAt: 2 }}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId("slot-input-title") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "X" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "text",
      value: "X",
      revealAt: 2,
    });
  });

  it("forwards spec.maxLength to the underlying input element", () => {
    render(
      <TextSlotEditor
        name="title"
        spec={{ ...baseSpec, maxLength: 10 }}
        value={{ kind: "text", value: "" }}
        onChange={() => {}}
      />,
    );
    const input = screen.getByTestId("slot-input-title") as HTMLInputElement;
    expect(input.maxLength).toBe(10);
  });
});
