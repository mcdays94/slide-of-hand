/**
 * Tests for `<TypedSlugConfirmDialog>` — a native, in-app destructive
 * confirmation modal that requires the user to type the exact deck slug
 * before the destructive action enables (issue #244).
 *
 * It is the canonical typed-confirmation primitive for the deck
 * lifecycle action menu. No `window.confirm`; no browser popup. The
 * confirm button stays disabled until the typed value matches the
 * expected slug exactly (case-sensitive, no surrounding whitespace).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TypedSlugConfirmDialog } from "./TypedSlugConfirmDialog";

afterEach(() => {
  cleanup();
});

describe("<TypedSlugConfirmDialog>", () => {
  it("does not render when isOpen=false", () => {
    render(
      <TypedSlugConfirmDialog
        isOpen={false}
        slug="alpha"
        title="Delete deck?"
        body="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });

  it("renders the dialog with title, body, slug input, and buttons", () => {
    render(
      <TypedSlugConfirmDialog
        isOpen={true}
        slug="alpha"
        title="Delete deck?"
        body="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirm-dialog")).toBeDefined();
    expect(screen.getByText("Delete deck?")).toBeDefined();
    expect(screen.getByText(/This cannot be undone/)).toBeDefined();
    expect(screen.getByTestId("typed-slug-input")).toBeDefined();
    expect(screen.getByTestId("confirm-dialog-confirm")).toBeDefined();
    expect(screen.getByTestId("confirm-dialog-cancel")).toBeDefined();
  });

  it("confirm button is disabled until the typed value matches the slug exactly", () => {
    render(
      <TypedSlugConfirmDialog
        isOpen={true}
        slug="alpha"
        title="Delete deck?"
        body="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirm = screen.getByTestId(
      "confirm-dialog-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const input = screen.getByTestId("typed-slug-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alph" } });
    expect(confirm.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "alpha" } });
    expect(confirm.disabled).toBe(false);
  });

  it("typing the wrong case keeps confirm disabled", () => {
    render(
      <TypedSlugConfirmDialog
        isOpen={true}
        slug="alpha"
        title="Delete deck?"
        body="x"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirm = screen.getByTestId(
      "confirm-dialog-confirm",
    ) as HTMLButtonElement;
    const input = screen.getByTestId("typed-slug-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ALPHA" } });
    expect(confirm.disabled).toBe(true);
  });

  it("clicking confirm fires onConfirm only after the slug is typed", () => {
    const onConfirm = vi.fn();
    render(
      <TypedSlugConfirmDialog
        isOpen={true}
        slug="alpha"
        title="Delete deck?"
        body="x"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const confirm = screen.getByTestId("confirm-dialog-confirm");
    // First attempt: disabled button; React/jsdom respects `disabled` and
    // suppresses the onClick handler.
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "alpha" },
    });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancel fires onCancel and does not require typing", () => {
    const onCancel = vi.fn();
    render(
      <TypedSlugConfirmDialog
        isOpen={true}
        slug="alpha"
        title="Delete deck?"
        body="x"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders the slug as a visible hint so the user knows what to type", () => {
    render(
      <TypedSlugConfirmDialog
        isOpen={true}
        slug="legacy-demo"
        title="Delete deck?"
        body="Cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/legacy-demo/)).toBeDefined();
  });

  it("typed value resets when the dialog is reopened", () => {
    const { rerender } = render(
      <TypedSlugConfirmDialog
        isOpen={true}
        slug="alpha"
        title="Delete deck?"
        body="x"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "alpha" },
    });
    // Close.
    rerender(
      <TypedSlugConfirmDialog
        isOpen={false}
        slug="alpha"
        title="Delete deck?"
        body="x"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Reopen.
    rerender(
      <TypedSlugConfirmDialog
        isOpen={true}
        slug="alpha"
        title="Delete deck?"
        body="x"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByTestId("typed-slug-input") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(
      (screen.getByTestId("confirm-dialog-confirm") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("does NOT call window.confirm", () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    render(
      <TypedSlugConfirmDialog
        isOpen={true}
        slug="alpha"
        title="Delete deck?"
        body="x"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "alpha" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
