# ADR 0001: Tool-call streaming as the carrier for deck-creation progress

**Status:** Accepted (2026-05-12, issue #183 / umbrella #178)

## Context

The AI-driven new-deck creator at `/admin/decks/new` calls `createDeckDraft`
on the in-Studio agent. That tool delegates to `runCreateDeckDraft` in
`worker/sandbox-deck-creation.ts`, which walks a six-phase pipeline
(fork → clone → ai_gen → apply → commit → push) over ~30–90 seconds. Each
phase has user-visible state worth surfacing on the UI canvas:

- The model is mid-write on slide N (partial JSON content).
- Files are landing in the file tree in emission order.
- The pipeline has advanced from one phase to the next.
- An error happened at a specific phase.

We needed a wire format and a transport from the Worker to the browser.
Two options were on the table:

1. **Tool-call streaming via `useAgentChat`.** The Vercel AI SDK (`ai@6`)
   supports `execute: AsyncIterable<OUTPUT>` on tool definitions. Each
   yielded value lands on the chat-message stream as a tool-call part
   with `state: "output-available"` and `preliminary: true` (intermediate)
   or `preliminary: false` (final). The chat-message stream is the same
   carrier the chat panel already consumes via `useAgentChat`, so the
   canvas just reads the latest yielded value off the in-flight tool-call.

2. **Agent state via `setState` + `useAgent({onStateUpdate})`.** The
   Cloudflare Agents SDK provides per-agent persistent state with
   automatic WebSocket propagation to clients. We could add a `creation`
   field to `DeckAuthorAgent`'s state, have the orchestrator update it on
   each partial, and have the client subscribe via `useAgent`.

## Decision

Use **tool-call streaming via the AI SDK**.

## Consequences

### Pros

- **One data channel.** The chat message stream already carries the
  conversation, the assistant's text deltas, and the existing tool calls
  (`readDeck`, `proposePatch`, etc.). Adding deck-creation progress
  alongside those keeps the wire model uniform.
- **Lifecycle maps naturally.** The tool-call's state machine
  (`input-streaming` → `input-available` → `output-available`) is exactly
  the right signal for the canvas's layout pivot — the canvas can read
  "tool call exists" off `messages` and decide to render itself, no
  separate channel needed.
- **`streamObject` produces an `AsyncIterable` already.** The Vercel AI
  SDK's `streamObject` returns a `partialObjectStream` that's already
  the right shape to forward through the tool's `execute` generator.
  Composition is trivial: `streamObject` partials → tool yields → chat
  parts → canvas state.
- **State persistence comes along for free.** The Agents SDK persists
  chat messages, so a user refreshing mid-stream restores the
  conversation including the in-flight (or terminal) tool-call's last
  known output. The canvas mounts in the right state after refresh.

### Cons

- **Tool-result history grows with each call.** Every deck-creation call
  leaves a final snapshot + metadata in chat history. With 6+ phases of
  progress yields, plus the final lean result, that's ~7 messages per
  creation. Acceptable for an admin-only surface.
- **The AI SDK ignores the generator's `return` value.** Our originally-
  stated design ("yields for UI, return for model") wasn't achievable —
  the SDK reads the LAST yielded value as the tool's output. We resolved
  this in ADR 0002 by yielding the lean result as the final yield.
- **No separate state to query.** A future "list all in-flight drafts
  across tabs" feature would need its own data store; the chat-stream
  channel is per-conversation.

### Migration / reversibility

Reversible at moderate cost. Adding a state-channel alongside (option 2)
would require:

1. Add a `creation` field to `DeckAuthorAgent`'s state.
2. Thread an `onProgress` callback through `runCreateDeckDraft` /
   `runIterateOnDeckDraft` that calls `this.setState({creation: ...})`.
3. Add a parallel `useAgent({onStateUpdate})` subscription on the client.

This would coexist with the tool-call stream; we wouldn't need to
remove anything. The cost is in the agent-class refactor (tool-running
methods would need a reference to the agent's `setState`), not in the
canvas component.

## See also

- `worker/sandbox-deck-creation.ts` — the orchestrator that yields snapshots.
- `worker/agent-tools.ts` — the `execute: async function*` adapter.
- `src/components/deck-creation-canvas/extractLatestCall.ts` — the
  consumer-side message walker.
- `src/lib/deck-creation-snapshot.ts` — the shared wire-format types.
