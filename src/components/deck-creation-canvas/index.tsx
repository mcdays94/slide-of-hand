/**
 * Deck-creation canvas — the left-pane visualization on
 * `/admin/decks/new` once a `createDeckDraft` or `iterateOnDeckDraft`
 * tool-call lands. Shows:
 *
 *   - A six-chip phase strip (fork → clone → ai_gen → apply → commit → push)
 *   - A growing file tree as the model emits each file
 *   - The currently-writing file's content streaming in
 *   - An error overlay when a snapshot lands with `phase: "error"`
 *
 * Consumes `messages` from `useAgentChat` (or any compatible message
 * shape — see `extractLatestCall.ts` for the loose type). Self-
 * contained: the route just mounts this with messages and an optional
 * `onRetry` callback; everything else is internal.
 *
 * Issue #178 sub-pieces (1) + (3).
 */

import {
  extractLatestDeckCreationCall,
  isDeckCreationSnapshot,
  isDeckDraftToolResult,
  type DeckCreationMessage,
} from "./extractLatestCall";
import { PhaseStrip } from "./PhaseStrip";
import { FileTree } from "./FileTree";
import { FileContent } from "./FileContent";
import { ErrorOverlay } from "./ErrorOverlay";
import { ComposingOverlay } from "./ComposingOverlay";

export interface DeckCreationCanvasProps {
  messages: ReadonlyArray<DeckCreationMessage>;
  /**
   * Deck slug — used to strip the `src/decks/public/<slug>/` prefix
   * from displayed file paths. Optional: when unset the canvas
   * infers the slug from the first emitted file's path. Useful on
   * `/admin/decks/new` where the model picks the slug from the
   * user's prompt and the route doesn't know it ahead of time.
   */
  slug?: string;
  /**
   * Called when the user clicks "Retry" on the error overlay. Hidden
   * when undefined. Typically wired to `sendMessage(<lastUserPrompt>)`
   * from the route's `useAgentChat`.
   */
  onRetry?: () => void;
}

/**
 * Infer the deck slug from the first emitted file's path. Paths look
 * like `src/decks/public/<slug>/meta.ts`; we grab the segment after
 * `src/decks/public/`. Returns `undefined` if no file has been emitted
 * yet or the path doesn't match the expected shape.
 */
function inferSlug(files: Array<{ path: string }>): string | undefined {
  if (files.length === 0) return undefined;
  const path = files[0]?.path;
  if (!path) return undefined;
  const match = path.match(/^src\/decks\/public\/([^/]+)\//);
  return match?.[1];
}

export function DeckCreationCanvas({
  messages,
  slug: slugProp,
  onRetry,
}: DeckCreationCanvasProps) {
  const call = extractLatestDeckCreationCall(messages);

  // Pre-call / pre-output state: tool hasn't emitted any yields yet
  // (still input-streaming or input-available). The route only mounts
  // this component once a tool-call lands, so this branch shows a
  // brief "warming up" state.
  if (!call || call.output === undefined) {
    return (
      <div
        data-testid="deck-creation-canvas"
        data-state="warming-up"
        className="flex h-full flex-col items-center justify-center gap-2 text-sm text-cf-text-muted"
      >
        <span className="font-mono text-xs uppercase tracking-wider animate-pulse">
          Starting…
        </span>
      </div>
    );
  }

  // Lean final tool result — model-facing, doesn't carry verbose
  // file content. Render the most-recently-known snapshot fields we
  // CAN derive (commit SHA, success/failure). The error state here
  // is for the rare case where the orchestrator yielded a final
  // DeckDraftToolResult without an intermediate "done" snapshot —
  // shouldn't happen in practice, but the component is robust to it.
  if (isDeckDraftToolResult(call.output)) {
    if (call.output.ok) {
      return (
        <div
          data-testid="deck-creation-canvas"
          data-state="done"
          className="flex h-full flex-col items-center justify-center gap-3 text-sm text-cf-text"
        >
          <span className="text-3xl">✓</span>
          <p className="text-cf-text">
            Deck created. Commit{" "}
            <code className="font-mono text-xs">
              {call.output.commitSha.slice(0, 7)}
            </code>
            .
          </p>
        </div>
      );
    }
    return (
      <div
        data-testid="deck-creation-canvas"
        data-state="error"
        className="flex h-full flex-col gap-4 p-6"
      >
        <ErrorOverlay
          message={call.output.error}
          {...(onRetry ? { onRetry } : {})}
        />
      </div>
    );
  }

  // The common case: an in-flight or terminal DeckCreationSnapshot.
  const snapshot = call.output;
  if (!isDeckCreationSnapshot(snapshot)) {
    // Unreachable — kept for exhaustive narrowing.
    return null;
  }

  const activeFile = snapshot.files.find((f) => f.state === "writing");
  const lastFile = snapshot.files[snapshot.files.length - 1];
  const fileToShow = activeFile ?? lastFile;
  const isErrored = snapshot.phase === "error";
  const slug = slugProp ?? inferSlug(snapshot.files);

  // During the silent `ai_gen` window — `generateObject` runs single-shot
  // and emits no files for ~1-3 min — replace the empty file-tree grid
  // with the composing overlay. PhaseStrip stays above so the user still
  // sees `ai_gen` as the active phase. See ComposingOverlay.tsx.
  const isComposing =
    snapshot.phase === "ai_gen" && snapshot.files.length === 0;

  return (
    <div
      data-testid="deck-creation-canvas"
      data-state={snapshot.phase}
      className="flex h-full flex-col gap-4 p-6"
    >
      <PhaseStrip
        currentPhase={snapshot.phase}
        {...(snapshot.failedPhase ? { failedPhase: snapshot.failedPhase } : {})}
      />
      {isErrored ? (
        <ErrorOverlay
          message={snapshot.error ?? "An error occurred."}
          {...(snapshot.failedPhase ? { failedPhase: snapshot.failedPhase } : {})}
          {...(onRetry ? { onRetry } : {})}
        />
      ) : null}
      {isComposing ? (
        <ComposingOverlay />
      ) : (
        <div className="grid flex-1 grid-cols-[minmax(180px,_240px)_1fr] gap-4 overflow-hidden">
          <aside className="overflow-y-auto rounded-lg border border-cf-text/10 bg-cf-bg-100 p-2">
            <FileTree
              files={snapshot.files}
              slug={slug}
              {...(activeFile?.path ? { activePath: activeFile.path } : {})}
            />
          </aside>
          <section className="overflow-hidden rounded-lg border border-cf-text/10 bg-cf-bg-100">
            <FileContent file={fileToShow} slug={slug} />
          </section>
        </div>
      )}
    </div>
  );
}
