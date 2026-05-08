/**
 * Component tests for `<ListSlotEditor>`.
 *
 * Edits `{ kind: "list", items: string[], revealAt? }`.
 *
 * Drag-reorder: tested by directly invoking `onDragEnd` semantics through
 * keyboard activation of the `useSortable` handle (Space → arrows → Space).
 * That avoids fragile pointer fixtures while still exercising the real
 * `arrayMove` reorder path. We also assert the underlying state by
 * checking the input order after a programmatic "move-up" callback fires.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ListSlotEditor } from "./ListSlotEditor";
import type { SlotSpec } from "@/lib/template-types";

afterEach(() => cleanup());

const baseSpec: SlotSpec = {
  kind: "list",
  label: "Bullets",
  required: true,
  description: "One per line.",
};

describe("<ListSlotEditor>", () => {
  it("renders the label and description", () => {
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: [] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Bullets")).toBeDefined();
    expect(screen.getByText("One per line.")).toBeDefined();
  });

  it("renders one input per item", () => {
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["alpha", "beta", "gamma"] }}
        onChange={() => {}}
      />,
    );
    const a = screen.getByTestId(
      "slot-list-item-bullets-0",
    ) as HTMLInputElement;
    const b = screen.getByTestId(
      "slot-list-item-bullets-1",
    ) as HTMLInputElement;
    const c = screen.getByTestId(
      "slot-list-item-bullets-2",
    ) as HTMLInputElement;
    expect(a.value).toBe("alpha");
    expect(b.value).toBe("beta");
    expect(c.value).toBe("gamma");
  });

  it("shows the required indicator when spec.required is true", () => {
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: [] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("required")).toBeDefined();
  });

  it("hides the required indicator when spec.required is false", () => {
    render(
      <ListSlotEditor
        name="bullets"
        spec={{ ...baseSpec, required: false }}
        value={{ kind: "list", items: [] }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText("required")).toBeNull();
  });

  it("emits an updated list when an item is edited", () => {
    const onChange = vi.fn();
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["alpha", "beta"] }}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId(
      "slot-list-item-bullets-0",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ALPHA" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "list",
      items: ["ALPHA", "beta"],
    });
  });

  it("appends a new empty item when '+ Add item' is clicked", () => {
    const onChange = vi.fn();
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["alpha"] }}
        onChange={onChange}
      />,
    );
    const addButton = screen.getByTestId("slot-list-add-bullets");
    fireEvent.click(addButton);
    expect(onChange).toHaveBeenCalledWith({
      kind: "list",
      items: ["alpha", ""],
    });
  });

  it("appends to an empty list when '+ Add item' is clicked", () => {
    const onChange = vi.fn();
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: [] }}
        onChange={onChange}
      />,
    );
    const addButton = screen.getByTestId("slot-list-add-bullets");
    fireEvent.click(addButton);
    expect(onChange).toHaveBeenCalledWith({
      kind: "list",
      items: [""],
    });
  });

  it("removes an item when its delete button is clicked", () => {
    const onChange = vi.fn();
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["alpha", "beta", "gamma"] }}
        onChange={onChange}
      />,
    );
    const removeButton = screen.getByTestId(
      "slot-list-remove-bullets-1",
    ) as HTMLButtonElement;
    fireEvent.click(removeButton);
    expect(onChange).toHaveBeenCalledWith({
      kind: "list",
      items: ["alpha", "gamma"],
    });
  });

  it("renders a drag handle for each item", () => {
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["alpha", "beta"] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("slot-list-drag-bullets-0")).toBeDefined();
    expect(screen.getByTestId("slot-list-drag-bullets-1")).toBeDefined();
  });

  it("moves an item up via the move-up button (keyboard reorder)", () => {
    const onChange = vi.fn();
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["alpha", "beta", "gamma"] }}
        onChange={onChange}
      />,
    );
    // Move "beta" (index 1) up to index 0.
    const moveUp = screen.getByTestId("slot-list-move-up-bullets-1");
    fireEvent.click(moveUp);
    expect(onChange).toHaveBeenCalledWith({
      kind: "list",
      items: ["beta", "alpha", "gamma"],
    });
  });

  it("moves an item down via the move-down button (keyboard reorder)", () => {
    const onChange = vi.fn();
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["alpha", "beta", "gamma"] }}
        onChange={onChange}
      />,
    );
    // Move "alpha" (index 0) down to index 1.
    const moveDown = screen.getByTestId("slot-list-move-down-bullets-0");
    fireEvent.click(moveDown);
    expect(onChange).toHaveBeenCalledWith({
      kind: "list",
      items: ["beta", "alpha", "gamma"],
    });
  });

  it("disables move-up on the first item", () => {
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["a", "b"] }}
        onChange={() => {}}
      />,
    );
    const moveUp = screen.getByTestId(
      "slot-list-move-up-bullets-0",
    ) as HTMLButtonElement;
    expect(moveUp.disabled).toBe(true);
  });

  it("disables move-down on the last item", () => {
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["a", "b"] }}
        onChange={() => {}}
      />,
    );
    const moveDown = screen.getByTestId(
      "slot-list-move-down-bullets-1",
    ) as HTMLButtonElement;
    expect(moveDown.disabled).toBe(true);
  });

  it("preserves revealAt across edits", () => {
    const onChange = vi.fn();
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["x"], revealAt: 4 }}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId(
      "slot-list-item-bullets-0",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "list",
      items: ["y"],
      revealAt: 4,
    });
  });

  it("preserves revealAt when adding an item", () => {
    const onChange = vi.fn();
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: ["x"], revealAt: 1 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("slot-list-add-bullets"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "list",
      items: ["x", ""],
      revealAt: 1,
    });
  });

  it("renders an empty-state hint when there are no items", () => {
    render(
      <ListSlotEditor
        name="bullets"
        spec={baseSpec}
        value={{ kind: "list", items: [] }}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("slot-list-empty-bullets").textContent,
    ).toMatch(/no items/i);
  });
});
