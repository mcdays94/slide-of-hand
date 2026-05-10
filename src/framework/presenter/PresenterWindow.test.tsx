/**
 * Tests for the presenter window's keyboard handlers and header layout
 * (issue #111, items A + B).
 *
 * Item A: arrow keys (and Space / Enter / Backspace / Home / End) must
 * trigger `navigate` broadcasts, since the standalone presenter window
 * was previously click-only.
 *
 * Item B: the pacing chip (`presenter-pacing`) was removed in favour of
 * tinting the elapsed clock subtly. This test asserts the chip is gone
 * AND that the elapsed clock carries a `data-pacing` attribute the
 * caller can use for downstream styling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Deck } from "@/framework/viewer/types";
import { PresenterWindow } from "./PresenterWindow";

const deck: Deck = {
  meta: {
    slug: "test-deck-keyboard",
    title: "Keyboard Test Deck",
    description: "Test deck for presenter keyboard handlers",
    date: "2026-05-01",
  },
  slides: [
    {
      id: "intro",
      title: "Intro",
      phases: 1,
      render: () => <div>Intro</div>,
    },
    {
      id: "middle",
      title: "Middle",
      phases: 0,
      render: () => <div>Middle</div>,
    },
    {
      id: "end",
      title: "End",
      phases: 1,
      render: () => <div>End</div>,
    },
  ],
};

describe("<PresenterWindow> — keyboard navigation (item A)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it("advances on ArrowRight via the broadcast channel", () => {
    const posted: unknown[] = [];
    const RealBC = globalThis.BroadcastChannel;
    class FakeBC {
      name: string;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor(n: string) {
        this.name = n;
      }
      postMessage(msg: unknown) {
        posted.push(msg);
      }
      close() {}
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
    }
    globalThis.BroadcastChannel = FakeBC as unknown as typeof BroadcastChannel;
    try {
      render(<PresenterWindow deck={deck} />);
      act(() => {
        fireEvent.keyDown(window, { key: "ArrowRight" });
      });
      const navMsgs = posted.filter(
        (m): m is { type: string; slide: number; phase: number } =>
          typeof m === "object" &&
          m !== null &&
          (m as { type?: string }).type === "navigate",
      );
      expect(navMsgs.length).toBeGreaterThanOrEqual(1);
      expect(navMsgs.at(-1)).toEqual({ type: "navigate", slide: 0, phase: 1 });
    } finally {
      globalThis.BroadcastChannel = RealBC;
    }
  });

  it("retreats on ArrowLeft via the broadcast channel", () => {
    const posted: unknown[] = [];
    const RealBC = globalThis.BroadcastChannel;
    class FakeBC {
      name: string;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor(n: string) {
        this.name = n;
      }
      postMessage(msg: unknown) {
        posted.push(msg);
      }
      close() {}
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
    }
    globalThis.BroadcastChannel = FakeBC as unknown as typeof BroadcastChannel;
    try {
      render(<PresenterWindow deck={deck} />);
      // Advance once first.
      act(() => {
        fireEvent.keyDown(window, { key: "ArrowRight" });
      });
      // Then retreat.
      act(() => {
        fireEvent.keyDown(window, { key: "ArrowLeft" });
      });
      const navMsgs = posted.filter(
        (m): m is { type: string; slide: number; phase: number } =>
          typeof m === "object" &&
          m !== null &&
          (m as { type?: string }).type === "navigate",
      );
      // Last navigate should be back to slide 0 / phase 0.
      expect(navMsgs.at(-1)).toEqual({ type: "navigate", slide: 0, phase: 0 });
    } finally {
      globalThis.BroadcastChannel = RealBC;
    }
  });

  it("does not throw when a synthetic keydown with target = Window is dispatched", () => {
    // Same regression class as PresenterWindowTrigger #56: target may be
    // Window (not Element) for synthetic events; the handler must guard.
    const onError = vi.fn();
    window.addEventListener("error", onError);
    try {
      render(<PresenterWindow deck={deck} />);
      act(() => {
        // dispatchEvent on window sets target = Window
        const ev = new KeyboardEvent("keydown", { key: "ArrowRight" });
        window.dispatchEvent(ev);
      });
      expect(onError).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("ignores keys when an interactive element has focus", () => {
    const posted: unknown[] = [];
    const RealBC = globalThis.BroadcastChannel;
    class FakeBC {
      name: string;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor(n: string) {
        this.name = n;
      }
      postMessage(msg: unknown) {
        posted.push(msg);
      }
      close() {}
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
    }
    globalThis.BroadcastChannel = FakeBC as unknown as typeof BroadcastChannel;
    try {
      render(<PresenterWindow deck={deck} />);
      // Make a fake input that's marked data-interactive.
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      const before = posted.filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { type?: string }).type === "navigate",
      ).length;
      act(() => {
        fireEvent.keyDown(input, { key: "ArrowRight" });
      });
      const after = posted.filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { type?: string }).type === "navigate",
      ).length;
      expect(after).toBe(before);
    } finally {
      globalThis.BroadcastChannel = RealBC;
    }
  });
});

describe("<PresenterWindow> — header layout (item B)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it("does not render a separate pacing chip", () => {
    render(<PresenterWindow deck={deck} />);
    expect(screen.queryByTestId("presenter-pacing")).toBeNull();
  });

  it("still renders the elapsed clock with a data-pacing attribute for subtle tint", () => {
    render(<PresenterWindow deck={deck} />);
    const elapsed = screen.getByTestId("presenter-elapsed");
    expect(elapsed.getAttribute("data-pacing")).toMatch(/^(green|amber|red)$/);
  });
});
