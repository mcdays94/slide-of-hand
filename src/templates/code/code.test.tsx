/**
 * Smoke tests for the code template — exercised through `renderDataSlide`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import code from "./index";
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
  "/src/templates/code/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: code as any,
  },
});

describe("code template", () => {
  it("declares its id, label, and default layout", () => {
    expect(code.id).toBe("code");
    expect(code.defaultLayout).toBe("default");
  });

  it("declares lang and code required, title optional", () => {
    expect(code.slots.title.required).toBe(false);
    expect(code.slots.lang.required).toBe(true);
    expect(code.slots.code.required).toBe(true);
    expect(code.slots.code.kind).toBe("code");
  });

  it("renders a <pre><code> with a language-<lang> class", () => {
    const slide: DataSlide = {
      id: "s",
      template: "code",
      slots: {
        lang: { kind: "text", value: "TypeScript" },
        code: { kind: "code", lang: "ts", value: "const x = 1" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    const codeEl = pre?.querySelector("code");
    expect(codeEl?.className).toBe("language-ts");
    expect(codeEl?.textContent).toBe("const x = 1");
  });

  it("renders the lang label even without a title", () => {
    const slide: DataSlide = {
      id: "s",
      template: "code",
      slots: {
        lang: { kind: "text", value: "TypeScript" },
        code: { kind: "code", lang: "ts", value: "x" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    expect(container.textContent).toContain("TypeScript");
    expect(container.querySelector("h2")).toBeNull();
  });

  it("renders the title heading when provided", () => {
    const slide: DataSlide = {
      id: "s",
      template: "code",
      slots: {
        title: { kind: "text", value: "An example" },
        lang: { kind: "text", value: "TypeScript" },
        code: { kind: "code", lang: "ts", value: "x" },
      },
    };
    const { container } = render(<>{renderDataSlide(slide, 0, registry)}</>);
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toBe("An example");
  });
});
