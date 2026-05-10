/**
 * Shared Shiki highlighter — the single source of truth for syntax-
 * highlighted code rendering across the editor + the deck renderer.
 *
 * Two consumers today:
 *
 *   - `<CodeSlotEditor>` (admin-only path): calls `highlight()` on every
 *     keystroke to rebuild the live preview pane.
 *   - `renderSlot()` for code slots (public path): renders code-slot
 *     content inside KV-backed decks, also via `highlight()`.
 *
 * Both share the same module-level singleton, the same narrow language
 * allowlist (15 grammars), the same theme (`github-light`), and the same
 * lazy-load posture (the dynamic imports only fire on first call).
 *
 * ## Bundle posture
 *
 * We deliberately do NOT import from the top-level `"shiki"` entry,
 * which would pull in EVERY language Shiki ships (~6 MB raw). Instead
 * we go through `shiki/core` + the JavaScript regex engine (no WASM
 * blob) and dynamically import ONLY the 15 grammars in our allowlist
 * + a single theme. Net: ~tens of KB per grammar (gzipped) loaded
 * lazily on first call.
 *
 * Because both callers use the same dynamic-import surface, public decks
 * that don't contain a code slot never load Shiki — the renderer's
 * `<ShikiCodeBlock>` component (in `src/framework/templates/render.tsx`)
 * lazy-loads via `useEffect`, so first paint of a code-free deck pulls
 * none of these chunks.
 */

const SUPPORTED_LANGS = [
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
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/** True if a string is one of our 15 allowlisted languages. */
export function isSupportedLang(lang: string): lang is SupportedLang {
  return (SUPPORTED_LANGS as readonly string[]).includes(lang);
}

interface ShikiHighlighter {
  codeToHtml: (code: string, opts: { lang: string; theme: string }) => string;
}

let highlighterPromise: Promise<ShikiHighlighter> | null = null;

/**
 * Resolve the module-level Shiki highlighter, lazy-loading on first
 * call. Multiple concurrent first-callers share the same promise.
 */
export async function getHighlighter(): Promise<ShikiHighlighter> {
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

/**
 * Process-local memoization of `highlight()` output keyed by
 * `${lang}::${code}`.
 *
 * Why: in multi-slot decks (e.g. several code slots showing the same
 * snippet, or a slide that re-renders on phase change), `codeToHtml`
 * gets called repeatedly with identical inputs. Tokenisation is the
 * dominant cost in the Shiki pipeline once the highlighter is warm, so
 * a flat `Map<string, string>` collapses the repeat work to O(1) hash
 * lookups.
 *
 * - **Separator:** `::` (two colons), not `:`. Single-colon would let
 *   `("a", "b:c")` and `("a:b", "c")` collide; `::` is vanishingly
 *   unlikely to appear at a tuple boundary.
 * - **Lifecycle:** module-scoped, persists for the life of the worker
 *   isolate / browser tab. No invalidation hook (Shiki output is a pure
 *   function of `(lang, code, theme)` and the theme is fixed).
 * - **Memory:** entries are short HTML strings (few hundred bytes
 *   each); the corpus of distinct snippets per deck is small. No
 *   eviction policy in v1.
 * - **Both branches:** the fallback HTML is cached too, so repeated
 *   calls with an unsupported language don't re-throw through Shiki on
 *   every invocation.
 */
const highlightCache = new Map<string, string>();

/**
 * Resets the module-level singleton AND the highlight cache. Test-only —
 * production code should NOT call this (it would invalidate every
 * consumer's outstanding highlight call). Exported with a deliberate
 * `__test`-prefixed name so grep makes the intent obvious.
 */
export function __resetHighlighterForTests(): void {
  highlighterPromise = null;
  highlightCache.clear();
}

/**
 * HTML-escape `code` so the fallback path emits safe markup. Used by
 * `highlight()` when Shiki throws (e.g. unknown language) so callers
 * always get a renderable string.
 */
function escapeHtml(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Highlight `code` as `lang` and return Shiki HTML, or a safe escaped
 * `<pre><code>` fallback if Shiki rejects the language. Always async —
 * Shiki's `codeToHtml` is sync once the highlighter resolves, but the
 * highlighter resolution itself is async (and the public bundle posture
 * depends on that staying that way; see top-of-file).
 *
 * The returned string is HTML — render via
 * `dangerouslySetInnerHTML={{ __html: ... }}`. This is safe: Shiki
 * escapes user code into `<span>`-wrapped tokens, and the fallback
 * branch escapes manually too. Neither path emits unescaped user input.
 */
export async function highlight(code: string, lang: string): Promise<string> {
  const key = `${lang}::${code}`;
  const cached = highlightCache.get(key);
  if (cached !== undefined) return cached;
  let html: string;
  try {
    const hl = await getHighlighter();
    html = hl.codeToHtml(code, { lang, theme: "github-light" });
  } catch {
    html = `<pre class="shiki-fallback"><code>${escapeHtml(code)}</code></pre>`;
  }
  highlightCache.set(key, html);
  return html;
}
