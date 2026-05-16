/**
 * Public surface for the framework-level citation primitives.
 *
 * AI-generated decks (and any first-party deck that wants stable
 * citation styling) import from here:
 *
 *     import { Cite, SourceFooter, type Source } from "@/framework/citation";
 *
 * Keep these exports stable — the deck-gen prompt in
 * `worker/ai-deck-gen.ts` instructs the model to use exactly this
 * path + names. Renames need to be reflected in both places (the
 * `ai-deck-gen.test.ts` "citation discipline" test pins the prompt
 * side).
 */
export { Cite } from "./Cite";
export { SourceFooter } from "./SourceFooter";
export type { Source } from "./types";
