/**
 * Browser-shareable types for the live-demo slide.
 *
 * These types are imported by BOTH the Worker (Node/Workers env) and the
 * React frontend (DOM env). They MUST NOT reference `Ai`, `Fetcher`, or
 * any other `@cloudflare/workers-types` global, because the frontend's
 * `tsconfig.app.json` doesn't include workers-types — and the slide
 * compiles inside that project.
 *
 * `worker/types.ts` re-exports from here for the Worker side.
 */

/**
 * SSE event sent from /api/run-mcp and /api/run-code-mode to the demo UI.
 *
 * The UI keeps two parallel transcripts; each event is rendered into the
 * matching column. `type` discriminates the union, and the UI tallies
 * `tokens` events into a live counter.
 */
export type RunEvent =
  | { type: "start"; mode: "mcp" | "code-mode"; model: string; runId: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; args: unknown; tokensSoFar: number }
  | {
      type: "tool_result";
      name: string;
      result: unknown;
      sizeBytes: number;
      tokensSoFar: number;
    }
  | { type: "code"; source: string; tokensSoFar: number }
  | { type: "code_log"; text: string }
  | {
      type: "final";
      answer: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      roundTrips: number;
      latencyMs: number;
    }
  | { type: "error"; message: string; recoverable: boolean }
  | {
      type: "done";
      mode: "mcp" | "code-mode";
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      roundTrips: number;
      latencyMs: number;
    };

/** Demo prompt presets — chosen so they actually exercise multi-tool chains. */
export interface DemoPrompt {
  id: string;
  label: string;
  prompt: string;
  /** Hint for the deck UI: which Cloudflare API areas this prompt touches. */
  surfaces: ("zones" | "dns" | "waf" | "rulesets" | "account")[];
}

export interface DemoModel {
  /** The full Workers AI model id, e.g. `@hf/nousresearch/hermes-2-pro-mistral-7b`. */
  id: string;
  /** Short label for the UI. */
  label: string;
  /** Provider for the badge colour. */
  provider: "meta" | "nousresearch" | "google" | "openai" | "moonshot" | "zai";
  /** Whether the model is fine-tuned for native function calling. */
  functionCalling: boolean;
  /** Recommended for "fast" demos (≤7B params or fp8). */
  fast?: boolean;
  /** Display this badge above the column. */
  blurb: string;
}
