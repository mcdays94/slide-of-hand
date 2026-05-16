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
  /**
   * The tool's input arguments as streamed in by the AI SDK. Populated
   * (incrementally) once the model commits to a tool call — typically
   * arrives ~30-60s before the first output yield because
   * `createDeckDraft` runs the full fork → clone → ai_gen pipeline
   * before emitting anything. Issue #235's asset shelf reads
   * `input.slug` from here so users can upload speaker photos /
   * logos while the model is still composing.
   */
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/**
 * Minimal shape of an AI SDK text part — what a user's chat message
 * carries when they type something. Captured here so the retry-button
 * helper can find the most recent user prompt without coupling to
 * the full SDK type. (Issue #178 retry-button polish.)
 */
export interface DeckCreationTextPart {
  type: "text";
  text: string;
}

/**
 * Minimum shape of a message we walk. `role` is optional so existing
 * canvas tests (which only care about tool-parts and don't bother
 * setting role) keep type-checking. The route's retry helper relies
 * on role to discriminate user prompts from assistant tool-calls.
 */
export interface DeckCreationMessage {
  role?: "user" | "assistant" | "system";
  parts: Array<DeckCreationToolPart | DeckCreationTextPart | { type: string }>;
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
  /**
   * The draft slug the model picked, surfaced from `part.input.slug`
   * as soon as the AI SDK exposes it (often during `input-streaming`,
   * always by `input-available`). `undefined` until the model has
   * committed to a slug — earlier than waiting for the first output
   * file path. Issue #235.
   */
  inputSlug?: string;
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
        const inputSlug = extractInputSlug(tp.input);
        return {
          toolCallId: tp.toolCallId ?? "",
          toolName,
          state: tp.state ?? "input-streaming",
          output: tp.output as DeckCreationCall["output"],
          ...(inputSlug ? { inputSlug } : {}),
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

/**
 * Pull a non-empty string `slug` off the tool's `input` object, if
 * present. The AI SDK streams the input JSON token-by-token, so any
 * field can be `undefined`, `null`, an empty string, or even the
 * wrong type during early ticks — we narrow defensively and return
 * `undefined` for anything that isn't a usable slug.
 *
 * Issue #235. The asset shelf on `/admin/decks/new` reads this so
 * the user can upload speaker photos / logos as soon as the model
 * picks a slug (which lands minutes before the first generated file).
 */
function extractInputSlug(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const maybe = (input as { slug?: unknown }).slug;
  if (typeof maybe !== "string") return undefined;
  const trimmed = maybe.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Walk `messages` newest-first and return the text of the most
 * recent user prompt, or `null` if none exists. Used by
 * `/admin/decks/new` to wire the canvas's Retry button — clicking
 * Retry re-sends the original prompt without making the user retype.
 *
 * "Most recent" because the chat history might contain multiple
 * exchanges before a tool-call error lands (e.g. user iterated on
 * an earlier draft before the current one failed). The latest
 * user-typed text is the one a "retry" naturally refers to.
 *
 * Trims whitespace and skips empty-text parts so we never return a
 * value that would produce `sendMessage({ text: "" })`.
 */
export function findLastUserPromptText(
  messages: ReadonlyArray<DeckCreationMessage>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      if (!isTextPart(part)) continue;
      if (part.text.trim().length === 0) continue;
      return part.text;
    }
  }
  return null;
}

/**
 * Type-guard for the SDK's text-part shape. `DeckCreationToolPart`
 * has `type: string` (not a literal), so a structural narrowing on
 * `part.type === "text"` doesn't discriminate — we need an explicit
 * runtime check that the `text` field is present and a string.
 */
function isTextPart(
  part: DeckCreationMessage["parts"][number] | undefined,
): part is DeckCreationTextPart {
  if (!part) return false;
  if (part.type !== "text") return false;
  const maybeText = (part as { text?: unknown }).text;
  return typeof maybeText === "string";
}
