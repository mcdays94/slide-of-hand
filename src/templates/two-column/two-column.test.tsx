/**
 * Smoke tests for the two-column template.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import twoColumn from "./index";
import { buildTemplateRegistry } from "@/framework/templates/registry";
import { renderDataSlide } from "@/framework/templates/render";

afterEach(() => cleanup());

vi.mock("framer-motion", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passthrough = (tag: string) =>
    function Stub({ children, ...rest }: any) {
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
      { get: (_t, prop: string) => passthrough(prop as string) },
    ),
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

const registry = buildTemplateRegistry({
  "/src/templates/two-column/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: twoColumn as any,
  },
});

describe("two-column template", () => {
  it("declares title + left + right as required", () => {
    expect(twoColumn.id).toBe("two-column");
    expect(twoColumn.defaultLayout).toBe("default");
    expect(twoColumn.slots.title.required).toBe(true);
    expect(twoColumn.slots.title.kind).toBe("text");
    expect(twoColumn.slots.left.required).toBe(true);
    expect(twoColumn.slots.left.kind).toBe("richtext");
    expect(twoColumn.slots.right.required).toBe(true);
    expect(twoColumn.slots.right.kind).toBe("richtext");
  });

  it("renders title + left + right when given valid slots", () => {
    const slide: DataSlide = {
      id: "s",
      template: "two-column",
      slots: {
        title: { kind: "text", value: "Compare and contrast" },
        left: { kind: "richtext", value: "Left side content" },
        right: { kind: "richtext", value: "Right side content" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toBe("Compare and contrast");
    expect(container.textContent).toContain("Left side content");
    expect(container.textContent).toContain("Right side content");
  });

  it("respects revealAt on the right column", () => {
    const slide: DataSlide = {
      id: "s",
      template: "two-column",
      slots: {
        title: { kind: "text", value: "Title" },
        left: { kind: "richtext", value: "Visible from start" },
        right: {
          kind: "richtext",
          value: "Reveals at phase 1",
          revealAt: 1,
        },
      },
    };
    const { container, rerender } = render(
      <>{renderDataSlide(slide, 0, registry)}</>,
    );
    expect(container.textContent).toContain("Visible from start");
    expect(container.textContent).not.toContain("Reveals at phase 1");
    rerender(<>{renderDataSlide(slide, 1, registry)}</>);
    expect(container.textContent).toContain("Reveals at phase 1");
  });
});
