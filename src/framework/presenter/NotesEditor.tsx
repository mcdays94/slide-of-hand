/**
 * Notes editor for the presenter view (issue #126).
 *
 * Replaces the previous hand-rolled `contentEditable` + markdown↔HTML
 * roundtrip with a real document-model editor: TipTap (React wrapper
 * around ProseMirror). The roundtrip pattern caused a notorious
 * cursor-jump-to-position-0 bug because it reset `el.innerHTML` on
 * every keystroke whenever the regenerated HTML differed from the
 * current DOM (whitespace normalisation, attribute-order shuffling,
 * etc.). TipTap manages its own document model and never resets the
 * DOM out from under the user.
 *
 * The editor exposes:
 *   - **Rich text** (default): TipTap with a PowerPoint-style toolbar
 *     (Bold / Italic / Underline / Strike / H2 / BulletList /
 *     OrderedList / Link / HR).
 *   - **Markdown source**: a `<textarea>` showing the markdown source.
 *     Toggling between modes round-trips through a markdown converter
 *     (`marked` for md→HTML and `turndown` for HTML→md). Persistence
 *     boundary stays markdown — a stable, portable format.
 *   - **Upload .md**: file picker that loads a `.md` file's content
 *     directly into the markdown source and switches to rich view.
 *
 * The default mode (rich vs markdown) is configurable per-user via the
 * presenter settings (`notesDefaultMode`).
 *
 * Auth gate (issue #120) preserved: when `useAccessAuth()` resolves
 * to `unauthenticated`, the editor downgrades to a read-only view
 * with a sign-in banner and no toolbar / upload / reset buttons.
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
import {
  EditorContent,
  type Editor,
  type EditorEvents,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TurndownService from "turndown";
import { useAccessAuth } from "@/lib/use-access-auth";
import { useSettings } from "@/framework/viewer/useSettings";
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
 * Lightweight markdown -> HTML for our authoring subset. NOT a full
 * markdown parser — just the constructs the toolbar produces:
 *   - `# heading` (h1) and `## heading` (h2)
 *   - `**bold**`, `__bold__`, `*italic*`, `_italic_`
 *   - `[text](url)` for links
 *   - `- item` (ul), `1. item` (ol)
 *   - `---` horizontal rules
 *   - paragraphs separated by blank lines
 *
 * For build-time `slide.notes` (a `ReactNode`), we render to HTML once
 * via `renderToStaticMarkup` and bypass the markdown parser entirely.
 */
function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.match(/^---+$/)) {
      out.push(`<hr>`);
      i++;
    } else if (line.match(/^#\s+/)) {
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
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].match(/^(#{1,2}\s+|-\s+|\d+\.\s+|---+$)/)
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
  // **bold** / __bold__ first so the bold markers don't confuse italic
  // detection.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // *italic* / _italic_
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
  // [text](url) — minimal link parsing. URL must not contain `)` to
  // keep the regex simple; matches the common case.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
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

/**
 * Convert TipTap's HTML output to markdown for persistence. Same
 * turndown singleton used for the build-time default.
 */
function htmlToMarkdown(html: string): string {
  if (!html) return "";
  try {
    return td.turndown(html);
  } catch {
    return html;
  }
}

export function NotesEditor({
  slug,
  slideIndex,
  defaultNotes,
  fontSizeClass,
}: NotesEditorProps) {
  // Issue #120: editing requires a valid Cloudflare Access session.
  const authStatus = useAccessAuth();
  const canEdit = authStatus === "authenticated";

  // Issue #126: which mode the editor opens in is per-user configurable.
  const { settings } = useSettings();

  // Source-of-truth value, in markdown.
  const buildTimeMarkdown = useMemo(() => {
    const html = renderDefaultToHtml(defaultNotes);
    return htmlToMarkdown(html);
  }, [defaultNotes]);

  const [markdown, setMarkdown] = useState<string>(() => {
    const stored = readNotesOverride(slug, slideIndex);
    return stored ?? buildTimeMarkdown;
  });
  const [mode, setMode] = useState<Mode>(settings.notesDefaultMode);
  const [hasOverride, setHasOverride] = useState<boolean>(() => {
    return readNotesOverride(slug, slideIndex) !== null;
  });
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkUrlDraft, setLinkUrlDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // TipTap's `useEditor` returns the Editor instance synchronously,
  // but the command manager / ProseMirror view isn't fully attached
  // until `onCreate` fires. Touching `editor.commands.*` before that
  // throws "Cannot read properties of null". This flag gates every
  // imperative editor mutation we do from outside the React tree.
  const [editorReady, setEditorReady] = useState(false);

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

  // The TipTap editor itself. Source of truth for rich-mode content.
  // We wire `onUpdate` to write back to markdown state on every change
  // — TipTap's incremental DOM updates preserve cursor position, so
  // this is safe (unlike the previous el.innerHTML=html roundtrip).
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Heading: keep h1+h2 in the schema; only h2 is in the toolbar
        // (h1 is for paste-from-elsewhere).
        heading: { levels: [1, 2] },
        // StarterKit v3 bundles Link + Underline. Disable both here so
        // we can register our own configured copies below without the
        // "Duplicate extension names found" warning.
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "text-cf-orange underline-offset-2 hover:underline",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
    ],
    content: markdownToHtml(markdown),
    editable: canEdit,
    editorProps: {
      attributes: {
        class: `presenter-notes flex-1 space-y-3 overflow-y-auto rounded-md border border-cf-border bg-cf-bg-100 p-3 pr-2 text-cf-text-muted outline-none focus:border-cf-orange/60 ${fontSizeClass} ${
          canEdit ? "" : "cursor-default select-text"
        }`,
        "data-testid": "notes-rich-editor",
        "aria-readonly": canEdit ? "false" : "true",
      },
    },
    onCreate: () => {
      setEditorReady(true);
    },
    onDestroy: () => {
      setEditorReady(false);
    },
    onUpdate: ({ editor: ed }: EditorEvents["update"]) => {
      if (!canEdit) return;
      const html = ed.getHTML();
      const next = htmlToMarkdown(html);
      setMarkdown(next);
      persist(next);
    },
  });

  // Re-load when the slug or slide index changes. Refreshes both the
  // markdown state and (if in rich mode) the editor content.
  useEffect(() => {
    const stored = readNotesOverride(slug, slideIndex);
    const next = stored ?? buildTimeMarkdown;
    setMarkdown(next);
    setHasOverride(stored !== null);
    if (editor && editorReady) {
      // `emitUpdate: false` so this slug-change-driven content swap
      // doesn't trigger persist().
      editor.commands.setContent(markdownToHtml(next), { emitUpdate: false });
    }
  }, [slug, slideIndex, buildTimeMarkdown, editor, editorReady]);

  // Toggle TipTap's editable flag whenever auth state flips.
  // `setEditable` is safe to call before the view is attached — it
  // just updates a flag; the view picks it up on first render.
  useEffect(() => {
    if (editor) editor.setEditable(canEdit);
  }, [editor, canEdit]);

  // When mode flips from markdown -> rich, push the markdown source
  // into the editor (the user may have edited it directly).
  useEffect(() => {
    if (!editor || !editorReady) return;
    if (mode !== "rich") return;
    const html = markdownToHtml(markdown);
    if (editor.getHTML() !== html) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
    // We intentionally don't depend on `markdown` so typing in the
    // rich editor (which updates `markdown` via onUpdate) doesn't loop
    // back through this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editor, editorReady]);

  const onMarkdownChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!canEdit) return;
      const next = e.target.value;
      setMarkdown(next);
      persist(next);
    },
    [persist, canEdit],
  );

  const onReset = useCallback(() => {
    if (!canEdit) return;
    clearNotesOverride(slug, slideIndex);
    setMarkdown(buildTimeMarkdown);
    setHasOverride(false);
    if (editor && editorReady) {
      editor.commands.setContent(markdownToHtml(buildTimeMarkdown), {
        emitUpdate: false,
      });
    }
  }, [slug, slideIndex, buildTimeMarkdown, editor, editorReady, canEdit]);

  const onUploadMarkdown = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!canEdit) return;
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        setMarkdown(text);
        persist(text);
        setMode("rich");
        if (editor && editorReady) {
          editor.commands.setContent(markdownToHtml(text), {
            emitUpdate: false,
          });
        }
      };
      reader.readAsText(file);
      // Allow re-upload of the same filename later.
      e.target.value = "";
    },
    [canEdit, editor, editorReady, persist],
  );

  // Open the link picker, prefilling with the existing href if the
  // selection sits on a link node.
  const openLinkPicker = useCallback(() => {
    if (!canEdit || !editor) return;
    const existing = editor.getAttributes("link").href as string | undefined;
    setLinkUrlDraft(existing ?? "");
    setLinkPickerOpen(true);
  }, [canEdit, editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const url = linkUrlDraft.trim();
    if (!url) {
      // Empty URL = unset existing link.
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkPickerOpen(false);
  }, [editor, linkUrlDraft]);

  // Cleanup debounce + flush pending write on unmount. Mirrors the old
  // editor's behaviour so a quick mode-change-then-unmount doesn't lose
  // data.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
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
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em]">
        <ModeButton
          mode="rich"
          activeMode={mode}
          onClick={() => setMode("rich")}
          testId="notes-mode-rich"
        >
          Rich
        </ModeButton>
        <ModeButton
          mode="markdown"
          activeMode={mode}
          onClick={() => setMode("markdown")}
          testId="notes-mode-markdown"
        >
          Markdown
        </ModeButton>

        {canEdit && mode === "rich" && editor && (
          <>
            <ToolbarDivider />
            <ToolbarButton
              testId="notes-toolbar-bold"
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={editor.isActive("bold")}
              title="Bold (Cmd/Ctrl+B)"
              label="B"
              labelClass="font-bold"
            />
            <ToolbarButton
              testId="notes-toolbar-italic"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={editor.isActive("italic")}
              title="Italic (Cmd/Ctrl+I)"
              label="I"
              labelClass="italic"
            />
            <ToolbarButton
              testId="notes-toolbar-underline"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              active={editor.isActive("underline")}
              title="Underline (Cmd/Ctrl+U)"
              label="U"
              labelClass="underline underline-offset-2"
            />
            <ToolbarButton
              testId="notes-toolbar-strike"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              active={editor.isActive("strike")}
              title="Strikethrough"
              label="S"
              labelClass="line-through"
            />
            <ToolbarDivider />
            <ToolbarButton
              testId="notes-toolbar-h2"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              active={editor.isActive("heading", { level: 2 })}
              title="Heading 2"
              label="H2"
            />
            <ToolbarDivider />
            <ToolbarButton
              testId="notes-toolbar-ul"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              active={editor.isActive("bulletList")}
              title="Bulleted list"
              label="●"
            />
            <ToolbarButton
              testId="notes-toolbar-ol"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              active={editor.isActive("orderedList")}
              title="Numbered list"
              label="1."
            />
            <ToolbarDivider />
            <ToolbarButton
              testId="notes-toolbar-link"
              onClick={openLinkPicker}
              active={editor.isActive("link")}
              title="Link (Cmd/Ctrl+K)"
              label="🔗"
            />
            <ToolbarButton
              testId="notes-toolbar-hr"
              onClick={() =>
                editor.chain().focus().setHorizontalRule().run()
              }
              active={false}
              title="Horizontal rule"
              label="—"
            />
          </>
        )}

        <span className="flex-1" />

        {canEdit && (
          <>
            <button
              type="button"
              data-testid="notes-upload-md"
              data-interactive
              onClick={() => fileInputRef.current?.click()}
              title="Upload a .md file to replace these speaker notes"
              className="rounded border border-cf-border px-2 py-1 text-cf-text-subtle transition-colors hover:border-dashed hover:text-cf-text"
            >
              ↑ .md
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown,text/plain"
              data-testid="notes-upload-md-input"
              onChange={onUploadMarkdown}
              className="hidden"
            />
          </>
        )}

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

      {/* Read-only banner (auth gate). */}
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

      {/* Link picker — appears as an inline mini-form when the user
          clicks the link toolbar button. We don't use a modal so the
          editor selection state stays intact. */}
      {linkPickerOpen && (
        <LinkPicker
          value={linkUrlDraft}
          onChange={setLinkUrlDraft}
          onApply={applyLink}
          onCancel={() => setLinkPickerOpen(false)}
        />
      )}

      {/* Editor surface */}
      {mode === "rich" ? (
        <EditorContent editor={editor} className="flex-1 min-h-0 flex flex-col" />
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

interface ModeButtonProps {
  mode: Mode;
  activeMode: Mode;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}

function ModeButton({
  mode,
  activeMode,
  onClick,
  testId,
  children,
}: ModeButtonProps) {
  const isActive = mode === activeMode;
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={isActive}
      onClick={onClick}
      data-interactive
      className={`rounded border px-2 py-1 transition-colors hover:border-dashed ${
        isActive
          ? "border-cf-orange text-cf-orange"
          : "border-cf-border text-cf-text-muted"
      }`}
    >
      {children}
    </button>
  );
}

interface ToolbarButtonProps {
  testId: string;
  onClick: () => void;
  active: boolean;
  title: string;
  label: string;
  labelClass?: string;
}

function ToolbarButton({
  testId,
  onClick,
  active,
  title,
  label,
  labelClass,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active}
      data-interactive
      onClick={onClick}
      title={title}
      className={`rounded border px-2 py-1 transition-colors hover:border-dashed ${
        active
          ? "border-cf-orange bg-cf-orange/10 text-cf-orange"
          : "border-cf-border text-cf-text-muted hover:text-cf-text"
      }`}
    >
      <span className={labelClass}>{label}</span>
    </button>
  );
}

function ToolbarDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-cf-border" />;
}

interface LinkPickerProps {
  value: string;
  onChange: (next: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

function LinkPicker({ value, onChange, onApply, onCancel }: LinkPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the input on mount so the user can type immediately
  // after clicking the link button.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      data-testid="notes-link-picker"
      className="flex items-center gap-2 rounded-md border border-cf-orange/40 bg-cf-orange/5 p-2"
    >
      <input
        ref={inputRef}
        type="url"
        placeholder="https://…"
        data-testid="notes-link-picker-input"
        data-interactive
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onApply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="flex-1 rounded border border-cf-border bg-cf-bg-100 px-2 py-1 text-xs text-cf-text outline-none focus:border-cf-orange/60"
      />
      <button
        type="button"
        data-testid="notes-link-picker-apply"
        data-interactive
        onClick={onApply}
        className="rounded border border-cf-orange bg-cf-orange/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-orange transition-colors hover:bg-cf-orange/20"
      >
        Apply
      </button>
      <button
        type="button"
        data-testid="notes-link-picker-cancel"
        data-interactive
        onClick={onCancel}
        className="rounded border border-cf-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle transition-colors hover:border-dashed hover:text-cf-text"
      >
        Cancel
      </button>
    </div>
  );
}

// Default export so the file can be lazy-imported via React.lazy().
export default NotesEditor;
// Editor type re-export for any consumer that wants to type-check
// against TipTap's Editor without importing from @tiptap/react.
export type { Editor };
