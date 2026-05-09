/**
 * Tests for `renderDataSlide()`.
 *
 * Framer Motion is mocked so jsdom-style assertions don't have to wait for
 * animation frames (mirrors `src/framework/viewer/Reveal.test.tsx`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { DataSlide } from "@/lib/deck-record";
import type { SlideTemplate } from "@/lib/template-types";

// Mock the Shiki granular imports so the lazy `<ShikiCodeBlock>` resolves
// to a deterministic highlighted output without pulling the real grammar
// bundles. Mirrors the mock surface in CodeSlotEditor.test.tsx.
vi.mock("shiki/core", () => ({
  createHighlighterCore: vi.fn(async () => ({
    codeToHtml: (code: string, opts: { lang: string; theme: string }) => {
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      // Emit a span-style structure resembling real Shiki output so the
      // existence-check tests are exercising something that approximates
      // the production render shape.
      return `<pre class="shiki" data-lang="${opts.lang}" style="background-color:#fff;color:#24292e"><code><span style="color:#24292e">${escaped}</span></code></pre>`;
    },
  })),
}));
vi.mock("shiki/engine/javascript", () => ({
  createJavaScriptRegexEngine: vi.fn(() => ({})),
}));
vi.mock("@shikijs/themes/github-light", () => ({ default: {} }));
vi.mock("@shikijs/langs/typescript", () => ({ default: [] }));
vi.mock("@shikijs/langs/javascript", () => ({ default: [] }));
vi.mock("@shikijs/langs/tsx", () => ({ default: [] }));
vi.mock("@shikijs/langs/jsx", () => ({ default: [] }));
vi.mock("@shikijs/langs/json", () => ({ default: [] }));
vi.mock("@shikijs/langs/html", () => ({ default: [] }));
vi.mock("@shikijs/langs/css", () => ({ default: [] }));
vi.mock("@shikijs/langs/bash", () => ({ default: [] }));
vi.mock("@shikijs/langs/sql", () => ({ default: [] }));
vi.mock("@shikijs/langs/python", () => ({ default: [] }));
vi.mock("@shikijs/langs/ruby", () => ({ default: [] }));
vi.mock("@shikijs/langs/go", () => ({ default: [] }));
vi.mock("@shikijs/langs/rust", () => ({ default: [] }));
vi.mock("@shikijs/langs/yaml", () => ({ default: [] }));
vi.mock("@shikijs/langs/markdown", () => ({ default: [] }));

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("renders a code slot as <pre><code> with a language class on first paint", () => {
    // Before the lazy Shiki import resolves, `<ShikiCodeBlock>` falls back
    // to a structurally-equivalent <pre><code class="language-<lang>"> so
    // first paint never goes blank.
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

  it("renders Shiki HTML for a code slot once the lazy import resolves (#73 follow-up)", async () => {
    const slide: DataSlide = {
      id: "s",
      template: "kitchen-sink",
      slots: {
        hero: { kind: "image", src: "/x.png", alt: "x" },
        snippet: { kind: "code", lang: "python", value: "print('hi')" },
        bullets: { kind: "list", items: ["a"] },
        metric: { kind: "stat", value: "1" },
      },
    };
    const { container } = render(
      <>{renderDataSlide(slide, 0, testRegistry)}</>,
    );
    // The mocked Shiki output sets `data-lang` on the <pre>; wait for it.
    await waitFor(() => {
      expect(container.querySelector("pre.shiki")).not.toBeNull();
    });
    const pre = container.querySelector("pre.shiki") as HTMLPreElement;
    expect(pre.getAttribute("data-lang")).toBe("python");
    // Highlighted output must include the user's code (escaped, wrapped
    // in spans by the mock).
    expect(pre.textContent).toContain("print('hi')");
    // Real Shiki emits inline `style="color:..."` markers — the mock
    // mirrors that so we can sanity-check the structure.
    expect(pre.innerHTML).toContain("<span");
  });

  it("escapes HTML in the lazy first-paint code render so user input cannot inject markup", () => {
    const slide: DataSlide = {
      id: "s",
      template: "kitchen-sink",
      slots: {
        hero: { kind: "image", src: "/x.png", alt: "x" },
        snippet: {
          kind: "code",
          lang: "html",
          value: "<script>alert(1)</script>",
        },
        bullets: { kind: "list", items: ["a"] },
        metric: { kind: "stat", value: "1" },
      },
    };
    const { container } = render(
      <>{renderDataSlide(slide, 0, testRegistry)}</>,
    );
    // First paint is a plain <pre><code>{...}</code></pre>; React already
    // escapes children, so a literal "<script>" string lives in textContent
    // and CANNOT have produced a real <script> element.
    expect(container.querySelector("script")).toBeNull();
    const code = container.querySelector("pre code");
    expect(code?.textContent).toContain("<script>");
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

  describe("richtext slot", () => {
    // The renderer wraps richtext markdown through `<RichTextRender>`
    // (a thin wrapper around `react-markdown`) so the deck viewer matches
    // the editor's right-pane preview. Before #81 it rendered as plain
    // text, leaking `**bold**` literals into the audience-facing slide.
    const richSlide = (md: string): DataSlide => ({
      id: "s",
      template: "two-slot",
      slots: {
        title: { kind: "text", value: "ok" },
        body: { kind: "richtext", value: md },
      },
    });

    it("renders **bold** as a <strong> element", () => {
      const { container } = render(
        <>{renderDataSlide(richSlide("**bold**"), 0, testRegistry)}</>,
      );
      const strong = container.querySelector("[data-testid='body'] strong");
      expect(strong?.textContent).toBe("bold");
    });

    it("renders _italic_ as an <em> element", () => {
      const { container } = render(
        <>{renderDataSlide(richSlide("_italic_"), 0, testRegistry)}</>,
      );
      const em = container.querySelector("[data-testid='body'] em");
      expect(em?.textContent).toBe("italic");
    });

    it("renders a markdown bulleted list as <ul><li>", () => {
      const { container } = render(
        <>
          {renderDataSlide(
            richSlide("- one\n- two\n- three"),
            0,
            testRegistry,
          )}
        </>,
      );
      const items = container.querySelectorAll(
        "[data-testid='body'] ul li",
      );
      expect(items).toHaveLength(3);
      expect(items[0].textContent).toBe("one");
      expect(items[2].textContent).toBe("three");
    });

    it("turns a blank-line break into two separate <p> elements", () => {
      const { container } = render(
        <>
          {renderDataSlide(
            richSlide("First paragraph.\n\nSecond paragraph."),
            0,
            testRegistry,
          )}
        </>,
      );
      const paragraphs = container.querySelectorAll(
        "[data-testid='body'] p",
      );
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0].textContent).toBe("First paragraph.");
      expect(paragraphs[1].textContent).toBe("Second paragraph.");
    });

    it("does not leave raw markdown delimiters in the rendered text", () => {
      const { container } = render(
        <>
          {renderDataSlide(
            richSlide("**bold** and _italic_"),
            0,
            testRegistry,
          )}
        </>,
      );
      const body = container.querySelector("[data-testid='body']");
      // A working renderer collapses delimiters into element wrappers,
      // so the user-facing text should never contain the literal `**` or
      // `_` markers.
      expect(body?.textContent ?? "").not.toContain("**");
      // Single underscore can legitimately appear in real prose, so we
      // assert specifically that the italic word is NOT bracketed by them.
      expect(body?.textContent ?? "").not.toMatch(/_italic_/);
    });
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
