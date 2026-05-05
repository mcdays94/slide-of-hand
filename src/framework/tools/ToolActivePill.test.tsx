/**
 * Tests for the tool-active pill.
 *
 * - Renders nothing when no tool is active
 * - Renders correct label for each tool
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ToolActivePill } from "./ToolActivePill";

describe("ToolActivePill", () => {
  afterEach(() => cleanup());

  it("renders nothing when tool is null", () => {
    const { queryByTestId } = render(<ToolActivePill tool={null} />);
    expect(queryByTestId("tool-active-pill")).toBeNull();
  });

  it("renders the LASER label with the laser tool", () => {
    const { getByTestId } = render(<ToolActivePill tool="laser" />);
    const pill = getByTestId("tool-active-pill");
    expect(pill.textContent).toMatch(/LASER/);
    expect(pill.getAttribute("data-tool")).toBe("laser");
  });

  it("renders the MAGNIFY label with the magnifier tool", () => {
    const { getByTestId } = render(<ToolActivePill tool="magnifier" />);
    const pill = getByTestId("tool-active-pill");
    expect(pill.textContent).toMatch(/MAGNIFY/);
    expect(pill.getAttribute("data-tool")).toBe("magnifier");
  });

  it("renders the MARKER label with the marker tool", () => {
    const { getByTestId } = render(<ToolActivePill tool="marker" />);
    const pill = getByTestId("tool-active-pill");
    expect(pill.textContent).toMatch(/MARKER/);
    expect(pill.getAttribute("data-tool")).toBe("marker");
  });
});
