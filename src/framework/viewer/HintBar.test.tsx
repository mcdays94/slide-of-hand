/**
 * Tests for the bottom keyboard hint bar.
 *
 * Covers:
 *   - Renders public navigation hints (← → / F / D / O / ?) by default
 *   - Does NOT render presenter hints (P/Q/W/E) outside presenter mode
 *   - Renders the full set including P/Q/W/E inside presenter mode
 *   - Carries `data-deck-chrome="hints"` so AutoHideChrome fades it
 *   - Has `data-no-advance` so clicks on it don't trigger slide advance
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { HintBar } from "./HintBar";

afterEach(() => {
  cleanup();
});

describe("<HintBar />", () => {
  it("renders public navigation hints by default", () => {
    render(<HintBar />);
    const bar = screen.getByTestId("hint-bar");
    const text = bar.textContent ?? "";
    expect(text).toMatch(/←\s*→/);
    expect(text.toLowerCase()).toContain("navigate");
    expect(text.toLowerCase()).toContain("fullscreen");
    expect(text.toLowerCase()).toContain("dark");
    expect(text.toLowerCase()).toContain("overview");
    expect(text.toLowerCase()).toContain("help");
  });

  it("does NOT render presenter shortcuts (P/Q/W/E) in public viewer mode", () => {
    render(
      <PresenterModeProvider enabled={false}>
        <HintBar />
      </PresenterModeProvider>,
    );
    const bar = screen.getByTestId("hint-bar");
    const text = bar.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("presenter");
    expect(text.toLowerCase()).not.toContain("laser");
    expect(text.toLowerCase()).not.toContain("magnify");
    expect(text.toLowerCase()).not.toContain("marker");
  });

  it("renders presenter shortcuts (P/Q/W/E) when presenter mode is on", () => {
    render(
      <PresenterModeProvider enabled={true}>
        <HintBar />
      </PresenterModeProvider>,
    );
    const bar = screen.getByTestId("hint-bar");
    const text = bar.textContent ?? "";
    expect(text.toLowerCase()).toContain("presenter");
    expect(text.toLowerCase()).toContain("laser");
    expect(text.toLowerCase()).toContain("magnify");
    expect(text.toLowerCase()).toContain("marker");
    // Public hints are still present alongside.
    expect(text.toLowerCase()).toContain("navigate");
  });

  it('carries data-deck-chrome="hints" so AutoHideChrome can fade it', () => {
    render(<HintBar />);
    const bar = screen.getByTestId("hint-bar");
    expect(bar.getAttribute("data-deck-chrome")).toBe("hints");
  });

  it("has data-no-advance to opt out of click-to-advance", () => {
    render(<HintBar />);
    const bar = screen.getByTestId("hint-bar");
    expect(bar.hasAttribute("data-no-advance")).toBe(true);
  });
});
