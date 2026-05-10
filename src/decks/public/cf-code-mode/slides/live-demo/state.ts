import type { RunEvent } from "../../lib/run-events";

/**
 * Per-column live-demo state machine.
 *
 * A column owns:
 *   - a streaming transcript of structured entries (one per RunEvent)
 *   - running counters (tokens, latency, round-trips)
 *   - a status: idle → running → done | error
 *   - the final answer string (after `final` arrives)
 *
 * The reducer is pure: feeding the same events in produces the same
 * state, regardless of timing. That property is what makes this testable
 * without an actual SSE source.
 */

export type ColumnStatus = "idle" | "running" | "done" | "error";

export type TranscriptEntry =
  | { id: string; kind: "thinking"; text: string }
  | {
      id: string;
      kind: "tool_call";
      name: string;
      args: unknown;
    }
  | {
      id: string;
      kind: "tool_result";
      name: string;
      result: unknown;
      sizeBytes: number;
    }
  | { id: string; kind: "code"; source: string }
  | { id: string; kind: "code_log"; text: string }
  | { id: string; kind: "final"; answer: string }
  | { id: string; kind: "error"; message: string };

export interface ColumnState {
  status: ColumnStatus;
  model?: string;
  runId?: string;
  transcript: TranscriptEntry[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  roundTrips: number;
  latencyMs: number;
  answer?: string;
  error?: string;
  /** Increments on every state change so React keys / animations refresh. */
  tick: number;
}

export function initialColumnState(): ColumnState {
  return {
    status: "idle",
    transcript: [],
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    roundTrips: 0,
    latencyMs: 0,
    tick: 0,
  };
}

let _entryCounter = 0;
function nextId(): string {
  _entryCounter += 1;
  return `e${_entryCounter}`;
}

/**
 * Apply one RunEvent to a ColumnState. Returns a new state object so
 * React's identity check correctly schedules a re-render.
 */
export function reduceColumn(state: ColumnState, event: RunEvent): ColumnState {
  switch (event.type) {
    case "start":
      return {
        ...initialColumnState(),
        status: "running",
        model: event.model,
        runId: event.runId,
        tick: state.tick + 1,
      };

    case "thinking":
      return {
        ...state,
        transcript: [
          ...state.transcript,
          { id: nextId(), kind: "thinking", text: event.text },
        ],
        tick: state.tick + 1,
      };

    case "tool_call":
      return {
        ...state,
        // Defensive: never let totals walk backwards.
        totalTokens: Math.max(state.totalTokens, event.tokensSoFar),
        transcript: [
          ...state.transcript,
          {
            id: nextId(),
            kind: "tool_call",
            name: event.name,
            args: event.args,
          },
        ],
        tick: state.tick + 1,
      };

    case "tool_result":
      return {
        ...state,
        totalTokens: Math.max(state.totalTokens, event.tokensSoFar),
        transcript: [
          ...state.transcript,
          {
            id: nextId(),
            kind: "tool_result",
            name: event.name,
            result: event.result,
            sizeBytes: event.sizeBytes,
          },
        ],
        tick: state.tick + 1,
      };

    case "code":
      return {
        ...state,
        totalTokens: Math.max(state.totalTokens, event.tokensSoFar),
        transcript: [
          ...state.transcript,
          { id: nextId(), kind: "code", source: event.source },
        ],
        tick: state.tick + 1,
      };

    case "code_log":
      return {
        ...state,
        transcript: [
          ...state.transcript,
          { id: nextId(), kind: "code_log", text: event.text },
        ],
        tick: state.tick + 1,
      };

    case "final":
      return {
        ...state,
        answer: event.answer,
        promptTokens: event.promptTokens,
        completionTokens: event.completionTokens,
        totalTokens: Math.max(state.totalTokens, event.totalTokens),
        roundTrips: event.roundTrips,
        latencyMs: event.latencyMs,
        transcript: [
          ...state.transcript,
          { id: nextId(), kind: "final", answer: event.answer },
        ],
        tick: state.tick + 1,
      };

    case "done":
      return {
        ...state,
        status: "done",
        promptTokens: state.promptTokens || event.promptTokens,
        completionTokens: state.completionTokens || event.completionTokens,
        totalTokens: Math.max(state.totalTokens, event.totalTokens),
        roundTrips: event.roundTrips,
        latencyMs: event.latencyMs,
        tick: state.tick + 1,
      };

    case "error":
      return {
        ...state,
        status: "error",
        error: event.message,
        transcript: [
          ...state.transcript,
          { id: nextId(), kind: "error", message: event.message },
        ],
        tick: state.tick + 1,
      };

    default: {
      // Exhaustiveness guard — narrows event to `never` when all
      // RunEvent variants are covered above. Returning state keeps the
      // reducer safe if a new event type is added in the future.
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}
