/**
 * Unit tests for the shared Shiki module.
 *
 * The Shiki granular imports are mocked to a deterministic stub so the
 * test runs in-memory without loading real grammars. Mirrors the mock
 * surface used by `CodeSlotEditor.test.tsx` and `render.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { codeToHtmlSpy } = vi.hoisted(() => ({
  codeToHtmlSpy: vi.fn((code: string, opts: { lang: string; theme: string }) => {
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre class="shiki" data-lang="${opts.lang}" data-theme="${opts.theme}"><code>${escaped}</code></pre>`;
  }),
}));

vi.mock("shiki/core", () => ({
  createHighlighterCore: vi.fn(async () => ({
    codeToHtml: codeToHtmlSpy,
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

import {
  __resetHighlighterForTests,
  getHighlighter,
  highlight,
  isSupportedLang,
} from "./shiki";

beforeEach(() => {
  __resetHighlighterForTests();
  codeToHtmlSpy.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("isSupportedLang", () => {
  it("accepts each canonical language", () => {
    for (const lang of [
      "ts",
      "js",
      "tsx",
      "jsx",
      "json",
      "html",
      "css",
      "sh",
      "sql",
      "python",
      "ruby",
      "go",
      "rust",
      "yaml",
      "md",
    ]) {
      expect(isSupportedLang(lang)).toBe(true);
    }
  });
  it("rejects unknown languages", () => {
    expect(isSupportedLang("brainfuck")).toBe(false);
    expect(isSupportedLang("")).toBe(false);
  });
});

describe("getHighlighter", () => {
  it("memoizes the highlighter promise (singleton across calls)", async () => {
    const a = await getHighlighter();
    const b = await getHighlighter();
    expect(a).toBe(b);
  });
});

describe("highlight", () => {
  it("returns Shiki HTML for a known language with the requested theme", async () => {
    const html = await highlight("const x = 1;", "ts");
    expect(html).toContain('data-lang="ts"');
    expect(html).toContain('data-theme="github-light"');
    expect(html).toContain("const x = 1;");
  });

  it("HTML-escapes the code in the highlighted output", async () => {
    const html = await highlight("<a>&</a>", "html");
    expect(html).toContain("&lt;a&gt;&amp;&lt;/a&gt;");
    // Confirm the raw markup did NOT survive — no real <a> tag is in the
    // output text outside the wrapped code block.
    expect(html).not.toMatch(/<a>(?:[^<]|<[^/])/);
  });
});

describe("highlight cache", () => {
  it("returns identical output across repeated calls with the same (lang, code)", async () => {
    const a = await highlight("const x = 1;", "ts");
    const b = await highlight("const x = 1;", "ts");
    expect(a).toBe(b);
  });

  it("only invokes Shiki once per unique (lang, code) tuple", async () => {
    await highlight("const x = 1;", "ts");
    await highlight("const x = 1;", "ts");
    await highlight("const x = 1;", "ts");
    expect(codeToHtmlSpy).toHaveBeenCalledTimes(1);
  });

  it("caches distinct entries for distinct code with the same lang", async () => {
    await highlight("const x = 1;", "ts");
    await highlight("const y = 2;", "ts");
    expect(codeToHtmlSpy).toHaveBeenCalledTimes(2);
    // Re-issuing either call hits cache.
    await highlight("const x = 1;", "ts");
    await highlight("const y = 2;", "ts");
    expect(codeToHtmlSpy).toHaveBeenCalledTimes(2);
  });

  it("caches distinct entries for the same code in different languages", async () => {
    await highlight("x", "ts");
    await highlight("x", "js");
    expect(codeToHtmlSpy).toHaveBeenCalledTimes(2);
    // Re-issuing either call hits cache.
    await highlight("x", "ts");
    await highlight("x", "js");
    expect(codeToHtmlSpy).toHaveBeenCalledTimes(2);
  });

  it("caches the fallback path for unknown languages too", async () => {
    // Force the Shiki path to throw so we exercise the fallback branch.
    codeToHtmlSpy.mockImplementationOnce(() => {
      throw new Error("unknown lang");
    });
    const a = await highlight("oops", "brainfuck");
    const b = await highlight("oops", "brainfuck");
    expect(a).toBe(b);
    expect(a).toContain("oops");
    // Spy was invoked once (and threw); the second call hits cache and
    // does NOT re-enter Shiki.
    expect(codeToHtmlSpy).toHaveBeenCalledTimes(1);
  });

  it("does not collide when lang+code separator boundary is ambiguous", async () => {
    // If the cache key were `${lang}:${code}`, then ("a", "b:c") and
    // ("a:b", "c") would both serialize to "a:b:c" and collide. Using
    // `::` makes that vanishingly unlikely. Verify both tuples produce
    // independent cache entries (and independent Shiki invocations).
    await highlight("b:c", "a");
    await highlight("c", "a:b");
    expect(codeToHtmlSpy).toHaveBeenCalledTimes(2);
  });
});
