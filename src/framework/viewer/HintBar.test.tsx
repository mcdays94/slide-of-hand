/**
 * Tests for the bottom keyboard hint bar.
 *
 * Covers:
 *   - Renders public navigation hints (← → / F / D / O / ?) by default
 *   - Does NOT render presenter hints (P/Q/W/E) outside presenter mode
 *   - Renders the full set including P/Q/W/E inside presenter mode
 *   - Has `data-no-advance` so clicks on it don't trigger slide advance
 *   - Does NOT carry `data-deck-chrome` (post-#30: the bar manages its own
 *     visibility via `useNearViewportBottom()` and is no longer a member
 *     of the AutoHideChrome group)
 *   - Hidden by default (data-visible=false, opacity-0, pointer-events-none)
 *   - Becomes visible when the cursor enters the bottom zone
 *   - Hides again ~800ms after the cursor leaves the zone
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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
    expect(text.toLowerCase()).toContain("slides");
    expect(text.toLowerCase()).toContain("settings");
    expect(text.toLowerCase()).toContain("help");
  });

  it("advertises the M → slides shortcut in BOTH public and presenter modes (#209)", () => {
    // The ToC sidebar is now an audience-facing surface — audiences
    // press M to open the read-only ToC. The `M slides` entry must be
    // visible regardless of presenter mode.
    const { unmount } = render(
      <PresenterModeProvider enabled={false}>
        <HintBar />
      </PresenterModeProvider>,
    );
    expect(
      (screen.getByTestId("hint-bar").textContent ?? "").toLowerCase(),
    ).toContain("slides");
    // The `M` glyph immediately precedes the `slides` label.
    expect(
      (screen.getByTestId("hint-bar").textContent ?? "").toLowerCase(),
    ).toContain("mslides");
    unmount();

    render(
      <PresenterModeProvider enabled={true}>
        <HintBar />
      </PresenterModeProvider>,
    );
    expect(
      (screen.getByTestId("hint-bar").textContent ?? "").toLowerCase(),
    ).toContain("slides");
  });

  it("advertises the settings shortcut in BOTH public and presenter modes", () => {
    const { unmount } = render(
      <PresenterModeProvider enabled={false}>
        <HintBar />
      </PresenterModeProvider>,
    );
    expect(
      (screen.getByTestId("hint-bar").textContent ?? "").toLowerCase(),
    ).toContain("settings");
    unmount();

    render(
      <PresenterModeProvider enabled={true}>
        <HintBar />
      </PresenterModeProvider>,
    );
    expect(
      (screen.getByTestId("hint-bar").textContent ?? "").toLowerCase(),
    ).toContain("settings");
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

  it("advertises the I → inspect shortcut in presenter mode", () => {
    render(
      <PresenterModeProvider enabled={true}>
        <HintBar />
      </PresenterModeProvider>,
    );
    const text = (screen.getByTestId("hint-bar").textContent ?? "").toLowerCase();
    expect(text).toContain("inspect");
    // The `I` glyph immediately precedes the `inspect` label in the
    // span sequence (CSS gap, no whitespace between them).
    expect(text).toContain("iinspect");
  });

  it("does NOT advertise the I → inspect shortcut in public mode", () => {
    render(
      <PresenterModeProvider enabled={false}>
        <HintBar />
      </PresenterModeProvider>,
    );
    const text = (screen.getByTestId("hint-bar").textContent ?? "").toLowerCase();
    expect(text).not.toContain("inspect");
  });

  it('does NOT carry data-deck-chrome (post-#30: managed by useNearViewportBottom, not AutoHideChrome)', () => {
    render(<HintBar />);
    const bar = screen.getByTestId("hint-bar");
    expect(bar.hasAttribute("data-deck-chrome")).toBe(false);
  });

  it("has data-no-advance to opt out of click-to-advance", () => {
    render(<HintBar />);
    const bar = screen.getByTestId("hint-bar");
    expect(bar.hasAttribute("data-no-advance")).toBe(true);
  });
});

describe("<HintBar /> proximity behaviour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerHeight", {
      value: 1080,
      configurable: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is hidden by default (data-visible=false, opacity-0, pointer-events-none)", () => {
    render(<HintBar />);
    const bar = screen.getByTestId("hint-bar");
    expect(bar.getAttribute("data-visible")).toBe("false");
    expect(bar.className).toContain("opacity-0");
    expect(bar.className).toContain("pointer-events-none");
  });

  it("becomes visible when cursor enters the bottom zone (within 80px of innerHeight)", () => {
    render(<HintBar />);
    act(() => {
      // 10px above the bottom edge — well inside the 80px threshold.
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 960,
          clientY: window.innerHeight - 10,
        }),
      );
    });
    const bar = screen.getByTestId("hint-bar");
    expect(bar.getAttribute("data-visible")).toBe("true");
    expect(bar.className).toContain("opacity-100");
  });

  it("hides again ~800ms after the cursor leaves the bottom zone", () => {
    render(<HintBar />);
    // Enter the zone.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 960,
          clientY: window.innerHeight - 10,
        }),
      );
    });
    expect(screen.getByTestId("hint-bar").getAttribute("data-visible")).toBe(
      "true",
    );

    // Leave the zone (move cursor near the top).
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 960, clientY: 100 }),
      );
    });
    // Still visible immediately after leaving — the hide is debounced.
    expect(screen.getByTestId("hint-bar").getAttribute("data-visible")).toBe(
      "true",
    );

    // Advance past the 800ms hide delay.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByTestId("hint-bar").getAttribute("data-visible")).toBe(
      "false",
    );
  });
});
