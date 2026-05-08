/**
 * Smoke tests for the full-bleed template — exercised through `renderDataSlide`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import fullBleed from "./index";
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
  "/src/templates/full-bleed/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: fullBleed as any,
  },
});

describe("full-bleed template", () => {
  it("declares its id, label, and default layout 'full'", () => {
    expect(fullBleed.id).toBe("full-bleed");
    expect(fullBleed.defaultLayout).toBe("full");
  });

  it("declares image as the only required slot", () => {
    expect(fullBleed.slots.image.required).toBe(true);
    expect(fullBleed.slots.image.kind).toBe("image");
    expect(Object.keys(fullBleed.slots)).toEqual(["image"]);
  });

  it("renders an <img> with src + alt from the image slot", () => {
    const slide: DataSlide = {
      id: "s",
      template: "full-bleed",
      slots: {
        image: { kind: "image", src: "/uploads/hero.jpg", alt: "Hero" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/uploads/hero.jpg");
    expect(img?.getAttribute("alt")).toBe("Hero");
  });
});
