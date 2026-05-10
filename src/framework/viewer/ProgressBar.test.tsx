/**
 * Tests for `<ProgressBar>` — visibility gating tied to the
 * `showSlideIndicators` user setting (issue #32).
 *
 * Covers:
 *   - When `showSlideIndicators=true` (default): always visible
 *     (`data-visible="true"`, `opacity-100`).
 *   - When `showSlideIndicators=false`: hidden by default; flips to
 *     visible when the cursor enters the bottom proximity zone; flips
 *     back to hidden ~800ms after leaving.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar";
import { SettingsProvider } from "./useSettings";

afterEach(() => {
  cleanup();
});

describe("<ProgressBar> with showSlideIndicators=true (default)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", {
      value: 1080,
      configurable: true,
    });
  });

  it("is visible by default (data-visible=true, opacity-100)", () => {
    render(
      <SettingsProvider initialSettings={{ showSlideIndicators: true, presenterNextSlideShowsFinalPhase: false, notesDefaultMode: "rich" }}>
        <ProgressBar total={5} current={0} />
      </SettingsProvider>,
    );
    const bar = screen.getByTestId("progress-bar");
    expect(bar.getAttribute("data-visible")).toBe("true");
    expect(bar.className).toContain("opacity-100");
    expect(bar.className).not.toContain("opacity-0");
    expect(bar.className).toContain("pointer-events-auto");
  });
});

describe("<ProgressBar> with showSlideIndicators=false", () => {
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
    render(
      <SettingsProvider initialSettings={{ showSlideIndicators: false, presenterNextSlideShowsFinalPhase: false, notesDefaultMode: "rich" }}>
        <ProgressBar total={5} current={0} />
      </SettingsProvider>,
    );
    const bar = screen.getByTestId("progress-bar");
    expect(bar.getAttribute("data-visible")).toBe("false");
    expect(bar.className).toContain("opacity-0");
    expect(bar.className).toContain("pointer-events-none");
  });

  it("becomes visible when cursor enters the bottom zone", () => {
    render(
      <SettingsProvider initialSettings={{ showSlideIndicators: false, presenterNextSlideShowsFinalPhase: false, notesDefaultMode: "rich" }}>
        <ProgressBar total={5} current={0} />
      </SettingsProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 960,
          clientY: window.innerHeight - 10,
        }),
      );
    });
    const bar = screen.getByTestId("progress-bar");
    expect(bar.getAttribute("data-visible")).toBe("true");
    expect(bar.className).toContain("opacity-100");
  });

  it("hides again ~800ms after the cursor leaves the bottom zone", () => {
    render(
      <SettingsProvider initialSettings={{ showSlideIndicators: false, presenterNextSlideShowsFinalPhase: false, notesDefaultMode: "rich" }}>
        <ProgressBar total={5} current={0} />
      </SettingsProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 960,
          clientY: window.innerHeight - 10,
        }),
      );
    });
    expect(
      screen.getByTestId("progress-bar").getAttribute("data-visible"),
    ).toBe("true");

    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 960, clientY: 100 }),
      );
    });
    // Still visible immediately — the hide is debounced.
    expect(
      screen.getByTestId("progress-bar").getAttribute("data-visible"),
    ).toBe("true");

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(
      screen.getByTestId("progress-bar").getAttribute("data-visible"),
    ).toBe("false");
  });

  it("renders nothing when total <= 1", () => {
    render(
      <SettingsProvider initialSettings={{ showSlideIndicators: false, presenterNextSlideShowsFinalPhase: false, notesDefaultMode: "rich" }}>
        <ProgressBar total={1} current={0} />
      </SettingsProvider>,
    );
    expect(screen.queryByTestId("progress-bar")).toBeNull();
  });
});

describe("<ProgressBar> common attributes", () => {
  it("carries data-no-advance so clicks don't advance the deck", () => {
    render(
      <SettingsProvider initialSettings={{ showSlideIndicators: true, presenterNextSlideShowsFinalPhase: false, notesDefaultMode: "rich" }}>
        <ProgressBar total={5} current={0} />
      </SettingsProvider>,
    );
    const bar = screen.getByTestId("progress-bar");
    expect(bar.hasAttribute("data-no-advance")).toBe(true);
  });

  it("each segment carries data-interactive", () => {
    render(
      <SettingsProvider initialSettings={{ showSlideIndicators: true, presenterNextSlideShowsFinalPhase: false, notesDefaultMode: "rich" }}>
        <ProgressBar total={3} current={1} />
      </SettingsProvider>,
    );
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("data-interactive"));
    expect(buttons.length).toBe(3);
  });
});
