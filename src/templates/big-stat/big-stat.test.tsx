/**
 * Smoke tests for the big-stat template — exercised through `renderDataSlide`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import bigStat from "./index";
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
  "/src/templates/big-stat/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: bigStat as any,
  },
});

describe("big-stat template", () => {
  it("declares its id, label, and default layout", () => {
    expect(bigStat.id).toBe("big-stat");
    expect(bigStat.defaultLayout).toBe("default");
  });

  it("declares stat required, context optional", () => {
    expect(bigStat.slots.stat.required).toBe(true);
    expect(bigStat.slots.stat.kind).toBe("stat");
    expect(bigStat.slots.context.required).toBe(false);
  });

  it("renders the stat number prominently", () => {
    const slide: DataSlide = {
      id: "s",
      template: "big-stat",
      slots: {
        stat: { kind: "stat", value: "99.9%" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const strong = container.querySelector(".cf-stat strong");
    expect(strong?.textContent).toBe("99.9%");
  });

  it("renders both stat value and stat caption", () => {
    const slide: DataSlide = {
      id: "s",
      template: "big-stat",
      slots: {
        stat: { kind: "stat", value: "99.9%", caption: "uptime" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    expect(container.textContent).toContain("99.9%");
    expect(container.textContent).toContain("uptime");
  });

  it("renders the context paragraph when provided", () => {
    const slide: DataSlide = {
      id: "s",
      template: "big-stat",
      slots: {
        stat: { kind: "stat", value: "10ms" },
        context: {
          kind: "richtext",
          value: "Median request latency at the edge.",
        },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    expect(container.textContent).toContain("Median request latency");
  });

  // Issue #86: bullets inside a `context` markdown list must be visible.
  it("applies richtext prose styling to the context container", () => {
    const slide: DataSlide = {
      id: "s",
      template: "big-stat",
      slots: {
        stat: { kind: "stat", value: "10ms" },
        context: {
          kind: "richtext",
          value: "- Edge latency\n- Worker cold-start\n- Cache hit ratio",
        },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(container.querySelector('[class*="list-disc"]')).not.toBeNull();
  });
});
