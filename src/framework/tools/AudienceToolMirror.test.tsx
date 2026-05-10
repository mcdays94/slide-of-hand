/**
 * Tests for `<AudienceToolMirror>` (issue #111 item F).
 *
 * Verifies the audience-side renders the laser/magnifier/marker overlay
 * at the broadcast'd normalized cursor coordinate, mapped to the
 * audience's slide-shell rect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AudienceToolMirror } from "./AudienceToolMirror";

// Each test uses a fake BroadcastChannel that exposes a `triggerMessage`
// hook so the test can simulate the presenter's outbound posts.

interface FakeChannelHandle {
  trigger(msg: unknown): void;
  closed: boolean;
}

function installFakeBroadcastChannel(): FakeChannelHandle {
  const handle: FakeChannelHandle = {
    trigger: () => {
      throw new Error("trigger called before channel was constructed");
    },
    closed: false,
  };
  class FakeBC {
    name: string;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    constructor(n: string) {
      this.name = n;
      handle.trigger = (msg: unknown) => {
        this.onmessage?.({ data: msg } as MessageEvent);
      };
    }
    postMessage() {
      /* noop in audience tests */
    }
    close() {
      handle.closed = true;
    }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return true;
    }
  }
  globalThis.BroadcastChannel = FakeBC as unknown as typeof BroadcastChannel;
  return handle;
}

describe("<AudienceToolMirror>", () => {
  let originalBC: typeof BroadcastChannel;
  beforeEach(() => {
    originalBC = globalThis.BroadcastChannel;
    document.body.innerHTML = "";
    // Provide a slide-shell so getToolScope() returns it as fallback.
    const slide = document.createElement("div");
    slide.setAttribute("data-testid", "slide-shell");
    document.body.appendChild(slide);
    vi.spyOn(slide, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1920,
      bottom: 1080,
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    cleanup();
    globalThis.BroadcastChannel = originalBC;
    vi.restoreAllMocks();
  });

  it("renders nothing initially (no tool active)", () => {
    installFakeBroadcastChannel();
    render(<AudienceToolMirror slug="foo" />);
    expect(screen.queryByTestId("audience-laser-mirror")).toBeNull();
    expect(screen.queryByTestId("audience-magnifier-mirror")).toBeNull();
    expect(screen.queryByTestId("audience-marker-mirror")).toBeNull();
  });

  it("renders a laser dot at the de-normalized broadcast position", () => {
    const handle = installFakeBroadcastChannel();
    render(<AudienceToolMirror slug="foo" />);
    act(() => {
      handle.trigger({ type: "tool", tool: "laser" });
    });
    act(() => {
      handle.trigger({ type: "cursor", tool: "laser", x: 0.5, y: 0.5 });
    });
    const dot = screen.getByTestId("audience-laser-mirror");
    // 0.5 * 1920 = 960, dot is centered → left = 960 - 8 = 952
    // 0.5 * 1080 = 540, top = 540 - 8 = 532
    expect((dot as HTMLElement).style.left).toBe("952px");
    expect((dot as HTMLElement).style.top).toBe("532px");
  });

  it("clears the overlay when tool=null is broadcast", () => {
    const handle = installFakeBroadcastChannel();
    render(<AudienceToolMirror slug="foo" />);
    act(() => {
      handle.trigger({ type: "tool", tool: "laser" });
    });
    act(() => {
      handle.trigger({ type: "cursor", tool: "laser", x: 0.5, y: 0.5 });
    });
    expect(screen.queryByTestId("audience-laser-mirror")).not.toBeNull();
    act(() => {
      handle.trigger({ type: "tool", tool: null });
    });
    expect(screen.queryByTestId("audience-laser-mirror")).toBeNull();
  });

  it("renders a magnifier ring on tool=magnifier", () => {
    const handle = installFakeBroadcastChannel();
    render(<AudienceToolMirror slug="foo" />);
    act(() => {
      handle.trigger({ type: "tool", tool: "magnifier" });
    });
    act(() => {
      handle.trigger({ type: "cursor", tool: "magnifier", x: 0.25, y: 0.5 });
    });
    expect(screen.queryByTestId("audience-magnifier-mirror")).not.toBeNull();
    expect(screen.queryByTestId("audience-laser-mirror")).toBeNull();
  });

  it("renders a marker dot on tool=marker", () => {
    const handle = installFakeBroadcastChannel();
    render(<AudienceToolMirror slug="foo" />);
    act(() => {
      handle.trigger({ type: "tool", tool: "marker" });
    });
    act(() => {
      handle.trigger({ type: "cursor", tool: "marker", x: 0.5, y: 0.75 });
    });
    expect(screen.queryByTestId("audience-marker-mirror")).not.toBeNull();
  });
});
