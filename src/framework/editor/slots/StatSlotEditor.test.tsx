/**
 * Component tests for `<StatSlotEditor>`.
 *
 * The stat editor edits `{ kind: "stat", value, caption?, revealAt? }`.
 * Value is the big number/string ("42", "1.2M"); caption is an optional
 * smaller line beneath it. Live preview renders the same shape the deck
 * renderer uses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { StatSlotEditor } from "./StatSlotEditor";
import type { SlotSpec } from "@/lib/template-types";

afterEach(() => cleanup());

const baseSpec: SlotSpec = {
  kind: "stat",
  label: "Headline number",
  required: true,
  maxLength: 12,
  placeholder: "42",
  description: "Short, punchy figure.",
};

describe("<StatSlotEditor>", () => {
  it("renders the label, value input, and caption input", () => {
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "42" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Headline number")).toBeDefined();
    const valueInput = screen.getByTestId(
      "slot-stat-value-hero",
    ) as HTMLInputElement;
    expect(valueInput.value).toBe("42");
    expect(screen.getByTestId("slot-stat-caption-hero")).toBeDefined();
  });

  it("shows the description below the inputs", () => {
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Short, punchy figure.")).toBeDefined();
  });

  it("shows the required indicator when spec.required is true", () => {
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("required")).toBeDefined();
  });

  it("hides the required indicator when spec.required is false", () => {
    render(
      <StatSlotEditor
        name="hero"
        spec={{ ...baseSpec, required: false }}
        value={{ kind: "stat", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText("required")).toBeNull();
  });

  it("emits a fresh stat SlotValue on value change", () => {
    const onChange = vi.fn();
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "" }}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId(
      "slot-stat-value-hero",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1.2M" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "stat", value: "1.2M" });
  });

  it("emits a fresh stat SlotValue with caption on caption change", () => {
    const onChange = vi.fn();
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "42" }}
        onChange={onChange}
      />,
    );
    const captionInput = screen.getByTestId(
      "slot-stat-caption-hero",
    ) as HTMLInputElement;
    fireEvent.change(captionInput, { target: { value: "users" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "stat",
      value: "42",
      caption: "users",
    });
  });

  it("drops the caption field when emptied (sparse JSON)", () => {
    const onChange = vi.fn();
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "42", caption: "users" }}
        onChange={onChange}
      />,
    );
    const captionInput = screen.getByTestId(
      "slot-stat-caption-hero",
    ) as HTMLInputElement;
    fireEvent.change(captionInput, { target: { value: "" } });
    // No caption field at all when empty.
    expect(onChange).toHaveBeenCalledWith({ kind: "stat", value: "42" });
  });

  it("preserves revealAt across value changes", () => {
    const onChange = vi.fn();
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "", revealAt: 3 }}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId(
      "slot-stat-value-hero",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "stat",
      value: "9",
      revealAt: 3,
    });
  });

  it("preserves revealAt across caption changes", () => {
    const onChange = vi.fn();
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "9", revealAt: 2 }}
        onChange={onChange}
      />,
    );
    const captionInput = screen.getByTestId(
      "slot-stat-caption-hero",
    ) as HTMLInputElement;
    fireEvent.change(captionInput, { target: { value: "billion" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "stat",
      value: "9",
      caption: "billion",
      revealAt: 2,
    });
  });

  it("forwards spec.maxLength to the value input", () => {
    render(
      <StatSlotEditor
        name="hero"
        spec={{ ...baseSpec, maxLength: 8 }}
        value={{ kind: "stat", value: "" }}
        onChange={() => {}}
      />,
    );
    const input = screen.getByTestId(
      "slot-stat-value-hero",
    ) as HTMLInputElement;
    expect(input.maxLength).toBe(8);
  });

  it("renders the live preview with value and caption", () => {
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "42", caption: "active users" }}
        onChange={() => {}}
      />,
    );
    const preview = screen.getByTestId("slot-stat-preview-hero");
    expect(preview.textContent).toContain("42");
    expect(preview.textContent).toContain("active users");
  });

  it("renders preview without caption when caption is absent", () => {
    render(
      <StatSlotEditor
        name="hero"
        spec={baseSpec}
        value={{ kind: "stat", value: "42" }}
        onChange={() => {}}
      />,
    );
    const preview = screen.getByTestId("slot-stat-preview-hero");
    expect(preview.textContent).toContain("42");
  });
});
