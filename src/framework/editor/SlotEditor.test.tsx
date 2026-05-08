/**
 * Component tests for `<SlotEditor>`. Verifies the kind-dispatch
 * behaviour: text → TextSlotEditor, richtext → RichTextSlotEditor,
 * everything else → a placeholder.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SlotEditor } from "./SlotEditor";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotKind } from "@/lib/slot-types";

afterEach(() => cleanup());

describe("<SlotEditor>", () => {
  it("dispatches text → TextSlotEditor", () => {
    const spec: SlotSpec = {
      kind: "text",
      label: "Title",
      required: true,
    };
    render(
      <SlotEditor
        name="title"
        spec={spec}
        value={{ kind: "text", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("slot-input-title")).toBeDefined();
  });

  it("dispatches richtext → RichTextSlotEditor", () => {
    const spec: SlotSpec = {
      kind: "richtext",
      label: "Body",
      required: true,
    };
    render(
      <SlotEditor
        name="body"
        spec={spec}
        value={{ kind: "richtext", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("slot-textarea-body")).toBeDefined();
    expect(screen.getByTestId("slot-preview-body")).toBeDefined();
  });

  it.each<[SlotKind, () => unknown]>([
    ["image", () => ({ kind: "image", src: "", alt: "" })],
    ["code", () => ({ kind: "code", lang: "ts", value: "" })],
    ["list", () => ({ kind: "list", items: [] })],
    ["stat", () => ({ kind: "stat", value: "" })],
  ])(
    "renders a placeholder for unsupported kind %s",
    (kind, valueFactory) => {
      const spec: SlotSpec = {
        kind,
        label: `${kind} slot`,
        required: false,
      };
      render(
        <SlotEditor
          name={`${kind}-slot`}
          spec={spec}
          value={
            valueFactory() as Extract<
              import("@/lib/slot-types").SlotValue,
              { kind: typeof kind }
            >
          }
          onChange={() => {}}
        />,
      );
      const ph = screen.getByTestId(`slot-placeholder-${kind}-slot`);
      expect(ph.textContent).toMatch(/not yet supported/);
    },
  );

  it("renders an error when value.kind doesn't match spec.kind", () => {
    const spec: SlotSpec = {
      kind: "text",
      label: "Title",
      required: true,
    };
    render(
      <SlotEditor
        name="title"
        spec={spec}
        // Deliberate mismatch — the dispatcher should surface it
        // rather than coerce silently.
        value={{ kind: "richtext", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("slot-error-title")).toBeDefined();
  });
});
