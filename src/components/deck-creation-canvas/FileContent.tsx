/**
 * File content panel rendered to the right of the file tree. Shows
 * the file currently being written (or, post-AI-gen, the last
 * completed file). When the file is mid-write, a subtle blinking
 * caret hints at the streaming-input progress.
 *
 * ## Syntax highlighting
 *
 * Lazy-loaded via the shared `@/lib/shiki` helper, mirroring the
 * pattern used by `<ShikiCodeBlock>` in
 * `src/framework/templates/render.tsx`:
 *
 * - First paint renders plain `<pre><code>` so the layout doesn't
 *   shift on Shiki resolution (and the test environment's
 *   synchronous first render still works).
 * - A useEffect calls `highlight(content, lang)` and swaps in the
 *   highlighted HTML when it resolves.
 * - Mid-token content (e.g. `export default {` with no closing
 *   brace) is handled gracefully by Shiki's TextMate grammar —
 *   tokens after the cursor are left un-styled rather than the whole
 *   block falling back to plain text.
 * - Unknown extensions skip Shiki entirely and render plain.
 *
 * The streaming caret is rendered as a flow child OUTSIDE the
 * highlighted HTML block (we can't easily inject it inside an
 * opaque `dangerouslySetInnerHTML` string), so it appears at the
 * end of the content while the file is still being written.
 *
 * Issue #178 sub-pieces 1 + 3 (canvas) + the syntax-highlight polish.
 */

import { useEffect, useState } from "react";
import { highlight, isSupportedLang, type SupportedLang } from "@/lib/shiki";
import type { DeckCreationSnapshot } from "@/lib/deck-creation-snapshot";

export interface FileContentProps {
  file: DeckCreationSnapshot["files"][number] | undefined;
  /** Deck slug — used for the heading's display path. */
  slug?: string;
}

function displayPath(path: string, slug: string | undefined): string {
  if (!slug) return path;
  const prefix = `src/decks/public/${slug}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Map a file path's extension to a Shiki language id, or `null` if
 * we don't want to highlight (unsupported extension / no extension).
 * Kept narrow on purpose: the model's deck files are .tsx / .ts /
 * occasionally .css / .json / .md; anything else is rare enough that
 * skipping Shiki and rendering plain is the better default than
 * relying on Shiki's per-call fallback.
 */
export function pathToLang(path: string): SupportedLang | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot === path.length - 1) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  // Common alias: yml → yaml. Everything else matches the Shiki id
  // 1:1 because our allowlist already uses the canonical names.
  const lang = ext === "yml" ? "yaml" : ext;
  return isSupportedLang(lang) ? lang : null;
}

export function FileContent({ file, slug }: FileContentProps) {
  const [html, setHtml] = useState<string | null>(null);

  // Highlight on every (content, path) change. We reset to null on
  // path change so the new file's first paint is plain (no flash of
  // the previous file's highlighted HTML on top of the new file's
  // content). `cancelled` guards against an in-flight highlight call
  // landing after the effect has been superseded.
  useEffect(() => {
    if (!file) {
      setHtml(null);
      return;
    }
    const lang = pathToLang(file.path);
    if (!lang) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const out = await highlight(file.content, lang);
      if (cancelled) return;
      setHtml(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [file?.content, file?.path, file]);

  if (!file) {
    return (
      <div
        data-testid="deck-creation-file-content"
        data-empty="true"
        className="flex h-full items-center justify-center text-sm text-cf-text-muted"
      >
        Pick a file to see its content.
      </div>
    );
  }

  const isWriting = file.state === "writing";

  return (
    <div
      data-testid="deck-creation-file-content"
      data-path={file.path}
      data-state={file.state}
      className="flex h-full flex-col"
    >
      <header className="border-b border-cf-text/10 px-4 py-2 text-xs font-mono text-cf-text-muted">
        {displayPath(file.path, slug)}
        {isWriting ? (
          <span className="ml-2 text-cf-orange">· writing</span>
        ) : null}
      </header>
      <div
        // The body wrapper provides scrolling + our base padding.
        // We strip Shiki's inline background + padding via the
        // [&_pre.shiki] arbitrary selector so the GitHub-light theme
        // blends with the canvas's warm-cream surface instead of
        // showing as a white box-on-cream.
        className="flex-1 overflow-auto p-4 text-xs leading-relaxed text-cf-text [&_pre.shiki]:!bg-transparent [&_pre.shiki]:!m-0 [&_pre.shiki]:!p-0"
        data-testid="deck-creation-file-content-body"
      >
        {html === null ? (
          // First paint / unsupported lang / no-content branch.
          // Wrapped in <pre><code> so layout matches the eventual
          // Shiki output structurally — no shift on resolution.
          <pre className="m-0">
            <code className="font-mono whitespace-pre-wrap break-words">
              {file.content}
            </code>
          </pre>
        ) : (
          // eslint-disable-next-line react/no-danger -- Shiki escapes user code into trusted HTML; see src/lib/shiki.ts
          <div dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {isWriting ? (
          <span
            data-testid="deck-creation-writing-caret"
            className="ml-0.5 inline-block w-1.5 h-3 bg-cf-orange animate-pulse align-middle"
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}
