/**
 * Tests for `<TopToolbar>` (issue #31).
 *
 * Covers:
 *   - Always-visible Home + Studio links
 *   - Public-route shows "Open in Studio" with a slide+phase deep link
 *   - Admin (presenter mode) shows Theme / Slides / Analytics
 *   - Theme + Slides buttons synthesise the t/m keypress
 *   - Toolbar starts hidden (opacity-0 + pointer-events-none) and flips
 *     to visible when the proximity hook returns true
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PresenterModeProvider } from "@/framework/presenter/mode";
import { TopToolbar } from "./TopToolbar";

afterEach(() => {
  cleanup();
});

function renderInRouter(ui: React.ReactElement, initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>,
  );
}

describe("<TopToolbar> (public viewer)", () => {
  it("renders Home and Studio links", () => {
    renderInRouter(
      <PresenterModeProvider enabled={false}>
        <TopToolbar slug="hello" currentSlide={0} currentPhase={0} />
      </PresenterModeProvider>,
    );
    const home = screen.getByTestId("top-toolbar-home");
    const studio = screen.getByTestId("top-toolbar-studio");
    expect(home.getAttribute("href")).toBe("/");
    expect(studio.getAttribute("href")).toBe("/admin");
  });

  it('renders the "Open in Studio" deep link with current slide+phase', () => {
    renderInRouter(
      <PresenterModeProvider enabled={false}>
        <TopToolbar slug="hello" currentSlide={2} currentPhase={1} />
      </PresenterModeProvider>,
    );
    const link = screen.getByTestId("top-toolbar-open-in-studio");
    expect(link.getAttribute("href")).toBe(
      "/admin/decks/hello?slide=2&phase=1",
    );
  });

  it('encodes special characters in the slug for the "Open in Studio" deep link', () => {
    renderInRouter(
      <PresenterModeProvider enabled={false}>
        <TopToolbar slug="my deck" currentSlide={0} currentPhase={0} />
      </PresenterModeProvider>,
    );
    const link = screen.getByTestId("top-toolbar-open-in-studio");
    expect(link.getAttribute("href")).toBe(
      "/admin/decks/my%20deck?slide=0&phase=0",
    );
  });

  it("does NOT render the admin-only Theme / Slides / Analytics buttons", () => {
    renderInRouter(
      <PresenterModeProvider enabled={false}>
        <TopToolbar slug="hello" currentSlide={0} currentPhase={0} />
      </PresenterModeProvider>,
    );
    expect(screen.queryByTestId("top-toolbar-theme")).toBeNull();
    expect(screen.queryByTestId("top-toolbar-slides")).toBeNull();
    expect(screen.queryByTestId("top-toolbar-analytics")).toBeNull();
  });
});

describe("<TopToolbar> (admin / presenter mode)", () => {
  it("renders Theme / Slides / Analytics buttons", () => {
    renderInRouter(
      <PresenterModeProvider enabled={true}>
        <TopToolbar slug="hello" currentSlide={0} currentPhase={0} />
      </PresenterModeProvider>,
    );
    expect(screen.getByTestId("top-toolbar-theme")).toBeTruthy();
    expect(screen.getByTestId("top-toolbar-slides")).toBeTruthy();
    const analytics = screen.getByTestId("top-toolbar-analytics");
    expect(analytics.getAttribute("href")).toBe(
      "/admin/decks/hello/analytics",
    );
  });

  it('does NOT render the public-route "Open in Studio" link', () => {
    renderInRouter(
      <PresenterModeProvider enabled={true}>
        <TopToolbar slug="hello" currentSlide={0} currentPhase={0} />
      </PresenterModeProvider>,
    );
    expect(screen.queryByTestId("top-toolbar-open-in-studio")).toBeNull();
  });

  it("Theme button click synthesises a `t` keydown so <Deck>'s handler fires", () => {
    const captured: string[] = [];
    const listener = (e: KeyboardEvent) => captured.push(e.key);
    window.addEventListener("keydown", listener);
    try {
      renderInRouter(
        <PresenterModeProvider enabled={true}>
          <TopToolbar slug="hello" currentSlide={0} currentPhase={0} />
        </PresenterModeProvider>,
      );
      fireEvent.click(screen.getByTestId("top-toolbar-theme"));
      expect(captured).toContain("t");
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });

  it("Slides button click synthesises a `m` keydown", () => {
    const captured: string[] = [];
    const listener = (e: KeyboardEvent) => captured.push(e.key);
    window.addEventListener("keydown", listener);
    try {
      renderInRouter(
        <PresenterModeProvider enabled={true}>
          <TopToolbar slug="hello" currentSlide={0} currentPhase={0} />
        </PresenterModeProvider>,
      );
      fireEvent.click(screen.getByTestId("top-toolbar-slides"));
      expect(captured).toContain("m");
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });
});

describe("<TopToolbar> proximity behaviour", () => {
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

  it("is hidden by default (data-visible=false, pointer-events-none class)", () => {
    renderInRouter(
      <PresenterModeProvider enabled={false}>
        <TopToolbar slug="hello" currentSlide={0} currentPhase={0} />
      </PresenterModeProvider>,
    );
    const bar = screen.getByTestId("top-toolbar");
    expect(bar.getAttribute("data-visible")).toBe("false");
    expect(bar.className).toContain("opacity-0");
    expect(bar.className).toContain("pointer-events-none");
  });

  it("becomes visible when cursor enters the top zone", () => {
    renderInRouter(
      <PresenterModeProvider enabled={false}>
        <TopToolbar slug="hello" currentSlide={0} currentPhase={0} />
      </PresenterModeProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 500, clientY: 40 }),
      );
    });
    const bar = screen.getByTestId("top-toolbar");
    expect(bar.getAttribute("data-visible")).toBe("true");
    expect(bar.className).toContain("opacity-100");
    expect(bar.className).not.toContain("pointer-events-none");
  });
});
