/**
 * Tests for `<ToCEdgeHandle>` — the floating left/right edge button
 * that opens the ToC sidebar from the matching side (#210).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { ToCEdgeHandle } from "./ToCEdgeHandle";

afterEach(() => cleanup());

describe("<ToCEdgeHandle>", () => {
  it("does not render its button when visible=false", () => {
    render(<ToCEdgeHandle visible={false} side="left" onClick={() => {}} />);
    expect(screen.queryByTestId("toc-edge-handle-left")).toBeNull();
  });

  it("renders a left-side button when visible=true and side='left'", () => {
    render(<ToCEdgeHandle visible={true} side="left" onClick={() => {}} />);
    const btn = screen.getByTestId("toc-edge-handle-left");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toMatch(/open.*slides/i);
  });

  it("renders a right-side button when visible=true and side='right'", () => {
    render(<ToCEdgeHandle visible={true} side="right" onClick={() => {}} />);
    const btn = screen.getByTestId("toc-edge-handle-right");
    expect(btn).toBeTruthy();
  });

  it("invokes onClick when clicked", () => {
    const onClick = vi.fn();
    render(<ToCEdgeHandle visible={true} side="left" onClick={onClick} />);
    screen.getByTestId("toc-edge-handle-left").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is marked data-no-advance so the deck click handler ignores it", () => {
    render(<ToCEdgeHandle visible={true} side="right" onClick={() => {}} />);
    const btn = screen.getByTestId("toc-edge-handle-right");
    // Either the button itself OR a wrapping element carries the attribute.
    const noAdvance = btn.closest("[data-no-advance]");
    expect(noAdvance).toBeTruthy();
  });
});
