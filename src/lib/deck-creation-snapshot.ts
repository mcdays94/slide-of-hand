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
 * Preview-build status reported alongside snapshots and the final
 * lean tool result (issue #271). Tied to the Artifacts commit SHA;
 * built AFTER the commit has landed, so its lifecycle is decoupled
 * from the six-phase create/iterate strip.
 *
 *   - `"building"` — preview bundle build in flight.
 *   - `"ready"`    — bundle uploaded; `previewUrl` is populated.
 *   - `"error"`    — preview build failed. `previewError` carries
 *                    a redacted, UI-safe message. The deck draft
 *                    itself is still successful (preview failure
 *                    is non-destructive); the field exists so the
 *                    UI can surface a warning rather than swallow.
 */
export type PreviewStatus = "building" | "ready" | "error";

/**
 * Streaming snapshot yielded by the orchestrators at every phase
 * boundary AND for each `DeckGenPartial` during `ai_gen`. Drives the
 * canvas UI.
 *
 * The `preview*` fields surface the preview-bundle build status
 * (issue #271). They are populated only AFTER the Artifacts commit
 * has landed — the preview is built from the committed source, not
 * model output mid-stream. All four fields are optional so the
 * shape stays backwards-compatible with consumers that pre-date
 * the preview wiring.
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
  /** Lifecycle marker for the preview-bundle build, when one was attempted. */
  previewStatus?: PreviewStatus;
  /** Preview URL, populated when `previewStatus === "ready"`. */
  previewUrl?: string;
  /** Redacted error message, populated when `previewStatus === "error"`. */
  previewError?: string;
  /** Count of files uploaded to R2 in this preview build, when known. */
  previewUploadedFiles?: number;
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
  /**
   * Preview-bundle status for the commit just landed (issue #271).
   * Optional + backwards-compatible — pre-#271 consumers see the
   * field as undefined and behave as before.
   *
   *   - `"ready"` → `previewUrl` is populated; iframe-ready.
   *   - `"error"` → `previewError` carries a redacted message; the
   *                 draft itself is still ok (preview failure is
   *                 non-destructive).
   *
   * The intermediate `"building"` state never appears on the lean
   * tool result — by definition the result is emitted AFTER the
   * preview build attempt has terminated.
   */
  previewStatus?: PreviewStatus;
  previewUrl?: string;
  previewError?: string;
  previewUploadedFiles?: number;
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
