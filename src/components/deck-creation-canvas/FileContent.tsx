/**
 * File content panel rendered to the right of the file tree. Shows
 * the file currently being written (or, post-AI-gen, the last
 * completed file). When the file is mid-write, a subtle blinking
 * caret hints at the streaming-input progress.
 *
 * Pure presentational. Syntax highlighting is intentionally NOT
 * implemented in V1 — the streaming content is often mid-token-syntax
 * (no closing brace yet), which trips most highlighters. Plain
 * monospace with line numbers is honest about what the model is
 * emitting. Issue #178 sub-pieces 1 + 3.
 */

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

export function FileContent({ file, slug }: FileContentProps) {
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

  return (
    <div
      data-testid="deck-creation-file-content"
      data-path={file.path}
      data-state={file.state}
      className="flex h-full flex-col"
    >
      <header className="border-b border-cf-text/10 px-4 py-2 text-xs font-mono text-cf-text-muted">
        {displayPath(file.path, slug)}
        {file.state === "writing" ? (
          <span className="ml-2 text-cf-orange">· writing</span>
        ) : null}
      </header>
      <pre
        className="m-0 flex-1 overflow-auto p-4 text-xs leading-relaxed text-cf-text"
        data-testid="deck-creation-file-content-body"
      >
        <code className="font-mono whitespace-pre-wrap break-words">
          {file.content}
          {file.state === "writing" ? (
            <span
              data-testid="deck-creation-writing-caret"
              className="ml-0.5 inline-block w-1.5 h-3 bg-cf-orange animate-pulse align-middle"
              aria-hidden
            />
          ) : null}
        </code>
      </pre>
    </div>
  );
}
