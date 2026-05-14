import type { Env, RunEvent } from "../types";
import { CODE_MODE_TS_API } from "./cf-api";
import { addUsage, extractUsage, ZERO_USAGE } from "./token-counter";
import { getPlan, CODE_MODE_PLANS } from "./code-mode-plans";
import { aiRun } from "./ai-call";
import { runLlmCodeInIsolate } from "./dynamic-code-runner";

/**
 * Code Mode run.
 *
 * Single LLM round-trip + one execution in a fresh V8 isolate.
 *
 * Path A (preferred — `env.LOADER` available, "live" badge):
 *   1. LLM writes TypeScript against the codemode.* surface.
 *   2. We wrap that TypeScript in a Worker module and load it via
 *      `env.LOADER.load()` — a fresh Dynamic Worker isolate per run.
 *   3. The isolate's outbound fetch is intercepted by a synthetic
 *      Fetcher that proxies codemode.internal/{tool} back to the real
 *      MCP_TOOLS in the parent env. The CF API token never enters the
 *      isolate's scope.
 *   4. console.log lines flow back as the answer.
 *
 * Path B (fallback — isolate compile/runtime error AND a matching
 * preset exists):
 *   - We still want a coherent answer on stage if the LLM produces
 *     malformed code. For the four hand-tested presets we keep a
 *     canonical plan in `code-mode-plans.ts` and run it host-side
 *     when path A throws.
 *
 * Path C (last resort — no LOADER, no matching preset):
 *   - Surface the error in the transcript honestly.
 */

const SYSTEM_PROMPT = `You are an autonomous agent operating a Cloudflare account dashboard.

You will be given a user question. You have access to an API (described
in TypeScript below) that lets you read data from the Cloudflare account.
Your job is to write the body of an async function that fetches the data,
processes it, and prints a friendly answer to the user via \`console.log\`.

Critical: your code runs INSIDE A V8 ISOLATE that ONLY accepts plain
JavaScript. The TypeScript types below are documentation — do NOT emit
any TypeScript syntax in your answer (no type annotations, no
\`interface\`, no \`as Type\`, no \`<Generic>\` casts). Write JavaScript.

Rules:
  - Output ONLY a single \`\`\`javascript fenced code block. Nothing else.
  - The code block must be the BODY of an async function — do NOT wrap
    it in \`async function main() { ... }\`. Just the statements.
  - You may use \`await codemode.*\` calls.
  - You MAY use \`console.log\` to return the answer to the user. Anything
    you log will be shown verbatim. Format the answer nicely (e.g. with
    a heading and bullet points), in plain text.
  - You may NOT use \`fetch()\`, \`import\`, \`require\`, or anything other
    than \`codemode\` and \`console\`.
  - DO NOT include type annotations like \`: Zone[]\` or \`: Record<string, number>\`.
    Just write \`const zones = await codemode.listZones();\` — no \`: Zone[]\`.

The available API (TypeScript types are for reference only — write JS):
${CODE_MODE_TS_API}
`;

const MARKDOWN_FENCE = /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/;

export async function runCodeMode(opts: {
  env: Env;
  /** ExecutionContext from the parent's fetch handler — needed by the
   *  dynamic-code runner so it can build the loopback Fetcher
   *  (`ctx.exports.CodemodeFetcher()`) for the isolate's globalOutbound. */
  ctx: ExecutionContext;
  prompt: string;
  modelId: string;
  emit: (e: RunEvent) => void;
  runId: string;
  /** Optional preset prompt id — used only as a SAFETY fallback if the
   *  LLM-authored code can't compile or didn't produce output. The
   *  primary execution path is the live isolate. */
  promptId?: string;
}): Promise<void> {
  const { env, ctx, prompt, modelId, emit, runId, promptId } = opts;

  emit({ type: "start", mode: "code-mode", model: modelId, runId });
  emit({
    type: "thinking",
    text: "One round-trip: ask the LLM to write a TypeScript snippet that calls codemode.* and logs the answer.",
  });

  const startedAt = Date.now();
  let totalUsage = { ...ZERO_USAGE };

  // ── Step 1: ask the LLM to write code ───────────────────────────────
  let raw: unknown;
  try {
    raw = await aiRun(env, modelId, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      // Hermes 2 Pro Mistral 7B caps max_new_tokens at 1024; other
      // models on Workers AI accept higher but 1024 is plenty for the
      // demo's snippet-sized output.
      max_tokens: 1024,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: `LLM error: ${msg}`, recoverable: true });
    throw err;
  }

  const completion = raw as {
    response?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const completionText =
    completion.response ?? completion.choices?.[0]?.message?.content ?? "";

  totalUsage = addUsage(
    totalUsage,
    extractUsage(raw, {
      prompt: SYSTEM_PROMPT + "\n" + prompt,
      completion: completionText,
    }),
  );

  const fenceMatch = completionText.match(MARKDOWN_FENCE);
  const codeBody = (fenceMatch?.[1] ?? completionText).trim();

  emit({ type: "code", source: codeBody, tokensSoFar: totalUsage.totalTokens });

  // ── Step 2: execute the LLM's code in a fresh V8 isolate ────────────
  let answer = "";
  let executionError: string | undefined;
  let executionPath: "isolate" | "fallback-plan" | "error" = "error";

  if (env.LOADER) {
    emit({
      type: "thinking",
      text: "Spinning up a fresh V8 isolate via Worker Loader and running the LLM's code in it.",
    });
    try {
      const result = await runLlmCodeInIsolate({
        env,
        ctx,
        llmCode: codeBody,
        runId,
      });
      answer = result.logs.join("\n");
      executionError = result.error;
      executionPath = "isolate";
      for (const line of result.logs) {
        emit({ type: "code_log", text: line });
      }
      if (result.error) {
        emit({ type: "code_log", text: `[isolate error] ${result.error}` });
      }
    } catch (err) {
      // The isolate itself failed to spin up or returned non-JSON.
      // We fall through to the fallback path below; surface the
      // outage to the audience so the comparison stays honest.
      const msg = err instanceof Error ? err.message : String(err);
      emit({
        type: "code_log",
        text: `[isolate unavailable] ${msg}`,
      });
      executionError = msg;
    }
  }

  // Fallback path: only if the isolate didn't run AND we have a
  // canonical plan for this preset. Custom prompts surface the error
  // — we don't pretend a different plan covered them.
  const isolateProducedAnyOutput =
    executionPath === "isolate" && !executionError && answer.trim() !== "";
  if (!isolateProducedAnyOutput && promptId && promptId in CODE_MODE_PLANS) {
    emit({
      type: "thinking",
      text: "LLM code didn't produce output — running the canonical plan for this preset so the demo stays coherent.",
    });
    const plan = getPlan(promptId);
    try {
      const fallbackAnswer = await plan(env);
      answer = fallbackAnswer;
      executionError = undefined;
      executionPath = "fallback-plan";
      for (const line of fallbackAnswer.split("\n")) {
        emit({ type: "code_log", text: line });
      }
    } catch (err) {
      executionError = err instanceof Error ? err.message : String(err);
      emit({ type: "code_log", text: `[plan error] ${executionError}` });
    }
  }

  emit({
    type: "final",
    answer: executionError
      ? `Execution error: ${executionError}${answer ? `\n\n(Captured before failure:\n${answer})` : ""}`
      : answer || "(no output — the LLM-written code didn't call console.log)",
    promptTokens: totalUsage.promptTokens,
    completionTokens: totalUsage.completionTokens,
    totalTokens: totalUsage.totalTokens,
    roundTrips: 1,
    latencyMs: Date.now() - startedAt,
  });
  emit({
    type: "done",
    mode: "code-mode",
    promptTokens: totalUsage.promptTokens,
    completionTokens: totalUsage.completionTokens,
    totalTokens: totalUsage.totalTokens,
    roundTrips: 1,
    latencyMs: Date.now() - startedAt,
  });
}
