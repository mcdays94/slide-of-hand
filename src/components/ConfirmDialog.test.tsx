/**
 * Tests for `<ConfirmDialog>` — a reusable, focused confirmation modal
 * used by the admin index trashcan and the deck-edit view's Delete deck
 * button (issue #130).
 *
 * The component is small but the rules are real: Esc cancels,
 * click-outside cancels, the Cancel button is the default action, and
 * a `destructive` flag tints the confirm button red so the user
 * understands the action is irreversible.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(() => {
  cleanup();
});

describe("<ConfirmDialog>", () => {
  it("does not render when isOpen=false", () => {
    render(
      <ConfirmDialog
        isOpen={false}
        title="Are you sure?"
        body="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });

  it("renders title + body + buttons when isOpen=true", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Delete deck?"
        body="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirm-dialog")).toBeDefined();
    expect(screen.getByText("Delete deck?")).toBeDefined();
    expect(screen.getByText("This cannot be undone.")).toBeDefined();
    expect(screen.getByTestId("confirm-dialog-cancel")).toBeDefined();
    expect(screen.getByTestId("confirm-dialog-confirm")).toBeDefined();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen={true}
        title="X"
        body="Y"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen={true}
        title="X"
        body="Y"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onCancel when Escape is pressed", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen={true}
        title="X"
        body="Y"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen={true}
        title="X"
        body="Y"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does NOT call onCancel when the panel itself is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen={true}
        title="X"
        body="Y"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("uses custom labels when provided", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="X"
        body="Y"
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirm-dialog-confirm").textContent).toBe(
      "Delete",
    );
    expect(screen.getByTestId("confirm-dialog-cancel").textContent).toBe(
      "Keep",
    );
  });

  it("marks the confirm button as destructive when destructive=true", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="X"
        body="Y"
        destructive
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirm = screen.getByTestId("confirm-dialog-confirm");
    expect(confirm.dataset.destructive).toBe("true");
  });

  it("sets the dialog role and aria-modal for accessibility", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Delete deck?"
        body="Y"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId("confirm-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("does not respond to Escape when isOpen=false", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen={false}
        title="X"
        body="Y"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
