# ADR 0002: Lean final yield + verbose intermediate yields on deck-creation tools

**Status:** Accepted (2026-05-12, issue #183 / umbrella #178)

## Context

The `createDeckDraft` and `iterateOnDeckDraft` tools (see
`worker/agent-tools.ts`) stream progress to the UI canvas as their
`execute` generator yields each `DeckCreationSnapshot`. Each snapshot
carries:

- `phase` — current orchestrator phase.
- `files` — every file the model has emitted so far, with full content
  and a `"writing" | "done"` state badge.
- `currentFile`, `commitMessage`, `commitSha`, `draftId`, `error`,
  `failedPhase` — context fields.

The verbose `files` payload is necessary for the canvas to render the
"watching the model type" effect. A medium-sized deck might have 5
slides at ~600 lines each = ~3000 lines of TSX text in the final
snapshot. The canvas reads exactly one of these snapshots at a time
(the latest), so the verbosity is a UI win.

But the snapshot is ALSO what the model sees as the tool's result on
its next conversational turn. The AI SDK's `ToolExecuteFunction`
contract is `(input) => AsyncIterable<OUTPUT>` — the SDK observes the
LAST yielded value as the tool's `output-available` payload, which
becomes the tool-result message the model reasons over.

If the lean and verbose shapes were the same, the model would see all
~3000 lines of generated TSX every time it called the tool. On
iteration this compounds — turn 2 has the turn-1 output in history,
turn 3 has turn 2's, and so on. The context budget melts.

Our originally-stated design ("yields for UI, return for model") relied
on the AI SDK observing a generator's *return* value distinctly from
its yields. That's not how `ai@6` works — the SDK's `for await` over
the async iterable discards the generator's return value entirely.

## Decision

Yield two different shapes through the same iterable:

1. **Intermediate yields** are `DeckCreationSnapshot` — verbose, with
   full `files` content. The canvas reads these.
2. **The final yield** is the lean `DeckDraftToolResult`
   (`{ ok, draftId, commitSha, branch, fileCount, commitMessage }` on
   success or `{ ok: false, phase, error, aiGenPhase }` on failure).
   That's what the SDK surfaces as the `output-available` payload and
   that's what the model sees.

The two shapes are discriminated by `"ok" in value` — only the lean
result has `ok`. Consumers (canvas + model + future tooling) branch on
that property.

The orchestrators (`runCreateDeckDraft`, `runIterateOnDeckDraft`)
return `DeckDraftResult | DeckDraftError` from their generators. The
tool runners (`runCreateDeckDraftTool`, `runIterateOnDeckDraftTool`)
forward each orchestrator yield as-is, then yield the orchestrator's
return value as the FINAL value before completing.

## Consequences

### Pros

- **Model's context budget stays small.** The tool result the model
  sees on each turn is ~6 fields, not ~3000 lines of TSX.
- **The model's prompts can rely on the lean shape.** "If `ok` is
  true, you've created the draft at `draftId` with commit
  `commitSha.slice(0,7)`. If `ok` is false, the failure was at
  `phase`."
- **The UI sees richer data for free.** The verbose snapshots are
  ALREADY required for the canvas; layering the lean shape on top of
  the same stream doesn't change anything about the UI's read.
- **Symmetric across both tools.** `createDeckDraft` and
  `iterateOnDeckDraft` use the same union output type, so the
  client-side type-guards work uniformly.

### Cons

- **Asymmetric output type.** The tool's OUTPUT is the union
  `DeckCreationSnapshot | DeckDraftToolResult`, which the SDK type-
  system surfaces as just `DeckDraftToolStreamItem`. Consumers have
  to type-guard. (We export `isDeckCreationSnapshot` /
  `isDeckDraftToolResult` from `src/lib/deck-creation-snapshot.ts`
  to make this ergonomic.)
- **Future "look-back" reads see the lean shape.** If a future feature
  wants to re-render the canvas from chat history without the live
  stream, it'd see only the lean final result, not the intermediate
  snapshots. Mitigation: persist the latest snapshot to agent state
  separately when needed (cost-pay-on-demand).
- **A future migration to a different SDK would need to be aware.**
  If we ever swap the AI SDK for something with a different
  yield/return contract, this asymmetry would need to be rebuilt.
  Code comments at the runner sites flag this.

## See also

- ADR 0001 — the surrounding decision to use tool-call streaming as
  the data carrier at all.
- `src/lib/deck-creation-snapshot.ts` — the shared types + type-guards.
- `worker/agent-tools.ts` — `runCreateDeckDraftTool` /
  `runIterateOnDeckDraftTool` async-generator runners.
