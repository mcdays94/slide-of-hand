/**
 * Smoke tests for the default template.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import defaultTemplate from "./index";
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
  "/src/templates/default/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: defaultTemplate as any,
  },
});

describe("default template", () => {
  it("declares both title and body as required", () => {
    expect(defaultTemplate.id).toBe("default");
    expect(defaultTemplate.defaultLayout).toBe("default");
    expect(defaultTemplate.slots.title.required).toBe(true);
    expect(defaultTemplate.slots.title.kind).toBe("text");
    expect(defaultTemplate.slots.body.required).toBe(true);
    expect(defaultTemplate.slots.body.kind).toBe("richtext");
  });

  it("renders title + body when provided with valid slots", () => {
    const slide: DataSlide = {
      id: "s",
      template: "default",
      slots: {
        title: { kind: "text", value: "Section title" },
        body: { kind: "richtext", value: "A paragraph of body text." },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toBe("Section title");
    expect(container.textContent).toContain("A paragraph of body text.");
  });

  it("surfaces a fallback when body is missing", () => {
    const slide: DataSlide = {
      id: "s",
      template: "default",
      slots: {
        title: { kind: "text", value: "Section title" },
      },
    };
    const { getByRole } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    expect(getByRole("alert").textContent).toMatch(/body/);
  });
});
