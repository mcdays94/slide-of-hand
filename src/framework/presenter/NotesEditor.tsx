/**
 * Notes editor for the presenter view.
 *
 * Item G (issue #111). Replaces the read-only `<div>{notes}</div>` in
 * SpeakerNotes with an in-place editor that supports two modes:
 *
 *   - **Rich text** (default): a `contentEditable` div with a small
 *     toolbar (Bold / Italic / H2 / unordered list / ordered list).
 *     Toolbar buttons use `document.execCommand` — old API but still
 *     reliable for these basic operations and zero-dep.
 *   - **Markdown source**: a `<textarea>` showing the raw markdown.
 *     Toggling between modes round-trips via:
 *       - markdown -> HTML: small in-house renderer (avoids pulling in
 *         a full react-markdown render path inside contentEditable).
 *       - HTML -> markdown: turndown.
 *
 * Persistence: every edit debounces to localStorage at ~800ms via
 * `notes-storage.ts`. The build-time `slide.notes` (passed as
 * `defaultRendered`) is used as the initial value when no override is
 * stored. A "Reset" button clears the override and re-renders the
 * default.
 */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TurndownService from "turndown";
import { useAccessAuth } from "@/lib/use-access-auth";
import {
  clearNotesOverride,
  readNotesOverride,
  writeNotesOverride,
} from "./notes-storage";

const SAVE_DEBOUNCE_MS = 800;

// Singleton turndown configured for our small subset.
const td = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  emDelimiter: "_",
});

/**
 * Tiny markdown -> HTML for our authoring subset. NOT a full markdown
 * parser — just the constructs the toolbar produces:
 *   - `# heading` (h1) and `## heading` (h2)
 *   - `**bold**`, `__bold__`, `*italic*`, `_italic_`
 *   - `- item` (ul), `1. item` (ol)
 *   - paragraphs separated by blank lines
 * Anything fancier the user types in markdown mode survives in the
 * source view but renders as a plain paragraph in the WYSIWYG view.
 *
 * For build-time `slide.notes` (a `ReactNode`), we render to HTML once
 * via `renderToStaticMarkup` and bypass the markdown parser entirely.
 */
function markdownToHtml(md: string): string {
  // Lightweight: split into blocks, classify each as heading / list /
  // paragraph, then render. Inline formatting handled per-block.
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.match(/^#\s+/)) {
      out.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`);
      i++;
    } else if (line.match(/^##\s+/)) {
      out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
      i++;
    } else if (line.match(/^-\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^-\s+/)) {
        items.push(`<li>${inline(lines[i].replace(/^-\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (line.match(/^\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
    } else if (line.trim() === "") {
      i++;
    } else {
      // Collect consecutive non-blank, non-list lines as a paragraph.
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].match(/^(#{1,2}\s+|-\s+|\d+\.\s+)/)
      ) {
        para.push(lines[i]);
        i++;
      }
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return out.join("");
}

function inline(s: string): string {
  // **bold** / __bold__
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // *italic* / _italic_ (avoid eating the inner * of **bold** by being
  // simpler; this runs after bold replacement)
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
  return s;
}

export interface NotesEditorProps {
  slug: string;
  slideIndex: number;
  /** Build-time default (the deck author's `slide.notes` ReactNode). */
  defaultNotes?: ReactNode;
  /** Visual font-size class to pass to the editor surface. */
  fontSizeClass: string;
}

type Mode = "rich" | "markdown";

/** Render a ReactNode to a static HTML string for editor seeding. */
function renderDefaultToHtml(node: ReactNode): string {
  if (node == null) return "";
  try {
    return renderToStaticMarkup(<>{node}</>);
  } catch {
    return "";
  }
}

export function NotesEditor({
  slug,
  slideIndex,
  defaultNotes,
  fontSizeClass,
}: NotesEditorProps) {
  // Issue #120: editing requires a valid Cloudflare Access session.
  // The presenter view itself is public, but speaker-notes editing
  // belongs to the deck author. While the probe is in-flight we treat
  // the editor as read-only to avoid a flash of editable UI.
  const authStatus = useAccessAuth();
  const canEdit = authStatus === "authenticated";

  // The source-of-truth value, in markdown. Initialized from
  // localStorage (override) or from the build-time ReactNode (converted
  // to HTML, then HTML -> markdown via turndown).
  const buildTimeMarkdown = useMemo(() => {
    const html = renderDefaultToHtml(defaultNotes);
    if (!html) return "";
    try {
      return td.turndown(html);
    } catch {
      return "";
    }
  }, [defaultNotes]);

  const [markdown, setMarkdown] = useState<string>(() => {
    const stored = readNotesOverride(slug, slideIndex);
    return stored ?? buildTimeMarkdown;
  });
  const [mode, setMode] = useState<Mode>("rich");
  const [hasOverride, setHasOverride] = useState<boolean>(() => {
    return readNotesOverride(slug, slideIndex) !== null;
  });
  const richRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-load on slide / deck change.
  useEffect(() => {
    const stored = readNotesOverride(slug, slideIndex);
    setMarkdown(stored ?? buildTimeMarkdown);
    setHasOverride(stored !== null);
  }, [slug, slideIndex, buildTimeMarkdown]);

  // Debounced persistence.
  const persist = useCallback(
    (next: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        writeNotesOverride(slug, slideIndex, next);
        setHasOverride(next !== "");
      }, SAVE_DEBOUNCE_MS);
    },
    [slug, slideIndex],
  );

  // Seed the rich editor's HTML when entering rich mode or when
  // markdown changes from a non-edit source.
  const html = useMemo(() => markdownToHtml(markdown), [markdown]);
  useEffect(() => {
    if (mode !== "rich") return;
    const el = richRef.current;
    if (!el) return;
    if (el.innerHTML !== html) {
      el.innerHTML = html;
    }
  }, [html, mode]);

  // Rich-mode: on input, convert HTML back to markdown + persist.
  // No-op when read-only (unauthenticated): contentEditable is off,
  // so this shouldn't fire, but the guard is defense-in-depth in case
  // a browser plugin or assistive tech triggers an input event.
  const onRichInput = useCallback(() => {
    if (!canEdit) return;
    const el = richRef.current;
    if (!el) return;
    let next = "";
    try {
      next = td.turndown(el.innerHTML);
    } catch {
      next = el.innerText;
    }
    setMarkdown(next);
    persist(next);
  }, [persist, canEdit]);

  const onMarkdownChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!canEdit) return;
      const next = e.target.value;
      setMarkdown(next);
      persist(next);
    },
    [persist, canEdit],
  );

  const exec = useCallback(
    (cmd: string, value?: string) => {
      if (!canEdit) return;
      if (typeof document === "undefined") return;
      document.execCommand(cmd, false, value);
      // Trigger an input event so onRichInput fires + persists.
      const el = richRef.current;
      if (el) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    [canEdit],
  );

  const onReset = useCallback(() => {
    if (!canEdit) return;
    clearNotesOverride(slug, slideIndex);
    setMarkdown(buildTimeMarkdown);
    setHasOverride(false);
  }, [slug, slideIndex, buildTimeMarkdown, canEdit]);

  // Cleanup debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        // Flush pending write on unmount so we don't lose data.
        // Only flushes if we were authenticated to begin with — read-
        // only callers shouldn't be writing on unmount.
        if (canEdit) {
          writeNotesOverride(slug, slideIndex, markdown);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      data-testid="notes-editor"
      data-mode={mode}
      data-auth-status={authStatus}
      data-can-edit={canEdit ? "true" : "false"}
      className="flex h-full min-h-0 flex-col gap-2"
    >
      {/* Toolbar — mode toggle is always visible (read-only users may
          still want to flip between rich and markdown views), but the
          rich-mode formatting buttons + the reset button only appear
          when `canEdit` is true (i.e. the user has a valid Access
          session). */}
      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em]">
        <button
          type="button"
          data-testid="notes-mode-rich"
          data-active={mode === "rich"}
          onClick={() => setMode("rich")}
          data-interactive
          className={`rounded border px-2 py-1 transition-colors hover:border-dashed ${
            mode === "rich"
              ? "border-cf-orange text-cf-orange"
              : "border-cf-border text-cf-text-muted"
          }`}
        >
          Rich
        </button>
        <button
          type="button"
          data-testid="notes-mode-markdown"
          data-active={mode === "markdown"}
          onClick={() => setMode("markdown")}
          data-interactive
          className={`rounded border px-2 py-1 transition-colors hover:border-dashed ${
            mode === "markdown"
              ? "border-cf-orange text-cf-orange"
              : "border-cf-border text-cf-text-muted"
          }`}
        >
          Markdown
        </button>
        {canEdit && mode === "rich" && (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-cf-border" />
            <button
              type="button"
              data-testid="notes-toolbar-bold"
              data-interactive
              onClick={() => exec("bold")}
              title="Bold (Cmd/Ctrl+B)"
              className="rounded border border-cf-border px-2 py-1 text-cf-text-muted transition-colors hover:border-dashed hover:text-cf-text"
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              data-testid="notes-toolbar-italic"
              data-interactive
              onClick={() => exec("italic")}
              title="Italic (Cmd/Ctrl+I)"
              className="rounded border border-cf-border px-2 py-1 italic text-cf-text-muted transition-colors hover:border-dashed hover:text-cf-text"
            >
              I
            </button>
            <button
              type="button"
              data-testid="notes-toolbar-h2"
              data-interactive
              onClick={() => exec("formatBlock", "<h2>")}
              title="Heading 2"
              className="rounded border border-cf-border px-2 py-1 text-cf-text-muted transition-colors hover:border-dashed hover:text-cf-text"
            >
              H2
            </button>
            <button
              type="button"
              data-testid="notes-toolbar-ul"
              data-interactive
              onClick={() => exec("insertUnorderedList")}
              title="Bulleted list"
              className="rounded border border-cf-border px-2 py-1 text-cf-text-muted transition-colors hover:border-dashed hover:text-cf-text"
            >
              ●
            </button>
            <button
              type="button"
              data-testid="notes-toolbar-ol"
              data-interactive
              onClick={() => exec("insertOrderedList")}
              title="Numbered list"
              className="rounded border border-cf-border px-2 py-1 text-cf-text-muted transition-colors hover:border-dashed hover:text-cf-text"
            >
              1.
            </button>
          </>
        )}
        <span className="flex-1" />
        {canEdit && hasOverride && (
          <button
            type="button"
            data-testid="notes-reset"
            data-interactive
            onClick={onReset}
            title="Discard your edits and revert to the deck author's notes"
            className="rounded border border-cf-border px-2 py-1 text-cf-text-subtle transition-colors hover:border-cf-danger hover:text-cf-danger"
          >
            Reset
          </button>
        )}
      </div>

      {/* Read-only banner — shown only when the auth probe has resolved
          to "unauthenticated". During the brief "checking" state we
          render no banner (and the editor is also disabled), so there
          is no flash of either editable UI or "sign in" copy on a
          legitimately-authenticated user's screen. */}
      {authStatus === "unauthenticated" && (
        <p
          data-testid="notes-readonly-banner"
          className="rounded-md border border-dashed border-cf-border bg-cf-bg-100 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle"
        >
          Read-only ·{" "}
          <a
            href="/admin"
            data-testid="notes-readonly-signin-link"
            data-interactive
            className="text-cf-orange underline-offset-2 hover:underline"
          >
            sign in via /admin
          </a>{" "}
          to edit speaker notes.
        </p>
      )}

      {/* Editor surface */}
      {mode === "rich" ? (
        <div
          ref={richRef}
          data-testid="notes-rich-editor"
          contentEditable={canEdit}
          suppressContentEditableWarning
          onInput={onRichInput}
          data-interactive={canEdit ? true : undefined}
          aria-readonly={canEdit ? undefined : true}
          className={`presenter-notes flex-1 space-y-3 overflow-y-auto rounded-md border border-cf-border bg-cf-bg-100 p-3 pr-2 text-cf-text-muted outline-none focus:border-cf-orange/60 ${fontSizeClass} ${
            canEdit ? "" : "cursor-default select-text"
          }`}
        />
      ) : (
        <textarea
          data-testid="notes-markdown-editor"
          data-interactive={canEdit ? true : undefined}
          value={markdown}
          onChange={onMarkdownChange}
          readOnly={!canEdit}
          spellCheck={false}
          className={`flex-1 resize-none rounded-md border border-cf-border bg-cf-bg-100 p-3 font-mono text-cf-text-muted outline-none focus:border-cf-orange/60 ${fontSizeClass}`}
        />
      )}
    </div>
  );
}
