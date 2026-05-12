/**
 * Walk a `useAgentChat`-shaped `messages` array and return the LAST
 * tool-call that drives the deck-creation canvas: either
 * `createDeckDraft` or `iterateOnDeckDraft`. Anything else is ignored.
 *
 * Used by `<DeckCreationCanvas>` to find the in-flight (or most
 * recently completed) deck-creation call to render. Returns `null`
 * when no such call exists — the route uses that signal to keep the
 * layout in full-width-chat mode (no pivot).
 *
 * Issue #178 sub-pieces (1) + (3).
 */

import type {
  DeckCreationSnapshot,
  DeckDraftToolResult,
} from "@/lib/deck-creation-snapshot";
export {
  isDeckCreationSnapshot,
  isDeckDraftToolResult,
} from "@/lib/deck-creation-snapshot";

/**
 * The lifecycle states the AI SDK emits on a tool-call UI part. The
 * v6 SDK uses `state: "output-available"` with `preliminary: true`
 * for streaming intermediate yields, and `preliminary: false` (or
 * undefined) for the final result. See `node_modules/ai/dist/index.d.ts`
 * around the `UIToolInvocation` union.
 */
export type ToolCallState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

/**
 * A loose tool-part shape that captures what we read off the
 * `useAgentChat`-produced messages without coupling to the full AI
 * SDK type union. The SDK's full type includes provider-metadata
 * fields and approval shapes we don't surface here.
 */
export interface DeckCreationToolPart {
  type: string;
  toolCallId?: string;
  state?: ToolCallState;
  output?: unknown;
  errorText?: string;
}

/** Minimum shape of a message we walk. */
export interface DeckCreationMessage {
  parts: Array<DeckCreationToolPart | { type: string }>;
}

export type DeckCreationToolName = "createDeckDraft" | "iterateOnDeckDraft";

export interface DeckCreationCall {
  toolCallId: string;
  toolName: DeckCreationToolName;
  state: ToolCallState;
  /**
   * Latest yielded value. `undefined` while the tool is still in
   * `input-streaming` / `input-available` and no output has arrived.
   *
   * Discriminated by `"ok" in output`:
   *   - Has `ok` → the FINAL lean result the model sees.
   *   - No `ok` → a `DeckCreationSnapshot` (intermediate streaming yield).
   */
  output: DeckCreationSnapshot | DeckDraftToolResult | undefined;
  /** Set when the AI SDK signals `output-error`. */
  errorText?: string;
}

/**
 * Walk `messages` newest-first and return the latest tool-call that
 * drives the deck-creation canvas. Returns `null` if no such call is
 * present.
 *
 * Iteration order: newest message first; within each message, newest
 * part first. The first deck-creation tool part we hit is the result.
 */
export function extractLatestDeckCreationCall(
  messages: ReadonlyArray<DeckCreationMessage>,
): DeckCreationCall | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      const toolName = deckCreationToolName(part);
      if (toolName) {
        const tp = part as DeckCreationToolPart;
        return {
          toolCallId: tp.toolCallId ?? "",
          toolName,
          state: tp.state ?? "input-streaming",
          output: tp.output as DeckCreationCall["output"],
          ...(tp.errorText ? { errorText: tp.errorText } : {}),
        };
      }
    }
  }
  return null;
}

/**
 * Returns the canonical tool name for deck-creation parts, or `null`
 * if the part isn't one we care about. The AI SDK's static-tool parts
 * have type `tool-<name>`; dynamic tools (MCP-style) have type
 * `dynamic-tool` with the name on `toolName`. We don't expect deck-
 * creation tools to ever be dynamic, but the check is cheap.
 */
function deckCreationToolName(
  part: DeckCreationMessage["parts"][number],
): DeckCreationToolName | null {
  if (typeof part.type !== "string") return null;
  if (part.type === "tool-createDeckDraft") return "createDeckDraft";
  if (part.type === "tool-iterateOnDeckDraft") return "iterateOnDeckDraft";
  return null;
}

// `isDeckCreationSnapshot` / `isDeckDraftToolResult` re-exported
// from `@/lib/deck-creation-snapshot` at the top of this file.
