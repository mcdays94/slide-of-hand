/**
 * Friendly-key allow-list for the in-Studio AI assistant model
 * (issue #131 item A).
 *
 * Lives in its own module — not inside `src/lib/settings.ts` — so the
 * worker tsconfig can include it without dragging in the DOM
 * references (`window`, `Storage`) that `settings.ts` uses for its
 * localStorage glue. The worker's tsconfig has `lib: ["ES2023"]` (no
 * DOM), so any file the worker code imports has to stay DOM-free.
 *
 * **Friendly keys vs catalog IDs.** The keys here are the stable
 * contract between persisted client state, the segmented-row labels,
 * and the server-side allow-list. They are NOT Workers AI catalog
 * IDs — those drift (kimi-k2.5 deprecation, llama-4-scout addition,
 * etc.). The server's mapping from friendly key → catalog ID lives
 * in `worker/agent.ts` as the single source of truth for "what
 * does Workers AI actually invoke?".
 *
 * Adding a new option requires:
 *   1. Append the key here.
 *   2. Append the catalog-ID mapping in `worker/agent.ts`'s
 *      `AI_ASSISTANT_MODEL_IDS`.
 *   3. Append the user-facing label in
 *      `src/framework/viewer/SettingsModal.tsx`'s picker options.
 *
 * Removing an option is opposite-order: trim the picker, then the
 * catalog mapping, then this allow-list, so an in-flight client can
 * never invoke a removed model.
 */

export const AI_ASSISTANT_MODELS = [
  "kimi-k2.6",
  "llama-4-scout",
  "gpt-oss-120b",
] as const;

export type AiAssistantModel = (typeof AI_ASSISTANT_MODELS)[number];

/**
 * Type guard for `AiAssistantModel`. Used by the settings parser
 * (`src/lib/settings.ts`) and the server allow-list
 * (`worker/agent.ts`'s `resolveAiAssistantModel`).
 */
export function isAiAssistantModel(value: unknown): value is AiAssistantModel {
  return (
    typeof value === "string" &&
    (AI_ASSISTANT_MODELS as readonly string[]).includes(value)
  );
}
