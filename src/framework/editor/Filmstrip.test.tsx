/**
 * Component tests for `<Filmstrip>` — the horizontal slide-thumbnail
 * strip mounted at the bottom of `<EditMode>`.
 *
 * The drag-reorder behaviour relies on `@dnd-kit/core` which is hard to
 * exercise via fireEvent (it uses a custom sensor pipeline). We assert
 * the *callback wiring* — given an `onReorder` prop, simulating a
 * keyboard-driven sort dispatch ends up calling it. A small adapter
 * test exposes the internal `onDragEnd` via the `data-testid` we ship,
 * so we can confirm reorder math without faking pointer events.
 */
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Filmstrip } from "./Filmstrip";
import type { DataSlide } from "@/lib/deck-record";

afterEach(() => cleanup());

function slideOf(id: string, title = `Title ${id}`): DataSlide {
  return {
    id,
    template: "default",
    slots: {
      title: { kind: "text", value: title },
      body: { kind: "richtext", value: "" },
    },
  };
}

const baseProps = {
  onSelect: vi.fn(),
  onAddAfter: vi.fn(),
  onAddAtEnd: vi.fn(),
  onDelete: vi.fn(),
  onDuplicate: vi.fn(),
  onReorder: vi.fn(),
};

describe("<Filmstrip> — rendering", () => {
  it("renders one thumbnail per slide", () => {
    const slides = [slideOf("a"), slideOf("b"), slideOf("c")];
    render(
      <Filmstrip
        slides={slides}
        activeSlideId="a"
        {...baseProps}
      />,
    );
    expect(screen.getAllByTestId(/^filmstrip-thumb-/)).toHaveLength(3);
  });

  it("highlights the active slide", () => {
    const slides = [slideOf("a"), slideOf("b")];
    render(
      <Filmstrip
        slides={slides}
        activeSlideId="b"
        {...baseProps}
      />,
    );
    const active = screen.getByTestId("filmstrip-thumb-b");
    expect(active.getAttribute("aria-current")).toBe("true");
    const other = screen.getByTestId("filmstrip-thumb-a");
    expect(other.getAttribute("aria-current")).toBe("false");
  });

  it("renders an end-of-strip add picker", () => {
    render(
      <Filmstrip
        slides={[slideOf("a")]}
        activeSlideId="a"
        {...baseProps}
      />,
    );
    expect(screen.getByTestId("filmstrip-add-end")).toBeDefined();
  });

  it("renders an empty placeholder when there are no slides", () => {
    render(
      <Filmstrip
        slides={[]}
        activeSlideId={null}
        {...baseProps}
      />,
    );
    expect(screen.queryAllByTestId(/^filmstrip-thumb-/)).toHaveLength(0);
    // The end picker is still available so the author can create the
    // first slide.
    expect(screen.getByTestId("filmstrip-add-end")).toBeDefined();
  });
});

describe("<Filmstrip> — interactions", () => {
  it("clicking a thumbnail calls onSelect with that id", () => {
    const onSelect = vi.fn();
    render(
      <Filmstrip
        slides={[slideOf("a"), slideOf("b")]}
        activeSlideId="a"
        {...baseProps}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("filmstrip-thumb-b"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("the end picker calls onAddAtEnd with the chosen template id", () => {
    const onAddAtEnd = vi.fn();
    render(
      <Filmstrip
        slides={[slideOf("a")]}
        activeSlideId="a"
        {...baseProps}
        onAddAtEnd={onAddAtEnd}
      />,
    );
    const select = screen.getByTestId("filmstrip-add-end") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "default" } });
    expect(onAddAtEnd).toHaveBeenCalledWith("default");
  });

  it("the per-thumbnail '+' picker calls onAddAfter with index + template", () => {
    const onAddAfter = vi.fn();
    render(
      <Filmstrip
        slides={[slideOf("a"), slideOf("b")]}
        activeSlideId="a"
        {...baseProps}
        onAddAfter={onAddAfter}
      />,
    );
    const addPicker = screen.getByTestId(
      "filmstrip-add-after-a",
    ) as HTMLSelectElement;
    fireEvent.change(addPicker, { target: { value: "default" } });
    expect(onAddAfter).toHaveBeenCalledWith("default", 0);
  });

  it("clicking duplicate calls onDuplicate with the slide id", () => {
    const onDuplicate = vi.fn();
    render(
      <Filmstrip
        slides={[slideOf("a"), slideOf("b")]}
        activeSlideId="a"
        {...baseProps}
        onDuplicate={onDuplicate}
      />,
    );
    fireEvent.click(screen.getByTestId("filmstrip-duplicate-a"));
    expect(onDuplicate).toHaveBeenCalledWith("a");
  });
});

describe("<Filmstrip> — delete confirm", () => {
  it("clicking delete arms the inline confirm without calling onDelete yet", () => {
    const onDelete = vi.fn();
    render(
      <Filmstrip
        slides={[slideOf("a"), slideOf("b")]}
        activeSlideId="a"
        {...baseProps}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId("filmstrip-delete-a"));
    expect(onDelete).not.toHaveBeenCalled();
    // The confirm button is now visible.
    expect(screen.getByTestId("filmstrip-delete-confirm-a")).toBeDefined();
    expect(screen.getByTestId("filmstrip-delete-cancel-a")).toBeDefined();
  });

  it("clicking confirm fires onDelete with the slide id", () => {
    const onDelete = vi.fn();
    render(
      <Filmstrip
        slides={[slideOf("a"), slideOf("b")]}
        activeSlideId="a"
        {...baseProps}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId("filmstrip-delete-a"));
    fireEvent.click(screen.getByTestId("filmstrip-delete-confirm-a"));
    expect(onDelete).toHaveBeenCalledWith("a");
  });

  it("clicking cancel disarms the confirm without calling onDelete", () => {
    const onDelete = vi.fn();
    render(
      <Filmstrip
        slides={[slideOf("a"), slideOf("b")]}
        activeSlideId="a"
        {...baseProps}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId("filmstrip-delete-a"));
    fireEvent.click(screen.getByTestId("filmstrip-delete-cancel-a"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("filmstrip-delete-confirm-a")).toBeNull();
  });

  it("arming confirm on slide A and then clicking delete on slide B switches the armed slide", () => {
    render(
      <Filmstrip
        slides={[slideOf("a"), slideOf("b")]}
        activeSlideId="a"
        {...baseProps}
      />,
    );
    fireEvent.click(screen.getByTestId("filmstrip-delete-a"));
    expect(screen.getByTestId("filmstrip-delete-confirm-a")).toBeDefined();
    fireEvent.click(screen.getByTestId("filmstrip-delete-b"));
    // A's confirm is gone; B's is showing.
    expect(screen.queryByTestId("filmstrip-delete-confirm-a")).toBeNull();
    expect(screen.getByTestId("filmstrip-delete-confirm-b")).toBeDefined();
  });
});

describe("<Filmstrip> — drag reorder wiring", () => {
  it("exposes a test-only reorder hook that calls onReorder with from/to", () => {
    const onReorder = vi.fn();
    render(
      <Filmstrip
        slides={[slideOf("a"), slideOf("b"), slideOf("c")]}
        activeSlideId="a"
        {...baseProps}
        onReorder={onReorder}
      />,
    );
    // The component exposes a hidden test-input that allows tests to
    // simulate the dnd-kit `onDragEnd` callback without spinning up
    // the sensor pipeline. The input value is "<from>:<to>".
    const probe = screen.getByTestId("filmstrip-reorder-probe");
    fireEvent.change(probe, { target: { value: "0:2" } });
    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });
});
