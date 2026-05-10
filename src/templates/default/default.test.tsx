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

  // Issue #86: react-markdown emits correct <ul><li> DOM, but Tailwind
  // preflight zeroes `list-style` on <ul>/<ol>, so bullets disappear on
  // the public viewer unless the body container restores list styling
  // via arbitrary variants. Without these classes, a markdown list
  // renders as flush text. The classes also harmonise paragraph
  // spacing, inline code, bold/italic, and links with the warm-brown
  // palette.
  it("applies richtext prose styling to the body container", () => {
    const slide: DataSlide = {
      id: "s",
      template: "default",
      slots: {
        title: { kind: "text", value: "Title" },
        body: { kind: "richtext", value: "- Item 1\n- Item 2\n- Item 3" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    // Sanity: the markdown list actually rendered.
    expect(container.querySelectorAll("li")).toHaveLength(3);
    // The body container restores `list-disc` for nested <ul>s.
    const styled = container.querySelector('[class*="list-disc"]');
    expect(styled).not.toBeNull();
    // It also restores `list-decimal` for ordered lists.
    expect(container.querySelector('[class*="list-decimal"]')).not.toBeNull();
    // Inline-code styling is in place.
    expect(container.querySelector('[class*="font-mono"]')).not.toBeNull();
  });
});
