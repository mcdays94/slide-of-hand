/**
 * `<PhaseDots>` tests — render contract + active-state visuals.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PhaseDots } from "./PhaseDots";

describe("<PhaseDots>", () => {
  afterEach(() => cleanup());

  it("renders nothing when total <= 1", () => {
    const { container: c0 } = render(<PhaseDots total={0} current={0} />);
    expect(c0.firstChild).toBeNull();
    cleanup();
    const { container: c1 } = render(<PhaseDots total={1} current={0} />);
    expect(c1.firstChild).toBeNull();
  });

  it("renders one dot per phase when total > 1", () => {
    render(<PhaseDots total={4} current={0} />);
    expect(screen.getByTestId("presenter-phase-dots")).toBeTruthy();
    expect(screen.getAllByTestId(/presenter-phase-dot-/)).toHaveLength(4);
  });

  it("marks the current phase as active", () => {
    render(<PhaseDots total={3} current={1} />);
    expect(
      screen.getByTestId("presenter-phase-dot-0").getAttribute("data-active"),
    ).toBe("false");
    expect(
      screen.getByTestId("presenter-phase-dot-1").getAttribute("data-active"),
    ).toBe("true");
    expect(
      screen.getByTestId("presenter-phase-dot-2").getAttribute("data-active"),
    ).toBe("false");
  });

  it("makes the active dot wider than the inactive dots", () => {
    render(<PhaseDots total={3} current={1} />);
    const active = screen.getByTestId("presenter-phase-dot-1");
    const inactive = screen.getByTestId("presenter-phase-dot-0");
    expect(active.className).toContain("w-2.5");
    expect(inactive.className).toContain("w-1");
    // Active dot must NOT also carry the small width class.
    expect(active.className).not.toContain("w-1 ");
  });
});
