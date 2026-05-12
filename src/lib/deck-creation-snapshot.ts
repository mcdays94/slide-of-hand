/**
 * Shared deck-creation snapshot types — the wire format that flows
 * from the orchestrators (`runCreateDeckDraft` / `runIterateOnDeckDraft`
 * in `worker/sandbox-deck-creation.ts`) through the agent tools
 * (`worker/agent-tools.ts`) to the canvas UI
 * (`src/components/deck-creation-canvas/`).
 *
 * Lives in `src/lib/` so BOTH tsconfig projects (`tsconfig.app.json`
 * for src/, `tsconfig.node.json` for worker/) can include it without
 * leaking Cloudflare ambient types (`Artifacts`, `Ai`, etc.) into the
 * frontend app type-check. See ADR 0002.
 *
 * Issue #178 sub-pieces (1) + (3).
 */

export type PipelinePhase =
  | "fork"
  | "clone"
  | "ai_gen"
  | "apply"
  | "commit"
  | "push";

/**
 * Streaming partial shape yielded by `streamDeckFiles` during model
 * generation. The last file in `files` is the one currently being
 * written; earlier files are complete. Once the stream exhausts,
 * callers know the final file is also done.
 */
export interface DeckGenPartial {
  files: Array<{ path: string; content: string; state: "writing" | "done" }>;
  currentFile?: string;
  commitMessage?: string;
}

/**
 * Streaming snapshot yielded by the orchestrators at every phase
 * boundary AND for each `DeckGenPartial` during `ai_gen`. Drives the
 * canvas UI.
 */
export interface DeckCreationSnapshot {
  phase: PipelinePhase | "done" | "error";
  files: Array<{ path: string; content: string; state: "writing" | "done" }>;
  currentFile?: string;
  commitMessage?: string;
  commitSha?: string;
  draftId?: string;
  error?: string;
  failedPhase?: PipelinePhase;
}

/**
 * Lean tool-result shape that the model sees as the final tool-call
 * output. Same fields as the orchestrator's success / error branches
 * — verbose file content is intentionally omitted so the iteration
 * loop doesn't burn the model's context budget.
 */
export type DeckDraftToolResult =
  | DeckDraftToolSuccess
  | DeckDraftToolError;

export interface DeckDraftToolSuccess {
  ok: true;
  draftId: string;
  commitSha: string;
  branch: string;
  fileCount: number;
  commitMessage: string;
  promptNotePushed?: boolean;
}

export interface DeckDraftToolError {
  ok: false;
  phase:
    | "validation"
    | "fork"
    | "token"
    | "clone"
    | "ai_generation"
    | "apply_files"
    | "commit_push";
  error: string;
  aiGenPhase?:
    | "model_error"
    | "schema_violation"
    | "path_violation"
    | "no_files";
}

/**
 * Union yielded by the deck-creation tool runners over the AI SDK's
 * streaming-tool-call protocol. Most yields are
 * `DeckCreationSnapshot` (verbose, for the canvas); the LAST yield
 * is the lean `DeckDraftToolResult` (what the model sees).
 *
 * Discriminate by `"ok" in value` — only the lean shape has `ok`.
 */
export type DeckDraftToolStreamItem = DeckCreationSnapshot | DeckDraftToolResult;

/** True iff `value` is a streaming snapshot (not a final lean result). */
export function isDeckCreationSnapshot(
  value: DeckDraftToolStreamItem | undefined,
): value is DeckCreationSnapshot {
  return value !== undefined && !("ok" in value);
}

/** True iff `value` is the final lean tool result. Inverse of the above. */
export function isDeckDraftToolResult(
  value: DeckDraftToolStreamItem | undefined,
): value is DeckDraftToolResult {
  return value !== undefined && "ok" in value;
}
