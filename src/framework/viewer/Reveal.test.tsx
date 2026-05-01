/**
 * Tests for `<Reveal>`, `<RevealInline>`, and `usePhase()`.
 *
 * Framer Motion is mocked so jsdom-style assertions don't need to wait for
 * animation frames — `motion.div` becomes a plain div forwarding children.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

afterEach(() => cleanup());
import { PhaseProvider, usePhase } from "./PhaseContext";
import { Reveal, RevealInline } from "./Reveal";

vi.mock("framer-motion", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passthrough = (tag: string) =>
    function Stub({ children, ...rest }: any) {
      // Strip motion-only props that React would warn about.
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        variants: _v,
        whileHover: _wh,
        whileTap: _wt,
        layout: _l,
        ...html
      } = rest;
      const Tag = tag as any;
      return <Tag {...html}>{children}</Tag>;
    };
  return {
    motion: new Proxy(
      {},
      {
        get: (_t, prop: string) => passthrough(prop as any),
      },
    ),
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

function PhaseSpy() {
  const phase = usePhase();
  return <span data-testid="phase">{phase}</span>;
}

describe("usePhase", () => {
  it("returns 0 by default (no provider)", () => {
    const { getByTestId } = render(<PhaseSpy />);
    expect(getByTestId("phase").textContent).toBe("0");
  });

  it("returns the provider's phase value", () => {
    const { getByTestId } = render(
      <PhaseProvider phase={3}>
        <PhaseSpy />
      </PhaseProvider>,
    );
    expect(getByTestId("phase").textContent).toBe("3");
  });
});

describe("<Reveal>", () => {
  it("renders nothing when phase < at", () => {
    const { queryByText } = render(
      <PhaseProvider phase={0}>
        <Reveal at={1}>
          <span>hidden</span>
        </Reveal>
      </PhaseProvider>,
    );
    expect(queryByText("hidden")).toBeNull();
  });

  it("renders children when phase === at", () => {
    const { getByText } = render(
      <PhaseProvider phase={1}>
        <Reveal at={1}>
          <span>visible</span>
        </Reveal>
      </PhaseProvider>,
    );
    expect(getByText("visible")).toBeTruthy();
  });

  it("renders children when phase > at", () => {
    const { getByText } = render(
      <PhaseProvider phase={5}>
        <Reveal at={2}>
          <span>shown</span>
        </Reveal>
      </PhaseProvider>,
    );
    expect(getByText("shown")).toBeTruthy();
  });
});

describe("<RevealInline>", () => {
  it("keeps children mounted regardless of phase but flips aria-hidden", () => {
    const { getByText, rerender } = render(
      <PhaseProvider phase={0}>
        <RevealInline at={2}>inline</RevealInline>
      </PhaseProvider>,
    );
    const node = getByText("inline");
    expect(node.getAttribute("aria-hidden")).toBe("true");
    rerender(
      <PhaseProvider phase={3}>
        <RevealInline at={2}>inline</RevealInline>
      </PhaseProvider>,
    );
    const visibleNode = getByText("inline");
    expect(visibleNode.getAttribute("aria-hidden")).toBe("false");
  });
});
