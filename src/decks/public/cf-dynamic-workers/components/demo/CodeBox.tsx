import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Highlight } from "prism-react-renderer";
import { ArrowDown } from "lucide-react";
import { easeButton } from "../../lib/motion";
import { CornerBrackets } from "../../components/primitives/CornerBrackets";
import { DECK_DARK_THEME } from "../../lib/code-theme";
import type { Snippet, SnippetId } from "../../lib/snippets";

/**
 * CodeBox — the left-hand half of slide 08. Tabbed snippet selector,
 * code preview (with optional inline edit), Spawn button, and a
 * Retry button on failure.
 *
 * Deep module: caller passes a snippet list, an active id, and a
 * `onSpawn(code?)` callback. CodeBox owns the edit-mode toggle and
 * the local edited-code state. The button states (loading / disabled
 * / retry) are driven by the `status` prop so the parent stays the
 * source of truth for the spawn lifecycle.
 */

export type CodeBoxStatus = "idle" | "loading" | "result" | "failed";

export interface CodeBoxProps {
  snippets: Snippet[];
  active: SnippetId;
  onTabChange: (id: SnippetId) => void;
  /** Called with `undefined` if the user kept the canonical snippet,
   * or with the edited string if they used the edit textarea. */
  onSpawn: (code?: string) => void;
  status: CodeBoxStatus;
  /** Optional human-readable error to show on the Retry row. */
  errorMessage?: string;
  className?: string;
}

/**
 * SyntaxHighlightedCode — Prism-rendered TypeScript with the deck's
 * shared dark theme (`@/lib/code-theme`). Black background (so the code
 * stands out against the warm-cream card), Cloudflare orange for
 * keywords/function names, plus muted greys for comments and
 * punctuation.
 *
 * `min-h-0` and `flex-1` are critical so the parent flex column can
 * correctly subtract the surrounding chrome (tabs, description, button
 * row) before sizing this scroll region. Without `min-h-0` long
 * snippets push the slide past the footer line.
 *
 * `flexFill` lets a caller opt out of `flex-1`. The parent-worker code
 * block uses `flexFill={false}` because it needs an intrinsic max
 * height (capped at maxHeightPx) — the SPAWNED block is the one that
 * should grow to fill remaining space.
 *
 * IMPORTANT: we destructure `style` from Prism's render prop and apply
 * it to the <pre>. This carries the theme's `plain` color/background.
 * Without it, tokens that fall through to "plain" inherit the
 * surrounding `text-cf-text` (warm dark brown) and become unreadable
 * on the near-black code surface — that bug ate a session of polish
 * before this comment existed.
 */
function SyntaxHighlightedCode({
  code,
  flexFill = true,
  maxHeightPx,
  testId = "code-preview",
}: {
  code: string;
  flexFill?: boolean;
  maxHeightPx?: number;
  testId?: string;
}) {
  return (
    <div
      className={[
        "min-h-0 overflow-auto rounded-md border border-[#2a2825] bg-[#1c1b19] p-4 font-mono text-[12px] leading-relaxed text-[#fffbf5]",
        flexFill ? "flex-1" : "",
      ].join(" ")}
      style={maxHeightPx ? { maxHeight: maxHeightPx } : undefined}
      data-testid={testId}
    >
      <Highlight code={code.trimEnd()} language="tsx" theme={DECK_DARK_THEME}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre className="m-0 p-0" style={{ ...style, background: "transparent" }}>
            {tokens.map((line, i) => {
              const { key: _lineKey, ...lineProps } = getLineProps({ line });
              return (
                <div key={i} {...lineProps}>
                  <span className="mr-3 inline-block w-6 select-none text-right text-[#52432f]">
                    {i + 1}
                  </span>
                  {line.map((token, k) => {
                    const { key: _tokenKey, ...tokenProps } = getTokenProps({
                      token,
                    });
                    return <span key={k} {...tokenProps} />;
                  })}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

export function CodeBox({
  snippets,
  active,
  onTabChange,
  onSpawn,
  status,
  errorMessage,
  className = "",
}: CodeBoxProps) {
  const activeSnippet = snippets.find((s) => s.id === active) ?? snippets[0];
  const [editing, setEditing] = useState(false);
  const [editedCode, setEditedCode] = useState<string>(activeSnippet.code);

  // Reset edited code whenever the active snippet changes — so toggling
  // tabs doesn't carry a stale user edit into a different snippet.
  useEffect(() => {
    setEditing(false);
    setEditedCode(activeSnippet.code);
  }, [activeSnippet.id, activeSnippet.code]);

  const handleSpawn = useCallback(() => {
    if (editing) {
      onSpawn(editedCode);
    } else {
      onSpawn(undefined);
    }
  }, [editing, editedCode, onSpawn]);

  const isLoading = status === "loading";
  const isFailed = status === "failed";

  return (
    <div
      className={`flex h-full flex-col gap-4 ${className}`}
      data-testid="code-box"
    >
      {/* Tabs */}
      <nav className="flex flex-wrap gap-2" data-no-advance aria-label="Snippets">
        {snippets.map((s) => {
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onTabChange(s.id)}
              disabled={isLoading}
              className={[
                "rounded-md border px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                isActive
                  ? "border-cf-orange bg-cf-orange-light text-cf-orange"
                  : "border-cf-border bg-cf-bg-200 text-cf-text-muted hover:text-cf-text",
                isLoading ? "opacity-60" : "",
              ].join(" ")}
              data-interactive
              data-testid={`tab-${s.id}`}
              aria-pressed={isActive}
            >
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* Active snippet panel.
       *
       * Renders TWO code blocks stacked vertically:
       *   1. The PARENT worker — the deck's killer reveal: the whole
       *      "spawn a Dynamic Worker" gesture is a single function
       *      call. Capped at ~220 px so the audience sees it in full
       *      without scrolling, but doesn't dominate the panel.
       *   2. A "↓ spawned" connector pip linking the two visually.
       *   3. The SPAWNED snippet — what runs INSIDE the freshly-loaded
       *      isolate. This is the one the speaker can edit live.
       *
       * Without (1) the slide showed only the inside-the-isolate code
       * and the audience had to take it on faith that the parent was
       * doing anything. With (1) the call site itself is on screen.
       */}
      <CornerBrackets
        className="cf-card relative flex min-h-0 flex-1 flex-col p-6"
        inset={-3}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cf-text-muted">
              Snippet · {activeSnippet.id}
            </span>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle underline-offset-4 hover:text-cf-orange hover:underline"
              data-interactive
              data-testid="edit-toggle"
              aria-pressed={editing}
            >
              {editing ? "discard edit" : "edit (spawned)"}
            </button>
          </div>

          <p className="text-[13px] leading-snug text-cf-text-muted">
            {activeSnippet.description}
          </p>

          {/* Parent worker — fixed height, scrollable if needed. */}
          <div className="flex flex-col gap-1.5">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange"
              data-testid="parent-label"
            >
              Parent worker · index.ts
            </span>
            <SyntaxHighlightedCode
              code={activeSnippet.parentCode}
              flexFill={false}
              // 290 px fits the longest parent (spawn-many, 16 lines)
              // without internal scroll; the shorter parents simply
              // sit comfortably inside the cap. Tune in tandem with
              // the surrounding flex chain — bumping this shrinks the
              // spawned-code section below.
              maxHeightPx={290}
              testId="parent-code-preview"
            />
          </div>

          {/* Connector — orange arrow pip linking the two blocks. The
              motif is "the parent worker calls LOADER.load(...) and
              the result is the spawned code below". */}
          <div
            className="-my-1 flex items-center gap-2 self-center font-mono text-[10px] uppercase tracking-[0.18em] text-cf-orange"
            aria-hidden
          >
            <ArrowDown size={12} strokeWidth={2.2} />
            <span>spawns</span>
            <ArrowDown size={12} strokeWidth={2.2} />
          </div>

          {/* Spawned snippet — flex-1, takes remaining space, scrolls. */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange">
              Spawned worker · snippet.js
            </span>
            {editing ? (
              <textarea
                value={editedCode}
                onChange={(e) => setEditedCode(e.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none rounded-md border border-[#2a2825] bg-[#1c1b19] p-4 font-mono text-[12px] leading-relaxed text-[#fffbf5] outline-none focus:border-cf-orange"
                data-interactive
                data-testid="code-editor"
              />
            ) : (
              <SyntaxHighlightedCode code={activeSnippet.code} testId="code-preview" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <motion.button
              type="button"
              onClick={handleSpawn}
              disabled={isLoading}
              className="rounded-md bg-cf-orange px-7 py-3 font-mono text-sm uppercase tracking-[0.18em] text-white shadow-[0_8px_24px_rgba(255,72,1,0.28)] disabled:opacity-60"
              whileHover={!isLoading ? { y: -2 } : undefined}
              whileTap={!isLoading ? { y: 0, scale: 0.98 } : undefined}
              transition={{ duration: 0.18, ease: easeButton }}
              data-interactive
              data-testid="spawn-button"
            >
              {isLoading ? "Spawning…" : "Spawn"}
            </motion.button>

            {isFailed && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-1 flex-wrap items-center gap-3"
              >
                <span className="font-mono text-xs text-red-700" data-testid="error-text">
                  {errorMessage ?? "Spawn failed"}
                </span>
                <button
                  type="button"
                  onClick={handleSpawn}
                  className="rounded-md border border-red-300 bg-red-50 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-red-700 hover:bg-red-100"
                  data-interactive
                  data-testid="retry-button"
                >
                  Retry
                </button>
              </motion.div>
            )}
          </div>
        </div>
      </CornerBrackets>
    </div>
  );
}
