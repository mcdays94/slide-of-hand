/**
 * File tree rendered on the left of the deck-creation canvas. Lists
 * every file the model has emitted so far in the order it emitted
 * them. The currently-writing file gets a subtle pulse + "writing"
 * badge; completed files get a check-mark.
 *
 * Pure presentational. Takes the files array from the latest
 * `DeckCreationSnapshot` plus a `slug` to strip the deck folder
 * prefix in the display (the model's paths are full repo-rooted,
 * but the canvas wants to show `meta.ts`, not
 * `src/decks/public/<slug>/meta.ts`). Issue #178 sub-pieces 1 + 3.
 */

import type { DeckCreationSnapshot } from "@/lib/deck-creation-snapshot";

export interface FileTreeProps {
  files: DeckCreationSnapshot["files"];
  /** Path of the file to mark as actively selected (== currently writing). */
  activePath?: string;
  /** Deck slug — used to compute the display prefix to strip. */
  slug?: string;
}

/** Strip `src/decks/public/<slug>/` from a path for display. */
function displayPath(path: string, slug: string | undefined): string {
  if (!slug) return path;
  const prefix = `src/decks/public/${slug}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function FileTree({ files, activePath, slug }: FileTreeProps) {
  if (files.length === 0) {
    return (
      <div
        data-testid="deck-creation-file-tree"
        data-empty="true"
        className="text-sm text-cf-text-muted px-3 py-2"
      >
        Waiting for the model to emit the first file…
      </div>
    );
  }
  return (
    <ul
      data-testid="deck-creation-file-tree"
      className="flex flex-col gap-1 text-sm"
    >
      {files.map((file) => {
        const isActive = activePath === file.path;
        const stateLabel = file.state === "writing" ? "writing" : "done";
        return (
          <li
            key={file.path}
            data-testid={`deck-creation-file-tree-item-${file.path}`}
            data-state={file.state}
            data-active={isActive ? "true" : "false"}
            className={`flex items-center justify-between rounded-md px-3 py-1.5 ${
              isActive
                ? "bg-cf-orange/10 text-cf-orange"
                : file.state === "done"
                  ? "text-cf-text"
                  : "text-cf-text-muted"
            }`}
          >
            <span className="truncate font-mono text-xs">
              {displayPath(file.path, slug)}
            </span>
            <span
              data-testid={`deck-creation-file-state-${file.path}`}
              className={`ml-2 shrink-0 text-[10px] uppercase tracking-wider ${
                file.state === "writing"
                  ? "text-cf-orange animate-pulse"
                  : "text-cf-text-muted"
              }`}
            >
              {stateLabel}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
