/**
 * Tests for the top-left STUDIO badge.
 *
 * Covers:
 *   - Renders nothing in public viewer mode (default context)
 *   - Renders the badge text when presenter mode is on
 *   - Carries `data-deck-chrome="studio-badge"` for AutoHideChrome
 *   - Has `data-no-advance` so clicks don't advance the slide
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { StudioBadge } from "./StudioBadge";

afterEach(() => {
  cleanup();
});

describe("<StudioBadge />", () => {
  it("renders nothing when presenter mode is off (public viewer)", () => {
    const { container } = render(<StudioBadge />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("studio-badge")).toBeNull();
  });

  it("renders nothing when presenter mode is explicitly disabled", () => {
    render(
      <PresenterModeProvider enabled={false}>
        <StudioBadge />
      </PresenterModeProvider>,
    );
    expect(screen.queryByTestId("studio-badge")).toBeNull();
  });

  it("renders the badge when presenter mode is enabled", () => {
    render(
      <PresenterModeProvider enabled={true}>
        <StudioBadge />
      </PresenterModeProvider>,
    );
    const badge = screen.getByTestId("studio-badge");
    expect(badge.textContent?.toLowerCase()).toContain("studio");
  });

  it('carries data-deck-chrome="studio-badge" for AutoHideChrome', () => {
    render(
      <PresenterModeProvider enabled={true}>
        <StudioBadge />
      </PresenterModeProvider>,
    );
    const badge = screen.getByTestId("studio-badge");
    expect(badge.getAttribute("data-deck-chrome")).toBe("studio-badge");
  });

  it("has data-no-advance so clicks do not advance the slide", () => {
    render(
      <PresenterModeProvider enabled={true}>
        <StudioBadge />
      </PresenterModeProvider>,
    );
    const badge = screen.getByTestId("studio-badge");
    expect(badge.hasAttribute("data-no-advance")).toBe(true);
  });
});
