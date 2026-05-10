/**
 * Tests for `<StudioAgentToggle>` — the sparkle button that opens the
 * in-Studio AI chat panel from EditMode's toolbar (issue #131 phase 1).
 *
 * The component is a tiny controlled toggle; the parent owns the open
 * state. These tests pin the wiring contract — render, click handler,
 * aria-expanded reflection, and the visual "active" affordance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StudioAgentToggle } from "./StudioAgentToggle";

afterEach(() => {
  cleanup();
});

describe("<StudioAgentToggle>", () => {
  it("renders a button with the AI label", () => {
    render(<StudioAgentToggle open={false} onToggle={vi.fn()} />);
    const btn = screen.getByTestId("studio-agent-toggle");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.textContent).toMatch(/AI/);
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<StudioAgentToggle open={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("studio-agent-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("reflects open=false via aria-expanded", () => {
    render(<StudioAgentToggle open={false} onToggle={vi.fn()} />);
    const btn = screen.getByTestId("studio-agent-toggle");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-label")).toMatch(/open/i);
  });

  it("reflects open=true via aria-expanded + active label", () => {
    render(<StudioAgentToggle open={true} onToggle={vi.fn()} />);
    const btn = screen.getByTestId("studio-agent-toggle");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-label")).toMatch(/close/i);
  });

  it("does NOT call onToggle on render", () => {
    const onToggle = vi.fn();
    render(<StudioAgentToggle open={false} onToggle={onToggle} />);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("carries data-interactive to opt out of slide click-to-advance", () => {
    render(<StudioAgentToggle open={false} onToggle={vi.fn()} />);
    const btn = screen.getByTestId("studio-agent-toggle");
    // `data-interactive` is the convention the framework's <Deck>
    // keydown / click handler looks at; without it, a click on this
    // button would also advance the slide in viewer mode.
    expect(btn.hasAttribute("data-interactive")).toBe(true);
  });
});
