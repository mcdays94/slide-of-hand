/**
 * `<CodeSlotEditor>` — language-picker + textarea + Shiki preview.
 *
 * Edits `{ kind: "code", lang, value, revealAt? }`.
 *
 * Layout: the textarea on the left (monospace, soft tabs handled by the
 * browser default), the syntax-highlighted preview on the right. Both
 * panes scroll independently — the preview can grow taller than the
 * textarea for long snippets without tying the textarea height to it.
 *
 * Shiki is lazy-loaded via dynamic import on first mount of the editor.
 * That keeps the public viewer bundle lean — neither the deck index nor
 * a deck-without-code-slides should pull Shiki. The highlighter is a
 * module-level singleton; subsequent CodeSlotEditor mounts within the
 * same session reuse it and emit highlighted HTML synchronously
 * (well — same tick after the first await resolves).
 *
 * Languages: a NARROW allowlist (TS/JS family + a few common back-end
 * langs + JSON/HTML/CSS/SH/SQL/YAML/MD). Loading every Shiki language
 * adds ~300 KB to the bundle; the allowlist keeps it ~one grammar each.
 *
 * Filename-hint auto-detect: when the user types/pastes a snippet and
 * the FIRST line is a comment containing a path with a known extension
 * (`// foo.py`, `# bar.rb`, `<!-- baz.html -->`), AND the editor is
 * still on the default lang (`ts`), we auto-switch the lang. Once a
 * user has explicitly picked a non-default lang we stop trying — we
 * don't want a paste of someone's mixed-snippet to clobber their
 * deliberate choice.
 *
 * Test posture: a `vi.mock("shiki", ...)` stub in the test file replaces
 * `createHighlighter` with a deterministic `<pre data-lang="...">` shape.
 * The component does NOT import shiki statically — only via dynamic
 * `import("shiki")` inside an effect, so the mock applies cleanly.
 */

import { useEffect, useRef, useState } from "react";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";

export interface CodeSlotEditorProps {
  name: string;
  spec: SlotSpec;
  value: Extract<SlotValue, { kind: "code" }>;
  onChange: (next: Extract<SlotValue, { kind: "code" }>) => void;
}

/**
 * Canonical allowlist of languages. The labels are friendly display
 * strings; the values are Shiki's grammar IDs.
 */
const LANG_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "ts", label: "TypeScript" },
  { value: "js", label: "JavaScript" },
  { value: "tsx", label: "TSX" },
  { value: "jsx", label: "JSX" },
  { value: "json", label: "JSON" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "sh", label: "Shell" },
  { value: "sql", label: "SQL" },
  { value: "python", label: "Python" },
  { value: "ruby", label: "Ruby" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "yaml", label: "YAML" },
  { value: "md", label: "Markdown" },
];

const SUPPORTED_LANGS = LANG_OPTIONS.map((o) => o.value);
const DEFAULT_LANG = "ts";

// Map of common file extensions → our canonical lang ids.
const EXT_TO_LANG: Record<string, string> = {
  ts: "ts",
  mts: "ts",
  cts: "ts",
  js: "js",
  mjs: "js",
  cjs: "js",
  tsx: "tsx",
  jsx: "jsx",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  sql: "sql",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  yaml: "yaml",
  yml: "yaml",
  md: "md",
  markdown: "md",
};

/**
 * Detect a language from a filename-hint comment in the first line.
 * Returns the matched lang or `null` if no hint is present.
 *
 * Patterns recognized (the value before the path can be any non-empty
 * sequence; we just look for a known extension after a final `.`):
 *
 *   // foo/bar.py
 *   # script.rb
 *   <!-- index.html -->
 *   /* style.css *​/
 */
export function detectLangFromHint(value: string): string | null {
  // Inspect the first non-empty line.
  const firstLine = value.split(/\r?\n/, 1)[0] ?? "";
  // Look for a path-ish token ending in `.<ext>`. Greedy on the path
  // segment, but stop at whitespace, quotes, or comment-close.
  const match = /\.([a-zA-Z]+)(?=[\s"'\\>*]|$)/.exec(firstLine);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

// ── Shiki singleton ──────────────────────────────────────────────────────
//
// We cache the highlighter instance + the in-flight Promise at module
// scope. Multiple CodeSlotEditor instances sharing the same session reuse
// the same highlighter; concurrent first-mounts share the same Promise.
//
// Bundle-size posture: we deliberately do NOT import from the top-level
// `"shiki"` entry, which would pull in EVERY language Shiki ships
// (~6 MB raw, hundreds of chunks at build time). Instead we go through
// `shiki/core` + the JavaScript regex engine (no WASM blob) and
// dynamically import ONLY the 15 grammars in our allowlist + a single
// theme. Net: ~tens of KB per grammar (gzipped) loaded lazily on first
// code-slot edit.
//
// Tests mock `"shiki/core"`, the engine, and each granular lang/theme
// import. See CodeSlotEditor.test.tsx — the mock surface is small
// because we exercise a single stable function (`createHighlighterCore`).

interface ShikiHighlighter {
  codeToHtml: (code: string, opts: { lang: string; theme: string }) => string;
}

let highlighterPromise: Promise<ShikiHighlighter> | null = null;

async function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [
        { createHighlighterCore },
        { createJavaScriptRegexEngine },
        themeGitHubLight,
        langTs,
        langJs,
        langTsx,
        langJsx,
        langJson,
        langHtml,
        langCss,
        langSh,
        langSql,
        langPython,
        langRuby,
        langGo,
        langRust,
        langYaml,
        langMd,
      ] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
        import("@shikijs/themes/github-light"),
        import("@shikijs/langs/typescript"),
        import("@shikijs/langs/javascript"),
        import("@shikijs/langs/tsx"),
        import("@shikijs/langs/jsx"),
        import("@shikijs/langs/json"),
        import("@shikijs/langs/html"),
        import("@shikijs/langs/css"),
        import("@shikijs/langs/bash"),
        import("@shikijs/langs/sql"),
        import("@shikijs/langs/python"),
        import("@shikijs/langs/ruby"),
        import("@shikijs/langs/go"),
        import("@shikijs/langs/rust"),
        import("@shikijs/langs/yaml"),
        import("@shikijs/langs/markdown"),
      ]);
      return (await createHighlighterCore({
        engine: createJavaScriptRegexEngine(),
        themes: [themeGitHubLight.default],
        langs: [
          langTs.default,
          langJs.default,
          langTsx.default,
          langJsx.default,
          langJson.default,
          langHtml.default,
          langCss.default,
          langSh.default,
          langSql.default,
          langPython.default,
          langRuby.default,
          langGo.default,
          langRust.default,
          langYaml.default,
          langMd.default,
        ],
      })) as ShikiHighlighter;
    })();
  }
  return highlighterPromise;
}

export function CodeSlotEditor({
  name,
  spec,
  value,
  onChange,
}: CodeSlotEditorProps) {
  const langId = `slot-${name}-lang`;
  const valueId = `slot-${name}-value`;
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  // Track whether the user has explicitly picked a lang — prevents the
  // auto-detect from overwriting a deliberate choice.
  const userPickedLang = useRef(value.lang !== DEFAULT_LANG);

  // Render the preview whenever code or lang changes.
  useEffect(() => {
    let cancelled = false;
    if (value.value.length === 0) {
      setHighlightedHtml("");
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const hl = await getHighlighter();
        if (cancelled) return;
        const html = hl.codeToHtml(value.value, {
          lang: value.lang,
          theme: "github-light",
        });
        if (cancelled) return;
        setHighlightedHtml(html);
      } catch {
        // If Shiki fails (e.g. unknown lang) fall back to a plain
        // <pre> render so the editor still functions.
        if (cancelled) return;
        const escaped = value.value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        setHighlightedHtml(
          `<pre class="shiki-fallback"><code>${escaped}</code></pre>`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value.value, value.lang]);

  const emit = (nextLang: string, nextValue: string) => {
    const next: Extract<SlotValue, { kind: "code" }> = {
      kind: "code",
      lang: nextLang,
      value: nextValue,
    };
    if (value.revealAt !== undefined) next.revealAt = value.revealAt;
    onChange(next);
  };

  const onTextChange = (rawNext: string) => {
    let nextLang = value.lang;
    // Auto-detect from filename hint, but only if the user hasn't
    // explicitly picked a non-default lang yet.
    if (!userPickedLang.current && value.lang === DEFAULT_LANG) {
      const detected = detectLangFromHint(rawNext);
      if (detected) {
        nextLang = detected;
      }
    }
    emit(nextLang, rawNext);
  };

  const onLangChange = (nextLang: string) => {
    userPickedLang.current = true;
    emit(nextLang, value.value);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={valueId}
          className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
        >
          {spec.label}
          {spec.required && (
            <span aria-label="required" className="ml-1 text-cf-orange">
              *
            </span>
          )}
        </label>
        <div className="flex items-center gap-2">
          <label
            htmlFor={langId}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-muted"
          >
            Lang
          </label>
          <select
            id={langId}
            data-interactive
            data-testid={`slot-code-lang-${name}`}
            value={value.lang}
            onChange={(e) => onLangChange(e.target.value)}
            className="rounded border border-cf-border bg-cf-bg-100 px-2 py-1 font-mono text-xs text-cf-text outline-none focus:border-cf-orange"
          >
            {LANG_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {/* Render a fallback option if `value.lang` isn't in the
                allowlist (e.g. legacy data) — keeps the dropdown
                round-tripable without dropping the user's choice. */}
            {!SUPPORTED_LANGS.includes(value.lang) && (
              <option value={value.lang}>{value.lang} (custom)</option>
            )}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <textarea
          id={valueId}
          data-interactive
          data-testid={`slot-code-value-${name}`}
          value={value.value}
          placeholder={spec.placeholder ?? "Paste code here…"}
          maxLength={spec.maxLength}
          rows={8}
          spellCheck={false}
          onChange={(e) => onTextChange(e.target.value)}
          className="resize-y rounded border border-cf-border bg-cf-bg-100 px-3 py-2 font-mono text-xs leading-snug text-cf-text outline-none focus:border-cf-orange"
        />
        <div
          data-testid={`slot-code-preview-${name}`}
          className="overflow-auto rounded border border-dashed border-cf-border bg-cf-bg-200 px-3 py-2 font-mono text-xs leading-snug text-cf-text [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:bg-transparent"
        >
          {value.value.length === 0 ? (
            <span className="italic text-cf-text-muted">Preview…</span>
          ) : highlightedHtml ? (
            <div
              data-testid={`slot-code-preview-html-${name}`}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <pre>
              <code>{value.value}</code>
            </pre>
          )}
        </div>
      </div>
      {spec.description && (
        <p className="text-xs text-cf-text-muted">{spec.description}</p>
      )}
    </div>
  );
}
