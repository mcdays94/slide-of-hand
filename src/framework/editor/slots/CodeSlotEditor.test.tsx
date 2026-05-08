/**
 * Component tests for `<CodeSlotEditor>`.
 *
 * Edits `{ kind: "code", lang, value, revealAt? }`.
 *
 * Shiki is mocked to a synchronous-ish stub so the preview renders
 * deterministically without loading the real grammar bundle. The mock
 * mirrors the public surface we use: `createHighlighter({ themes, langs })`
 * returning a `{ codeToHtml(code, opts) }` shape. The stub returns
 * `<pre class="shiki" data-lang="...">...</pre>` so we can assert which
 * language was rendered without parsing actual highlighted spans.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { SlotSpec } from "@/lib/template-types";

// Mock the granular shiki imports BEFORE importing the editor. vi.mock
// is hoisted, so this applies to the editor's dynamic imports too.
//
// The production editor uses `shiki/core` + `shiki/engine/javascript` +
// `@shikijs/themes/<name>` + `@shikijs/langs/<name>` to keep the bundle
// lean. Mocking each is cheap because the contracts are tiny — a
// `createHighlighterCore` factory and the `default` exports of the
// theme/lang modules.
vi.mock("shiki/core", () => ({
  createHighlighterCore: vi.fn(async () => ({
    codeToHtml: (code: string, opts: { lang: string; theme: string }) => {
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<pre class="shiki" data-lang="${opts.lang}"><code>${escaped}</code></pre>`;
    },
  })),
}));
vi.mock("shiki/engine/javascript", () => ({
  createJavaScriptRegexEngine: vi.fn(() => ({})),
}));
// Theme + each lang module: only need a `default` export — the mocked
// `createHighlighterCore` doesn't actually read it.
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

// Import AFTER vi.mock — vi.mock is hoisted to the top of the module
// regardless of import order, but keeping the editor import below makes
// the intent obvious.
import { CodeSlotEditor } from "./CodeSlotEditor";

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
});

const baseSpec: SlotSpec = {
  kind: "code",
  label: "Snippet",
  required: true,
  description: "Pick a language and paste code.",
};

describe("<CodeSlotEditor>", () => {
  it("renders the label, language picker, code textarea, and preview", () => {
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "const x = 1" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Snippet")).toBeDefined();
    expect(screen.getByTestId("slot-code-lang-snippet")).toBeDefined();
    expect(screen.getByTestId("slot-code-value-snippet")).toBeDefined();
    expect(screen.getByTestId("slot-code-preview-snippet")).toBeDefined();
  });

  it("shows the description below the editor", () => {
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Pick a language and paste code.")).toBeDefined();
  });

  it("shows the required indicator when spec.required is true", () => {
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("required")).toBeDefined();
  });

  it("hides the required indicator when spec.required is false", () => {
    render(
      <CodeSlotEditor
        name="snippet"
        spec={{ ...baseSpec, required: false }}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText("required")).toBeNull();
  });

  it("shows the canonical languages in the dropdown", () => {
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={() => {}}
      />,
    );
    const select = screen.getByTestId(
      "slot-code-lang-snippet",
    ) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    // Spot-check the canonical allowlist.
    for (const expected of [
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
      expect(optionValues).toContain(expected);
    }
  });

  it("emits a fresh code SlotValue when the language changes", () => {
    const onChange = vi.fn();
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "x" }}
        onChange={onChange}
      />,
    );
    const select = screen.getByTestId(
      "slot-code-lang-snippet",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "python" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "code",
      lang: "python",
      value: "x",
    });
  });

  it("emits a fresh code SlotValue when the textarea changes", () => {
    const onChange = vi.fn();
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByTestId(
      "slot-code-value-snippet",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "let y = 2" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "code",
      lang: "ts",
      value: "let y = 2",
    });
  });

  it("preserves revealAt across changes", () => {
    const onChange = vi.fn();
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "", revealAt: 2 }}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByTestId(
      "slot-code-value-snippet",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "code",
      lang: "ts",
      value: "x",
      revealAt: 2,
    });
  });

  it("shows a placeholder hint in the preview when value is empty", () => {
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={() => {}}
      />,
    );
    const preview = screen.getByTestId("slot-code-preview-snippet");
    expect(preview.textContent).toMatch(/preview/i);
  });

  it("renders the highlighted preview after Shiki resolves", async () => {
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{
          kind: "code",
          lang: "ts",
          value: "const x: number = 42",
        }}
        onChange={() => {}}
      />,
    );
    const preview = screen.getByTestId("slot-code-preview-snippet");
    await waitFor(() => {
      // The mocked Shiki output includes data-lang on the <pre>.
      expect(preview.querySelector("pre.shiki")).not.toBeNull();
    });
    const pre = preview.querySelector("pre.shiki") as HTMLPreElement;
    expect(pre.getAttribute("data-lang")).toBe("ts");
    expect(pre.textContent).toContain("const x: number = 42");
  });

  it("re-renders the preview when the language changes", async () => {
    const { rerender } = render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "x" }}
        onChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(
        screen
          .getByTestId("slot-code-preview-snippet")
          .querySelector("pre.shiki"),
      ).not.toBeNull();
    });
    rerender(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "python", value: "x" }}
        onChange={() => {}}
      />,
    );
    await waitFor(() => {
      const pre = screen
        .getByTestId("slot-code-preview-snippet")
        .querySelector("pre.shiki");
      expect(pre?.getAttribute("data-lang")).toBe("python");
    });
  });

  it("auto-detects language from a `// path/to/foo.py` hint comment", () => {
    const onChange = vi.fn();
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByTestId(
      "slot-code-value-snippet",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "// foo.py\nprint('hi')" },
    });
    // The first emit has the new value AND the auto-detected lang.
    const callArgs = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(callArgs).toMatchObject({
      kind: "code",
      lang: "python",
      value: "// foo.py\nprint('hi')",
    });
  });

  it("does NOT auto-detect when value already has a non-default lang", () => {
    const onChange = vi.fn();
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        // User explicitly chose `rust` already; a hint shouldn't override.
        value={{ kind: "code", lang: "rust", value: "" }}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByTestId(
      "slot-code-value-snippet",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "// foo.py\nprint('hi')" },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "code",
      lang: "rust",
      value: "// foo.py\nprint('hi')",
    });
  });

  it("does NOT auto-detect when there is no hint comment", () => {
    const onChange = vi.fn();
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByTestId(
      "slot-code-value-snippet",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "const x = 1" },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "code",
      lang: "ts",
      value: "const x = 1",
    });
  });

  it("renders the textarea with monospace styling (font-mono class)", () => {
    render(
      <CodeSlotEditor
        name="snippet"
        spec={baseSpec}
        value={{ kind: "code", lang: "ts", value: "" }}
        onChange={() => {}}
      />,
    );
    const textarea = screen.getByTestId("slot-code-value-snippet");
    expect(textarea.className).toContain("font-mono");
  });
});
