/**
 * Smoke tests for the quote template — exercised through `renderDataSlide`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import quote from "./index";
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
  "/src/templates/quote/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: quote as any,
  },
});

describe("quote template", () => {
  it("declares its id, label, and default layout", () => {
    expect(quote.id).toBe("quote");
    expect(quote.defaultLayout).toBe("default");
  });

  it("declares quote required, attribution optional", () => {
    expect(quote.slots.quote.required).toBe(true);
    expect(quote.slots.quote.kind).toBe("richtext");
    expect(quote.slots.attribution.required).toBe(false);
  });

  it("renders the quote inside a <blockquote>", () => {
    const slide: DataSlide = {
      id: "s",
      template: "quote",
      slots: {
        quote: {
          kind: "richtext",
          value: "Any sufficiently advanced technology",
        },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.textContent).toContain("Any sufficiently advanced technology");
  });

  it("renders the attribution when provided", () => {
    const slide: DataSlide = {
      id: "s",
      template: "quote",
      slots: {
        quote: { kind: "richtext", value: "X" },
        attribution: { kind: "text", value: "— Arthur C. Clarke" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    expect(container.textContent).toContain("Arthur C. Clarke");
  });

  // Issue #86: richtext content inside the <blockquote> needs prose
  // styling so emphasis renders as bold/italic and any markdown
  // lists keep their bullets. The classes are on a wrapper around
  // the richtext content (not the blockquote itself) — see the
  // quote template's render() comment for why.
  it("applies richtext prose styling to the inner quote wrapper", () => {
    const slide: DataSlide = {
      id: "s",
      template: "quote",
      slots: {
        quote: {
          kind: "richtext",
          value: "Any **sufficiently** advanced _technology_…",
        },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    // Find the prose-styled wrapper (a <span> inside the blockquote
    // that carries the inline-class plus list/em/code restoration).
    const proseWrapper = bq?.querySelector('[class*="list-disc"]');
    expect(proseWrapper).not.toBeNull();
    expect(proseWrapper?.className).toMatch(/italic/);
    // The blockquote keeps its own design: warm-brown text + medium
    // weight via cf-quote tokens; we only assert prose styling on
    // the inner wrapper, not on the blockquote.
    expect(bq?.className).toMatch(/cf-quote/);
  });
});
