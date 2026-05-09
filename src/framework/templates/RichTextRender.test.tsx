/**
 * Direct unit tests for `<RichTextRender>`.
 *
 * The component is a thin wrapper around `react-markdown`; these tests
 * lock in the contract that both the deck viewer's `renderSlot()` and
 * the admin Studio's `<RichTextSlotEditor>` rely on. If react-markdown's
 * default config ever changes shape, these failing tests should land
 * before the dependency bump is merged.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RichTextRender } from "./RichTextRender";

afterEach(() => cleanup());

describe("<RichTextRender>", () => {
  it("renders **bold** as <strong>", () => {
    const { container } = render(<RichTextRender source="**hello**" />);
    expect(container.querySelector("strong")?.textContent).toBe("hello");
  });

  it("renders _italic_ as <em>", () => {
    const { container } = render(<RichTextRender source="_hello_" />);
    expect(container.querySelector("em")?.textContent).toBe("hello");
  });

  it("renders unordered lists as <ul><li>", () => {
    const { container } = render(
      <RichTextRender source={"- a\n- b\n- c"} />,
    );
    expect(container.querySelectorAll("ul li")).toHaveLength(3);
  });

  it("renders blank-line breaks as separate <p> elements", () => {
    const { container } = render(
      <RichTextRender source={"one\n\ntwo"} />,
    );
    const ps = container.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(ps[0].textContent).toBe("one");
    expect(ps[1].textContent).toBe("two");
  });

  it("renders empty input without throwing or producing markup", () => {
    const { container } = render(<RichTextRender source="" />);
    // react-markdown renders an empty container; the important contract
    // is "doesn't throw, doesn't leak literal markdown".
    expect(container.textContent).toBe("");
  });

  it("does not interpret raw HTML by default (rehype-raw is intentionally NOT enabled)", () => {
    const { container } = render(
      <RichTextRender source="<script>alert(1)</script>hello" />,
    );
    // Default react-markdown config escapes raw HTML — no <script> appears
    // in the DOM. This guards against an accidental sanitization regression
    // if someone wires rehype-raw in without thinking.
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("hello");
  });
});
