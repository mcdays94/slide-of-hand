/**
 * Tests for `renderDataSlide()`.
 *
 * Framer Motion is mocked so jsdom-style assertions don't have to wait for
 * animation frames (mirrors `src/framework/viewer/Reveal.test.tsx`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import type { SlideTemplate } from "@/lib/template-types";

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

import { renderDataSlide } from "./render";
import { buildTemplateRegistry } from "./registry";

const titleOnlyTemplate: SlideTemplate<{ title: "text" }> = {
  id: "title-only",
  label: "Title only",
  description: "Renders just the title slot.",
  defaultLayout: "default",
  slots: {
    title: { kind: "text", label: "Title", required: true },
  },
  // The renderer wraps each slot's *content* in <Reveal>, then passes the
  // wrapped ReactNodes in via `slots`. At runtime the template treats each
  // slot as a ReactNode it can drop into the JSX tree.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: ({ slots }) => <h1 data-testid="title">{slots.title as any}</h1>,
};

const twoSlotTemplate: SlideTemplate<{
  title: "text";
  body: "richtext";
}> = {
  id: "two-slot",
  label: "Two slot",
  description: "Title + body.",
  defaultLayout: "default",
  slots: {
    title: { kind: "text", label: "Title", required: true },
    body: { kind: "richtext", label: "Body", required: true },
  },
  render: ({ slots }) => (
    <div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <h1 data-testid="title">{slots.title as any}</h1>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <div data-testid="body">{slots.body as any}</div>
    </div>
  ),
};

const codeStatListImageTemplate: SlideTemplate<{
  hero: "image";
  snippet: "code";
  bullets: "list";
  metric: "stat";
}> = {
  id: "kitchen-sink",
  label: "Kitchen sink",
  description: "Exercises the non-text slot kinds.",
  slots: {
    hero: { kind: "image", label: "Hero", required: true },
    snippet: { kind: "code", label: "Snippet", required: true },
    bullets: { kind: "list", label: "Bullets", required: true },
    metric: { kind: "stat", label: "Metric", required: true },
  },
  render: ({ slots }) => (
    <article>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <div data-testid="hero">{slots.hero as any}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <div data-testid="snippet">{slots.snippet as any}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <div data-testid="bullets">{slots.bullets as any}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <div data-testid="metric">{slots.metric as any}</div>
    </article>
  ),
};

const testRegistry = buildTemplateRegistry({
  "/src/templates/title-only/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: titleOnlyTemplate as any,
  },
  "/src/templates/two-slot/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: twoSlotTemplate as any,
  },
  "/src/templates/kitchen-sink/index.tsx": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: codeStatListImageTemplate as any,
  },
});

const baseSlide = (overrides: Partial<DataSlide> = {}): DataSlide => ({
  id: "s1",
  template: "title-only",
  slots: {
    title: { kind: "text", value: "Hello world" },
  },
  ...overrides,
});

describe("renderDataSlide", () => {
  it("returns a ReactNode that renders the resolved slot content", () => {
    const node = renderDataSlide(baseSlide(), 0, testRegistry);
    const { getByTestId } = render(<>{node}</>);
    expect(getByTestId("title").textContent).toBe("Hello world");
  });

  it("renders a fallback when the template id is unknown", () => {
    const node = renderDataSlide(
      baseSlide({ template: "no-such-template" }),
      0,
      testRegistry,
    );
    const { getByRole } = render(<>{node}</>);
    const alert = getByRole("alert");
    expect(alert.textContent).toMatch(/no-such-template/);
  });

  it("renders a fallback when slot validation fails (kind mismatch)", () => {
    const node = renderDataSlide(
      baseSlide({
        template: "two-slot",
        slots: {
          title: { kind: "text", value: "ok" },
          // body should be richtext — passing text triggers a kind mismatch.
          body: { kind: "text", value: "wrong kind" },
        },
      }),
      0,
      testRegistry,
    );
    const { getByRole } = render(<>{node}</>);
    const alert = getByRole("alert");
    expect(alert.textContent).toMatch(/body/);
  });

  it("renders a fallback when a required slot is missing", () => {
    const node = renderDataSlide(
      baseSlide({
        template: "two-slot",
        slots: {
          title: { kind: "text", value: "only title" },
        },
      }),
      0,
      testRegistry,
    );
    const { getByRole } = render(<>{node}</>);
    expect(getByRole("alert").textContent).toMatch(/body/);
  });

  it("does not throw when slots are malformed; surfaces an error UI instead", () => {
    expect(() => {
      const node = renderDataSlide(
        baseSlide({
          template: "two-slot",
          slots: {
            title: { kind: "text", value: "ok" },
          },
        }),
        0,
        testRegistry,
      );
      render(<>{node}</>);
    }).not.toThrow();
  });

  it("hides slot content whose revealAt > current phase (Reveal mount/unmount)", () => {
    const slide = baseSlide({
      slots: {
        title: { kind: "text", value: "phased title", revealAt: 2 },
      },
    });
    const { queryByTestId, rerender } = render(
      <>{renderDataSlide(slide, 0, testRegistry)}</>,
    );
    // The <h1 data-testid="title"> wraps the wrapped slot content; the heading
    // itself still renders, but it has no text content because <Reveal> with
    // phase 0 < revealAt 2 returns null for its children.
    expect(queryByTestId("title")?.textContent ?? "").toBe("");

    rerender(<>{renderDataSlide(slide, 2, testRegistry)}</>);
    expect(queryByTestId("title")?.textContent).toBe("phased title");
  });

  it("treats slot.revealAt of 0 as immediately visible", () => {
    const slide = baseSlide({
      slots: {
        title: { kind: "text", value: "always", revealAt: 0 },
      },
    });
    const { getByTestId } = render(
      <>{renderDataSlide(slide, 0, testRegistry)}</>,
    );
    expect(getByTestId("title").textContent).toBe("always");
  });

  it("defaults to revealAt 0 when the slot has no revealAt set", () => {
    const slide = baseSlide({
      slots: {
        title: { kind: "text", value: "default reveal" },
      },
    });
    const { getByTestId } = render(
      <>{renderDataSlide(slide, 0, testRegistry)}</>,
    );
    expect(getByTestId("title").textContent).toBe("default reveal");
  });

  it("renders an image slot as <img> with src + alt", () => {
    const slide: DataSlide = {
      id: "s",
      template: "kitchen-sink",
      slots: {
        hero: {
          kind: "image",
          src: "/img/hero.png",
          alt: "the hero",
        },
        snippet: { kind: "code", lang: "ts", value: "const x = 1;" },
        bullets: { kind: "list", items: ["one", "two"] },
        metric: { kind: "stat", value: "99%", caption: "uptime" },
      },
    };
    const { container } = render(
      <>{renderDataSlide(slide, 0, testRegistry)}</>,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/img/hero.png");
    expect(img?.getAttribute("alt")).toBe("the hero");
  });

  it("renders a code slot as <pre><code> with a language class", () => {
    const slide: DataSlide = {
      id: "s",
      template: "kitchen-sink",
      slots: {
        hero: { kind: "image", src: "/x.png", alt: "x" },
        snippet: { kind: "code", lang: "tsx", value: "const x = 1;" },
        bullets: { kind: "list", items: ["a"] },
        metric: { kind: "stat", value: "1" },
      },
    };
    const { container } = render(
      <>{renderDataSlide(slide, 0, testRegistry)}</>,
    );
    const pre = container.querySelector("pre");
    const code = pre?.querySelector("code");
    expect(code?.className).toContain("language-tsx");
    expect(code?.textContent).toBe("const x = 1;");
  });

  it("renders a list slot as <ul> with one <li> per item", () => {
    const slide: DataSlide = {
      id: "s",
      template: "kitchen-sink",
      slots: {
        hero: { kind: "image", src: "/x.png", alt: "x" },
        snippet: { kind: "code", lang: "ts", value: "" },
        bullets: { kind: "list", items: ["alpha", "beta", "gamma"] },
        metric: { kind: "stat", value: "1" },
      },
    };
    const { container } = render(
      <>{renderDataSlide(slide, 0, testRegistry)}</>,
    );
    const items = container.querySelectorAll("ul li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe("alpha");
    expect(items[2].textContent).toBe("gamma");
  });

  it("renders a stat slot with the value and optional caption", () => {
    const slide: DataSlide = {
      id: "s",
      template: "kitchen-sink",
      slots: {
        hero: { kind: "image", src: "/x.png", alt: "x" },
        snippet: { kind: "code", lang: "ts", value: "" },
        bullets: { kind: "list", items: [] },
        metric: { kind: "stat", value: "42ms", caption: "p95 latency" },
      },
    };
    const { getByTestId } = render(
      <>{renderDataSlide(slide, 0, testRegistry)}</>,
    );
    const metric = getByTestId("metric");
    expect(metric.textContent).toContain("42ms");
    expect(metric.textContent).toContain("p95 latency");
  });
});
