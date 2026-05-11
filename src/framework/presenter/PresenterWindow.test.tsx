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

// The presenter window now probes `useAccessAuth()` on mount as a
// defense-in-depth check (the `?presenter=1` URL bypasses the deck
// route's `<PresenterModeProvider enabled={authStatus === ...}>`
// gate). Unstubbed `fetch` in happy-dom would either throw or hang;
// either way the existing tests — which expect to render the full
// presenter UI — would fail with a "sign-in required" landing. Mock
// the hook to return "authenticated" by default so the existing
// behavior tests pass; specific tests in the auth-gate describe block
// override per-test to exercise "checking" and "unauthenticated".
const useAccessAuthMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/use-access-auth", () => ({
  useAccessAuth: useAccessAuthMock,
}));

import { PresenterWindow } from "./PresenterWindow";

// Root-level beforeEach — runs before every test in the file regardless
// of nesting. Each describe's own beforeEach still runs after this one.
beforeEach(() => {
  useAccessAuthMock.mockReturnValue("authenticated");
});

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
    // #122: PresenterWindow now reads `?slide=N&phase=K` from the URL
    // on mount and writes back on every cursor change. Reset between
    // tests so the previous test's URL writes don't leak as initial
    // cursor state.
    window.history.replaceState(null, "", "/");
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
    window.history.replaceState(null, "", "/");
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

/**
 * Tests for the upcoming-preview lookahead panel (issue #115).
 *
 * The bottom-row preview panel is context-aware:
 *
 *   Mode A — current slide has phases remaining
 *     (`cursor.phase < phaseCount(currentSlide) - 1`)
 *     → renders a filmstrip of the CURRENT slide's phases.
 *     → current-phase tile is `emphasized` (orange border + ring).
 *     → each tile has corner label "Now · Phase X/N".
 *     → clicking a tile jumps to that phase of the current slide.
 *
 *   Mode B — current slide on its last phase OR single-phase
 *     (`cursor.phase === phaseCount(currentSlide) - 1`)
 *     → renders the next-slide preview (existing behaviour, governed
 *       by the `presenterNextSlideShowsFinalPhase` setting).
 *     → end-of-deck → existing placeholder.
 *
 * The new behaviour replaces the old "always show the next slide"
 * rendering, so the presenter can see how many reveals remain on the
 * current slide before they advance.
 */
describe("<PresenterWindow> — upcoming preview lookahead (#115)", () => {
  // Rich deck for testing all modes:
  //   slide 0 — 4 phases (phases: 3)
  //   slide 1 — 2 phases (phases: 1)
  //   slide 2 — 1 phase  (phases: 0)
  const richDeck: Deck = {
    meta: {
      slug: "test-deck-upcoming",
      title: "Upcoming Lookahead Test",
      description: "Test deck for issue #115 upcoming preview",
      date: "2026-05-10",
    },
    slides: [
      {
        id: "first",
        title: "First",
        phases: 3,
        render: () => <div>First</div>,
      },
      {
        id: "second",
        title: "Second",
        phases: 1,
        render: () => <div>Second</div>,
      },
      {
        id: "third",
        title: "Third",
        phases: 0,
        render: () => <div>Third</div>,
      },
    ],
  };

  // Run a render+assert block under a fake BroadcastChannel that just
  // captures `postMessage` payloads. Same pattern as the existing
  // keyboard tests above.
  function withFakeBC<T>(fn: (posted: unknown[]) => T): T {
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
      return fn(posted);
    } finally {
      globalThis.BroadcastChannel = RealBC;
    }
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => cleanup());

  it("Mode A: renders a filmstrip of the CURRENT slide's phases on phase 0 of a multi-phase slide", () => {
    withFakeBC(() => {
      render(<PresenterWindow deck={richDeck} />);
      // Cursor starts at slide 0 phase 0. Slide 0 has 4 phases →
      // Mode A is active.
      const filmstrip = screen.getByTestId(
        "presenter-upcoming-current-filmstrip",
      );
      expect(filmstrip).toBeTruthy();
      const tiles = screen.getAllByTestId(
        /^presenter-upcoming-current-phase-\d+$/,
      );
      expect(tiles).toHaveLength(4);
    });
  });

  it("Mode A: emphasises only the current-phase tile (orange border + ring)", () => {
    withFakeBC(() => {
      render(<PresenterWindow deck={richDeck} />);
      // Cursor at slide 0 phase 0 → tile 0 should be emphasized.
      const tile0 = screen.getByTestId("presenter-upcoming-current-phase-0");
      const button0 = tile0.querySelector("[data-testid^='thumbnail-']");
      expect(button0?.className).toMatch(/border-cf-orange/);
      expect(button0?.className).toMatch(/ring-cf-orange/);
      // Tile 1 should NOT be emphasized.
      const tile1 = screen.getByTestId("presenter-upcoming-current-phase-1");
      const button1 = tile1.querySelector("[data-testid^='thumbnail-']");
      expect(button1?.className).not.toMatch(/border-cf-orange/);
    });
  });

  it("Mode A: emphasis advances as the presenter walks phases (still on slide 0)", () => {
    withFakeBC(() => {
      render(<PresenterWindow deck={richDeck} />);
      // Advance from phase 0 → phase 1.
      act(() => {
        fireEvent.keyDown(window, { key: "ArrowRight" });
      });
      // Now phase 1 should be emphasized, phase 0 should NOT.
      const tile1 = screen.getByTestId("presenter-upcoming-current-phase-1");
      const button1 = tile1.querySelector("[data-testid^='thumbnail-']");
      expect(button1?.className).toMatch(/border-cf-orange/);
      const tile0 = screen.getByTestId("presenter-upcoming-current-phase-0");
      const button0 = tile0.querySelector("[data-testid^='thumbnail-']");
      expect(button0?.className).not.toMatch(/border-cf-orange/);
      // Filmstrip is still showing the CURRENT slide (slide 0), not slide 1.
      expect(
        screen.getByTestId("presenter-upcoming-current-filmstrip"),
      ).toBeTruthy();
    });
  });

  it("Mode A: each tile shows a 'Now · Phase X/N' corner label", () => {
    withFakeBC(() => {
      render(<PresenterWindow deck={richDeck} />);
      // Slide 0 has 4 phases. Each tile's corner label is the
      // 1-indexed "Now · Phase X/N".
      const tile0 = screen.getByTestId("presenter-upcoming-current-phase-0");
      expect(tile0.textContent).toContain("Now · Phase 1/4");
      const tile2 = screen.getByTestId("presenter-upcoming-current-phase-2");
      expect(tile2.textContent).toContain("Now · Phase 3/4");
      const tile3 = screen.getByTestId("presenter-upcoming-current-phase-3");
      expect(tile3.textContent).toContain("Now · Phase 4/4");
    });
  });

  it("Mode A: clicking a tile broadcasts navigate to that phase of the CURRENT slide", () => {
    withFakeBC((posted) => {
      render(<PresenterWindow deck={richDeck} />);
      // Click tile 2 — should jump to slide 0 (current), phase 2.
      const tile2 = screen.getByTestId("presenter-upcoming-current-phase-2");
      const button = tile2.querySelector("button");
      expect(button).toBeTruthy();
      act(() => {
        button?.click();
      });
      const navMsgs = posted.filter(
        (m): m is { type: string; slide: number; phase: number } =>
          typeof m === "object" &&
          m !== null &&
          (m as { type?: string }).type === "navigate",
      );
      expect(navMsgs.at(-1)).toEqual({ type: "navigate", slide: 0, phase: 2 });
    });
  });

  it("Mode B: switches to next-slide preview on the LAST phase of a multi-phase current slide", () => {
    withFakeBC(() => {
      render(<PresenterWindow deck={richDeck} />);
      // Slide 0 has 4 phases (0,1,2,3). Walk to phase 3 (last).
      for (let i = 0; i < 3; i++) {
        act(() => {
          fireEvent.keyDown(window, { key: "ArrowRight" });
        });
      }
      // Mode A should be OFF (current-slide filmstrip not present).
      expect(
        screen.queryByTestId("presenter-upcoming-current-filmstrip"),
      ).toBeNull();
      // Mode B kicks in. Slide 1 has 2 phases, setting OFF (default) →
      // next-preview filmstrip renders.
      expect(screen.getByTestId("presenter-next-preview-filmstrip")).toBeTruthy();
      const nextTiles = screen.getAllByTestId(
        /^presenter-next-preview-phase-\d+$/,
      );
      expect(nextTiles).toHaveLength(2);
    });
  });

  it("Mode B: single-phase current slide renders next-slide preview directly (no current filmstrip)", () => {
    withFakeBC(() => {
      // Walk to slide 1 phase 1 (last phase of slide 1, 2 phases), then
      // advance once more to land on slide 2 (single-phase) at phase 0,
      // which equals the LAST phase. Mode B should render the … wait,
      // there is no slide 3, so end-of-deck. Instead, test on slide 1
      // directly: stay at slide 0 phase 3 (last) — Mode B already covered.
      // For a truly single-phase current case, build a small deck.
      const singlePhaseStartDeck: Deck = {
        meta: {
          slug: "single-phase-start",
          title: "Single Phase Start",
          description: "First slide has 1 phase",
          date: "2026-05-10",
        },
        slides: [
          { id: "a", phases: 0, render: () => <div>A</div> },
          { id: "b", phases: 0, render: () => <div>B</div> },
        ],
      };
      render(<PresenterWindow deck={singlePhaseStartDeck} />);
      // Slide 0 has 1 phase → Mode B from the start.
      expect(
        screen.queryByTestId("presenter-upcoming-current-filmstrip"),
      ).toBeNull();
      // Slide 1 is single-phase → single thumb (testid="thumbnail-1").
      expect(screen.getByTestId("thumbnail-1")).toBeTruthy();
      expect(
        screen.queryByTestId("presenter-next-preview-filmstrip"),
      ).toBeNull();
      expect(screen.queryByTestId("presenter-next-preview-end")).toBeNull();
    });
  });

  it("Mode B: 'End of deck' placeholder renders on the LAST phase of the LAST slide", () => {
    withFakeBC(() => {
      render(<PresenterWindow deck={richDeck} />);
      // Walk through every phase.
      // Slide 0: 4 phases (3 keypresses to last phase, 1 more to slide 1 phase 0)
      // Slide 1: 2 phases (1 keypress to last, 1 more to slide 2 phase 0)
      // Slide 2: 1 phase (we're at last phase already).
      // Total: 3 + 1 + 1 + 1 = 6 keypresses to land on slide 2 phase 0.
      for (let i = 0; i < 6; i++) {
        act(() => {
          fireEvent.keyDown(window, { key: "ArrowRight" });
        });
      }
      // We are on the LAST phase of the LAST slide → end-of-deck.
      expect(screen.getByTestId("presenter-next-preview-end")).toBeTruthy();
      expect(
        screen.queryByTestId("presenter-upcoming-current-filmstrip"),
      ).toBeNull();
    });
  });

  it("Mode A still works mid-phase on the LAST slide if it has phases", () => {
    withFakeBC(() => {
      const tailPhasesDeck: Deck = {
        meta: {
          slug: "tail-phases",
          title: "Tail Phases",
          description: "Last slide has multiple phases",
          date: "2026-05-10",
        },
        slides: [
          { id: "a", phases: 0, render: () => <div>A</div> },
          { id: "b", phases: 2, render: () => <div>B</div> }, // 3 phases
        ],
      };
      render(<PresenterWindow deck={tailPhasesDeck} />);
      // Walk to slide 1 phase 0.
      act(() => {
        fireEvent.keyDown(window, { key: "ArrowRight" });
      });
      // Slide 1 has 3 phases → Mode A active even though slide 1 is the
      // last slide (no next slide to preview).
      expect(
        screen.getByTestId("presenter-upcoming-current-filmstrip"),
      ).toBeTruthy();
      const tiles = screen.getAllByTestId(
        /^presenter-upcoming-current-phase-\d+$/,
      );
      expect(tiles).toHaveLength(3);
    });
  });

  // Regression for issue #124 — when the SlideThumbnail's inner div was
  // sized as `100/scale% × 100/scale%` of the tile, slides whose
  // natural content height exceeded the inner-div height got clipped
  // (top + bottom of the slide cropped because the design content was
  // centered within a too-short viewport). The fix is to render at a
  // FIXED 1920×1080 design viewport and let CSS container queries
  // drive the dynamic scale.
  describe("SlideThumbnail design-viewport invariant (#124)", () => {
    it("renders the slide JSX into a fixed 1920×1080 inner div, scaled via 100cqw", () => {
      withFakeBC(() => {
        render(<PresenterWindow deck={richDeck} />);
        const tile0 = screen.getByTestId(
          "presenter-upcoming-current-phase-0",
        );
        const scaled = tile0.querySelector("div[style*='transform']");
        expect(scaled).toBeTruthy();
        const style = scaled?.getAttribute("style") ?? "";
        // Width and height must be the canonical design viewport in
        // ABSOLUTE PIXELS — never a percentage. A percentage would
        // make absolute Tailwind sizes (text-7xl, max-w-5xl, px-12)
        // land in wrong proportions, AND would clip content for
        // slides whose natural height exceeds the percentage-derived
        // inner height — the #124 bug.
        expect(style).toMatch(/width:\s*1920px/);
        expect(style).toMatch(/height:\s*1080px/);
        // Scale must come from a container query, not a hard-coded
        // number, so it self-corrects at any rendered tile size.
        expect(style).toMatch(/transform:\s*scale\(calc\(100cqw/);
      });
    });

    it("the SlideThumbnail's outer element is a CQ size context (so 100cqw resolves to its own width)", () => {
      withFakeBC(() => {
        render(<PresenterWindow deck={richDeck} />);
        const tile0 = screen.getByTestId(
          "presenter-upcoming-current-phase-0",
        );
        const btn = tile0.querySelector("[data-testid^='thumbnail-']");
        expect(btn).toBeTruthy();
        const style = (btn as HTMLElement | null)?.getAttribute("style") ?? "";
        // Without `container-type: size` on the SlideThumbnail's
        // outer element, `100cqw` inside would resolve to an
        // unrelated ancestor's width and the scale would be wrong by
        // an unpredictable factor.
        expect(style).toMatch(/container-type:\s*size/);
      });
    });

    it("the BIG current-slide preview uses the same fixed-viewport invariant", () => {
      withFakeBC(() => {
        render(<PresenterWindow deck={richDeck} />);
        const bigPreview = screen.getByTestId("presenter-current-preview");
        const btn = bigPreview.querySelector("[data-testid^='thumbnail-']");
        const style = (btn as HTMLElement | null)?.getAttribute("style") ?? "";
        expect(style).toMatch(/container-type:\s*size/);
        const scaled = btn?.querySelector("div[style*='transform']");
        const scaledStyle = scaled?.getAttribute("style") ?? "";
        expect(scaledStyle).toMatch(/width:\s*1920px/);
        expect(scaledStyle).toMatch(/height:\s*1080px/);
        expect(scaledStyle).toMatch(/transform:\s*scale\(calc\(100cqw/);
      });
    });
  });
});

/**
 * URL sync (issue #122). The presenter window mirrors slide+phase to
 * `?slide=N&phase=K` via `history.replaceState`, matching the audience-
 * side <Deck> behaviour, so the URL is deep-linkable + reload-safe and
 * preserves other query params (notably `?presenter=1`).
 */
describe("<PresenterWindow> — URL sync (#122)", () => {
  // Same FakeBC helper idiom as the keyboard tests above.
  function withFakeBC<T>(fn: (posted: unknown[]) => T): T {
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
      return fn(posted);
    } finally {
      globalThis.BroadcastChannel = RealBC;
    }
  }

  // 4 slides, varying phase counts so we can exercise the clamp.
  const richDeck: Deck = {
    meta: {
      slug: "test-url-sync",
      title: "URL Sync Test",
      description: "test",
      date: "2026-05-10",
    },
    slides: [
      { id: "first", phases: 0, render: () => <div>First</div> }, // 1 phase
      { id: "second", phases: 1, render: () => <div>Second</div> }, // 2 phases
      { id: "third", phases: 3, render: () => <div>Third</div> }, // 4 phases
      { id: "fourth", phases: 0, render: () => <div>Fourth</div> }, // 1 phase
    ],
  };

  // Set the test URL via window.history.replaceState before render so
  // the mount-time `window.location.search` parser sees the deep link.
  function navigateTestUrl(url: string) {
    window.history.replaceState(null, "", url);
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    window.localStorage.clear();
    // Always start each test from a clean URL.
    navigateTestUrl("/decks/test-url-sync?presenter=1");
  });
  afterEach(() => {
    cleanup();
    navigateTestUrl("/");
  });

  it("starts at slide 0 phase 0 when the URL has no slide/phase params", () => {
    withFakeBC(() => {
      render(<PresenterWindow deck={richDeck} />);
      // After mount, the effect writes the cursor back into the URL.
      const url = new URL(window.location.href);
      expect(url.searchParams.get("slide")).toBe("0");
      expect(url.searchParams.get("phase")).toBe("0");
      // `presenter=1` survives the rewrite.
      expect(url.searchParams.get("presenter")).toBe("1");
    });
  });

  it("reads `?slide=N&phase=K` from the URL on mount as the initial cursor", () => {
    withFakeBC(() => {
      navigateTestUrl("/decks/test-url-sync?presenter=1&slide=2&phase=2");
      render(<PresenterWindow deck={richDeck} />);
      // Slide 2 has 4 phases, so phase=2 is valid; cursor lands there.
      // We can verify by inspecting the rendered current-slide chip.
      // The header includes `<NN>/<NN>` slide counter that shows the
      // 1-indexed current slide.
      const header = document.body.textContent ?? "";
      expect(header).toContain("03 / 04"); // slide 2 (1-indexed: 03) of 4
    });
  });

  it("clamps an out-of-range slide to the last visible slide", () => {
    withFakeBC(() => {
      navigateTestUrl("/decks/test-url-sync?presenter=1&slide=99&phase=0");
      render(<PresenterWindow deck={richDeck} />);
      const header = document.body.textContent ?? "";
      // 4 slides total → last is slide 3 (1-indexed: 04).
      expect(header).toContain("04 / 04");
    });
  });

  it("clamps an out-of-range phase to the last phase of the target slide", () => {
    withFakeBC(() => {
      // Slide 1 has 2 phases (phase 0..1). phase=99 should clamp to 1.
      navigateTestUrl("/decks/test-url-sync?presenter=1&slide=1&phase=99");
      render(<PresenterWindow deck={richDeck} />);
      // The URL is rewritten to the clamped value after mount.
      const url = new URL(window.location.href);
      expect(url.searchParams.get("slide")).toBe("1");
      expect(url.searchParams.get("phase")).toBe("1");
    });
  });

  it("updates `?slide=N&phase=K` as the presenter advances", () => {
    withFakeBC(() => {
      render(<PresenterWindow deck={richDeck} />);
      // Cursor at 0/0. Advance once → slide 0 phase 0 advances to slide 1
      // phase 0 (slide 0 is single-phase).
      act(() => {
        fireEvent.keyDown(window, { key: "ArrowRight" });
      });
      const url = new URL(window.location.href);
      expect(url.searchParams.get("slide")).toBe("1");
      expect(url.searchParams.get("phase")).toBe("0");
      expect(url.searchParams.get("presenter")).toBe("1");
    });
  });

  it("updates phase within the same slide", () => {
    withFakeBC(() => {
      // Land on slide 1 phase 0 (slide 1 has 2 phases).
      navigateTestUrl("/decks/test-url-sync?presenter=1&slide=1&phase=0");
      render(<PresenterWindow deck={richDeck} />);
      act(() => {
        fireEvent.keyDown(window, { key: "ArrowRight" });
      });
      // Same slide, phase 1 (last phase of slide 1).
      const url = new URL(window.location.href);
      expect(url.searchParams.get("slide")).toBe("1");
      expect(url.searchParams.get("phase")).toBe("1");
    });
  });

  it("preserves unrelated query params on every URL rewrite", () => {
    withFakeBC(() => {
      navigateTestUrl(
        "/decks/test-url-sync?presenter=1&debug=trace&utm_source=hello",
      );
      render(<PresenterWindow deck={richDeck} />);
      act(() => {
        fireEvent.keyDown(window, { key: "ArrowRight" });
      });
      const url = new URL(window.location.href);
      expect(url.searchParams.get("presenter")).toBe("1");
      expect(url.searchParams.get("debug")).toBe("trace");
      expect(url.searchParams.get("utm_source")).toBe("hello");
      expect(url.searchParams.get("slide")).toBe("1");
      expect(url.searchParams.get("phase")).toBe("0");
    });
  });

  it("uses `replaceState` (not `pushState`) so navigation does not pollute browser history", () => {
    withFakeBC(() => {
      const replaceSpy = vi.spyOn(window.history, "replaceState");
      const pushSpy = vi.spyOn(window.history, "pushState");
      try {
        render(<PresenterWindow deck={richDeck} />);
        // Mount triggers an initial URL write.
        expect(replaceSpy).toHaveBeenCalled();
        const replaceCallsBefore = replaceSpy.mock.calls.length;
        act(() => {
          fireEvent.keyDown(window, { key: "ArrowRight" });
        });
        expect(replaceSpy.mock.calls.length).toBeGreaterThan(replaceCallsBefore);
        expect(pushSpy).not.toHaveBeenCalled();
      } finally {
        replaceSpy.mockRestore();
        pushSpy.mockRestore();
      }
    });
  });
});

// Defense-in-depth auth gate. The deck route's PresenterModeProvider is
// now driven by Cloudflare Access status — but `?presenter=1` bypasses
// that wrapper (the route renders `<PresenterWindow>` directly, no
// PresenterModeProvider). Without this gate, anyone with the URL could
// read the deck's speaker notes and use the pacing tools. The gate
// shows a "Sign in required" landing for unauthenticated callers, a
// brief "Checking session…" splash while the probe is in flight, and
// only mounts the deck-rendering inner component when authenticated.
describe("<PresenterWindow> — auth gate", () => {
  afterEach(() => cleanup());

  it("renders the sign-in landing when the Access session is unauthenticated", () => {
    useAccessAuthMock.mockReturnValue("unauthenticated");
    render(<PresenterWindow deck={deck} />);
    expect(screen.getByTestId("presenter-auth-required")).toBeTruthy();
    expect(screen.getByText(/sign.?in required/i)).toBeTruthy();
    // The Reload action triggers a fresh request → bounces through
    // Access's SSO redirect for a stale CF_Authorization cookie.
    const reload = screen.getByTestId("presenter-auth-reload");
    expect(reload).toBeTruthy();
    expect(reload.tagName).toBe("BUTTON");
    // The "View deck" link drops to the audience-side viewer at the
    // same slug with no `?presenter=1`.
    const view = screen.getByTestId("presenter-auth-view-deck") as HTMLAnchorElement;
    expect(view).toBeTruthy();
    expect(view.getAttribute("href")).toBe(
      `/decks/${encodeURIComponent(deck.meta.slug)}`,
    );
  });

  it("renders the brief 'Checking session…' splash while the probe is in flight", () => {
    useAccessAuthMock.mockReturnValue("checking");
    render(<PresenterWindow deck={deck} />);
    expect(screen.getByTestId("presenter-auth-checking")).toBeTruthy();
    // Neither the deck content NOR the sign-in landing renders during
    // checking — avoids a flash of UI we'd then have to swap.
    expect(screen.queryByTestId("presenter-auth-required")).toBeNull();
  });

  it("renders the normal presenter UI when authenticated (default)", () => {
    // Sanity check that the existing rendering path still works after
    // wrapping the inner component in the auth gate.
    useAccessAuthMock.mockReturnValue("authenticated");
    render(<PresenterWindow deck={deck} />);
    // The auth-required landing is gone; the deck-cursor-driven UI is up.
    expect(screen.queryByTestId("presenter-auth-required")).toBeNull();
    expect(screen.queryByTestId("presenter-auth-checking")).toBeNull();
  });

  it("does NOT render the speaker-notes panel for unauthenticated visitors", () => {
    // Pinned separately because the speaker notes are the most
    // sensitive surface inside the presenter window — they often
    // contain author-private cues. Make sure the gate blocks the
    // panel itself, not just the chrome around it.
    useAccessAuthMock.mockReturnValue("unauthenticated");
    render(<PresenterWindow deck={deck} />);
    // SpeakerNotes renders with a data-testid="speaker-notes" inside
    // the authenticated branch. The unauth landing replaces the whole
    // tree, so neither this nor any other presenter-internal testid
    // should be findable.
    expect(screen.queryByTestId("speaker-notes")).toBeNull();
    expect(screen.queryByTestId("presenter-pacing")).toBeNull();
    expect(screen.queryByTestId("presenter-filmstrip")).toBeNull();
  });
});
