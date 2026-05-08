/**
 * Smoke tests for the image-hero template — exercised through `renderDataSlide`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import imageHero from "./index";
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
  "/src/templates/image-hero/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: imageHero as any,
  },
});

describe("image-hero template", () => {
  it("declares its id, label, and default layout", () => {
    expect(imageHero.id).toBe("image-hero");
    expect(imageHero.defaultLayout).toBe("default");
    expect(typeof imageHero.label).toBe("string");
  });

  it("declares image required and caption optional", () => {
    expect(imageHero.slots.image.required).toBe(true);
    expect(imageHero.slots.image.kind).toBe("image");
    expect(imageHero.slots.caption.required).toBe(false);
    expect(imageHero.slots.caption.kind).toBe("text");
  });

  it("renders an <img> with src + alt from the image slot", () => {
    const slide: DataSlide = {
      id: "s",
      template: "image-hero",
      slots: {
        image: {
          kind: "image",
          src: "/uploads/photo.png",
          alt: "A photo",
        },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/uploads/photo.png");
    expect(img?.getAttribute("alt")).toBe("A photo");
  });

  it("renders the caption when provided", () => {
    const slide: DataSlide = {
      id: "s",
      template: "image-hero",
      slots: {
        image: { kind: "image", src: "/p.png", alt: "p" },
        caption: { kind: "text", value: "Visual reference" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    expect(container.textContent).toContain("Visual reference");
  });
});
