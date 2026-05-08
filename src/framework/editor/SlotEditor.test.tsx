/**
 * Component tests for `<SlotEditor>`. Verifies the kind-dispatch
 * behaviour: all 6 slot kinds (text/richtext/image/code/list/stat)
 * dispatch to their real editors. Per-editor coverage lives in each
 * `<Kind>SlotEditor.test.tsx` file; this file just verifies the
 * dispatch + the kind-mismatch error path + the revealAt UI.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SlotEditor } from "./SlotEditor";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";

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

  it("dispatches code → CodeSlotEditor", () => {
    const spec: SlotSpec = {
      kind: "code",
      label: "Snippet",
      required: false,
    };
    render(
      <SlotEditor
        name="snippet"
        spec={spec}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("slot-code-lang-snippet")).toBeDefined();
    expect(screen.getByTestId("slot-code-value-snippet")).toBeDefined();
  });

  it("dispatches list → ListSlotEditor", () => {
    const spec: SlotSpec = {
      kind: "list",
      label: "Bullets",
      required: false,
    };
    render(
      <SlotEditor
        name="bullets"
        spec={spec}
        value={{ kind: "list", items: [] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("slot-list-add-bullets")).toBeDefined();
  });

  it("dispatches stat → StatSlotEditor", () => {
    const spec: SlotSpec = {
      kind: "stat",
      label: "Number",
      required: false,
    };
    render(
      <SlotEditor
        name="hero"
        spec={spec}
        value={{ kind: "stat", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("slot-stat-value-hero")).toBeDefined();
    expect(screen.getByTestId("slot-stat-caption-hero")).toBeDefined();
  });

  // Image (kind="image") got its real editor in Slice 7 (#63); see
  // ImageSlotEditor.test.tsx for full coverage.

  describe("revealAt UI", () => {
    it("renders a revealAt dropdown with options 0-4", () => {
      const spec: SlotSpec = { kind: "text", label: "Title", required: true };
      render(
        <SlotEditor
          name="title"
          spec={spec}
          value={{ kind: "text", value: "Hi" }}
          onChange={() => {}}
        />,
      );
      const select = screen.getByTestId(
        "slot-revealat-title",
      ) as HTMLSelectElement;
      expect(select).toBeDefined();
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toEqual(["0", "1", "2", "3", "4"]);
    });

    it("defaults to 0 when value.revealAt is unset", () => {
      const spec: SlotSpec = { kind: "text", label: "Title", required: true };
      render(
        <SlotEditor
          name="title"
          spec={spec}
          value={{ kind: "text", value: "Hi" }}
          onChange={() => {}}
        />,
      );
      const select = screen.getByTestId(
        "slot-revealat-title",
      ) as HTMLSelectElement;
      expect(select.value).toBe("0");
    });

    it("reflects value.revealAt when set", () => {
      const spec: SlotSpec = { kind: "text", label: "Title", required: true };
      render(
        <SlotEditor
          name="title"
          spec={spec}
          value={{ kind: "text", value: "Hi", revealAt: 2 }}
          onChange={() => {}}
        />,
      );
      const select = screen.getByTestId(
        "slot-revealat-title",
      ) as HTMLSelectElement;
      expect(select.value).toBe("2");
    });

    it("emits a SlotValue with the chosen revealAt on change", () => {
      const spec: SlotSpec = { kind: "text", label: "Title", required: true };
      const onChange = vi.fn();
      render(
        <SlotEditor
          name="title"
          spec={spec}
          value={{ kind: "text", value: "Hi" }}
          onChange={onChange}
        />,
      );
      const select = screen.getByTestId(
        "slot-revealat-title",
      ) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "3" } });
      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0] as SlotValue;
      expect(next).toEqual({ kind: "text", value: "Hi", revealAt: 3 });
    });

    it("strips revealAt when set back to 0", () => {
      const spec: SlotSpec = { kind: "text", label: "Title", required: true };
      const onChange = vi.fn();
      render(
        <SlotEditor
          name="title"
          spec={spec}
          value={{ kind: "text", value: "Hi", revealAt: 2 }}
          onChange={onChange}
        />,
      );
      const select = screen.getByTestId(
        "slot-revealat-title",
      ) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "0" } });
      const next = onChange.mock.calls[0][0] as SlotValue;
      expect(next).toEqual({ kind: "text", value: "Hi" });
      expect((next as { revealAt?: number }).revealAt).toBeUndefined();
    });

    it("preserves other slot fields (e.g. image src/alt) when changing revealAt", () => {
      const spec: SlotSpec = {
        kind: "image",
        label: "Hero",
        required: false,
      };
      const onChange = vi.fn();
      render(
        <SlotEditor
          name="hero"
          spec={spec}
          value={{ kind: "image", src: "/img.png", alt: "Alt" }}
          onChange={onChange}
        />,
      );
      const select = screen.getByTestId(
        "slot-revealat-hero",
      ) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "1" } });
      const next = onChange.mock.calls[0][0] as SlotValue;
      expect(next).toEqual({
        kind: "image",
        src: "/img.png",
        alt: "Alt",
        revealAt: 1,
      });
    });

    it("does NOT render revealAt for the kind-mismatch error path", () => {
      const spec: SlotSpec = { kind: "text", label: "Title", required: true };
      render(
        <SlotEditor
          name="title"
          spec={spec}
          value={{ kind: "richtext", value: "" }}
          onChange={() => {}}
        />,
      );
      expect(screen.queryByTestId("slot-revealat-title")).toBeNull();
      expect(screen.getByTestId("slot-error-title")).toBeDefined();
    });
  });

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
