/**
 * Smoke tests for the section template — exercised through `renderDataSlide`
 * so the registry + validator + reveal-wrapping path is end-to-end.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import section from "./index";
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
  "/src/templates/section/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: section as any,
  },
});

describe("section template", () => {
  it("declares its id, label, and default layout", () => {
    expect(section.id).toBe("section");
    expect(section.defaultLayout).toBe("section");
    expect(typeof section.label).toBe("string");
    expect(typeof section.description).toBe("string");
  });

  it("declares title required and label/number optional", () => {
    expect(section.slots.title.required).toBe(true);
    expect(section.slots.title.kind).toBe("text");
    expect(section.slots.label.required).toBe(false);
    expect(section.slots.number.required).toBe(false);
  });

  it("renders the title from the title slot", () => {
    const slide: DataSlide = {
      id: "s",
      template: "section",
      slots: {
        title: { kind: "text", value: "Layouts" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toBe("Layouts");
  });

  it("renders kicker label and big number when provided", () => {
    const slide: DataSlide = {
      id: "s",
      template: "section",
      slots: {
        title: { kind: "text", value: "Chapter title" },
        label: { kind: "text", value: "Chapter 03" },
        number: { kind: "text", value: "03" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    expect(container.textContent).toContain("Chapter 03");
    expect(container.textContent).toContain("03");
    expect(container.textContent).toContain("Chapter title");
  });
});
