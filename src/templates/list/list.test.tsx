/**
 * Smoke tests for the list template — exercised through `renderDataSlide`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import list from "./index";
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
  "/src/templates/list/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: list as any,
  },
});

describe("list template", () => {
  it("declares its id, label, and default layout", () => {
    expect(list.id).toBe("list");
    expect(list.defaultLayout).toBe("default");
  });

  it("declares title and items required", () => {
    expect(list.slots.title.required).toBe(true);
    expect(list.slots.items.required).toBe(true);
    expect(list.slots.items.kind).toBe("list");
  });

  it("renders the title as an <h2>", () => {
    const slide: DataSlide = {
      id: "s",
      template: "list",
      slots: {
        title: { kind: "text", value: "Today's agenda" },
        items: { kind: "list", items: ["Intro"] },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toBe("Today's agenda");
  });

  it("renders one <li> per item in the list", () => {
    const slide: DataSlide = {
      id: "s",
      template: "list",
      slots: {
        title: { kind: "text", value: "Agenda" },
        items: { kind: "list", items: ["One", "Two", "Three"] },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const lis = container.querySelectorAll("li");
    expect(lis.length).toBe(3);
    expect(lis[0].textContent).toBe("One");
    expect(lis[2].textContent).toBe("Three");
  });

  it("renders an empty <ul> when items is empty", () => {
    const slide: DataSlide = {
      id: "s",
      template: "list",
      slots: {
        title: { kind: "text", value: "T" },
        items: { kind: "list", items: [] },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul?.querySelectorAll("li").length).toBe(0);
  });
});
