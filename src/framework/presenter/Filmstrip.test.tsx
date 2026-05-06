/**
 * `<Filmstrip>` tests — render + click-to-jump behaviour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SlideDef } from "@/framework/viewer/types";
import { Filmstrip } from "./Filmstrip";

const slides: SlideDef[] = [
  { id: "one", title: "One", render: () => null },
  { id: "two", title: "Two", render: () => null },
  { id: "three", title: "Three", render: () => null },
];

describe("<Filmstrip>", () => {
  afterEach(() => cleanup());

  it("renders one button per slide labelled with the 1-indexed slide number", () => {
    render(<Filmstrip slides={slides} current={0} onJump={() => undefined} />);
    expect(
      screen.getAllByTestId(/presenter-filmstrip-/).filter(
        (el) => el.tagName === "BUTTON",
      ),
    ).toHaveLength(3);
    expect(screen.getByTestId("presenter-filmstrip-0").textContent).toBe("01");
    expect(screen.getByTestId("presenter-filmstrip-1").textContent).toBe("02");
    expect(screen.getByTestId("presenter-filmstrip-2").textContent).toBe("03");
  });

  it("marks the current slide as active", () => {
    render(<Filmstrip slides={slides} current={1} onJump={() => undefined} />);
    expect(
      screen.getByTestId("presenter-filmstrip-0").getAttribute("data-active"),
    ).toBe("false");
    expect(
      screen.getByTestId("presenter-filmstrip-1").getAttribute("data-active"),
    ).toBe("true");
  });

  it("calls onJump with the clicked index", () => {
    const onJump = vi.fn();
    render(<Filmstrip slides={slides} current={0} onJump={onJump} />);
    fireEvent.click(screen.getByTestId("presenter-filmstrip-2"));
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it("uses slide.title for the accessible label", () => {
    render(<Filmstrip slides={slides} current={0} onJump={() => undefined} />);
    expect(
      screen
        .getByTestId("presenter-filmstrip-1")
        .getAttribute("aria-label"),
    ).toContain("Two");
  });
});
