import type { Env, RunEvent } from "../types";
import { MCP_TOOL_SCHEMAS, MCP_TOOLS } from "./cf-api";
import { addUsage, estimateTokens, extractUsage, ZERO_USAGE } from "./token-counter";
import { summarizeForLlm } from "./summarize-tool-result";
import { aiRun } from "./ai-call";

/**
 * Traditional MCP run.
 *
 * The agent loop, classic shape:
 *   1. Send the user message + the full tool schema to the LLM.
 *   2. LLM emits a tool_call. Pause; execute the tool host-side.
 *   3. Re-send the conversation INCLUDING the tool_result back to the LLM.
 *   4. Repeat until the LLM produces a final answer.
 *
 * Every result is re-tokenised on the way back into the model — the
 * canonical token-explosion shape we want to demo.
 */

const SYSTEM_PROMPT = `You are a Cloudflare account dashboard assistant.

You have these tools at your disposal — call them to read live data
from the user's Cloudflare account:

  • listZones() — every zone on the account, returns each zone's id and name
  • listDnsRecords(zoneId) — DNS records for one zone
  • listCustomWafRules(zoneId) — custom WAF rules for one zone
  • getZone(zoneId) — one zone's full record

CRITICAL behaviour rules:

  1. The FIRST tool you call MUST be listZones(), with no arguments.
     You need this BEFORE you can call any of the other tools, because
     they all need a real zoneId.
  2. zoneId is a 32-character hex string like "1aba9154f07d6d496e5a1effb235f53e".
     NEVER pass placeholders like "your_zone_id", "all", "zone_id",
     "<zone_id>", or any string that isn't a real id from a previous
     listZones() result. The dashboard will refuse those.
  3. To answer questions about DNS records or WAF rules across the
     account, loop: call listZones() once, then call the per-zone tool
     once per zone using each real zone id, then aggregate.
  4. Do NOT ask the user for clarification. Do NOT say "your input is
     insufficient", "please provide more details", or "I don't have
     enough information". The user's prompt and your tools together
     are always enough — start calling tools.
  5. The tools are the ONLY source of truth — never invent or guess at
     zone names, record counts, or WAF rules from your training data.
  6. When you write a final reply, use plain English. Do not mention
     tool names, JSON, or zone IDs. Keep it concise — three short
     paragraphs maximum.`;

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

/** Minimal Workers AI chat-completion shape we rely on. */
interface ChatCompletion {
  choices?: Array<{
    message?: {
      role: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  // Some Workers AI envs return `response` instead of `choices[0].message.content`.
  response?: string;
  tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

const MAX_ROUND_TRIPS = 6;

export async function runMcp(opts: {
  env: Env;
  prompt: string;
  modelId: string;
  emit: (e: RunEvent) => void;
  runId: string;
}): Promise<void> {
  const { env, prompt, modelId, emit, runId } = opts;

  emit({ type: "start", mode: "mcp", model: modelId, runId });

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  let totalUsage = { ...ZERO_USAGE };
  let roundTrips = 0;
  let toolsHaveBeenCalled = false;
  // We allow ONE self-healing retry per run when the LLM ignores
  // `tool_choice: "required"`. After that, the loop falls through to
  // a clean finalization so we never spin.
  let hasNudged = false;
  const startedAt = Date.now();

  while (roundTrips < MAX_ROUND_TRIPS) {
    roundTrips += 1;
    emit({
      type: "thinking",
      text:
        roundTrips === 1
          ? "Loading tool schemas and asking the model to choose a tool…"
          : `Round-trip #${roundTrips}: re-sending the full conversation back into the LLM with the new tool result.`,
    });

    let raw: unknown;
    try {
      // Workers AI's tool-calling format is the OpenAI-compatible
      // envelope: {type:"function", function:{name, description, parameters}}.
      // Llama 3.x / 4.x require it; Hermes-2-Pro and other tool-tuned
      // models accept it too.
      const oaiTools = MCP_TOOL_SCHEMAS.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      // First turn: FORCE a tool call. This is critical — without
      // `tool_choice: "required"`, Llama 3.3 70B and Hermes 7B will
      // happily answer "your input is not sufficient" and skip the
      // tools entirely. Once a tool has been called, we relax back to
      // "auto" so the LLM can decide when to finalize.
      const tool_choice = toolsHaveBeenCalled ? "auto" : "required";
      raw = await aiRun(env, modelId, {
        messages,
        tools: oaiTools,
        tool_choice,
        max_tokens: 1024,
      });
    } catch (err) {
      // Context-window-exceeded is THE punchline of the deck. Don't blow
      // up the SSE stream — surface the failure as a graceful `final`
      // event so the demo column shows "MCP couldn't complete because
      // the tool result didn't fit in the model's context". That's the
      // entire point of the slide.
      const msg = err instanceof Error ? err.message : String(err);
      const isContextWindow =
        /context window|context length|exceeded|input.*tokens/i.test(msg);
      const friendly = isContextWindow
        ? `MCP could not complete this prompt: the tool result didn't fit in the model's context window. The first tool call returned more JSON than the LLM can read in one turn — that's the token explosion this deck is about. (Raw error: ${msg})`
        : `MCP failed: ${msg}`;
      emit({
        type: "final",
        answer: friendly,
        promptTokens: totalUsage.promptTokens,
        completionTokens: totalUsage.completionTokens,
        totalTokens: totalUsage.totalTokens,
        roundTrips,
        latencyMs: Date.now() - startedAt,
      });
      emit({
        type: "done",
        mode: "mcp",
        promptTokens: totalUsage.promptTokens,
        completionTokens: totalUsage.completionTokens,
        totalTokens: totalUsage.totalTokens,
        roundTrips,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }
    const resp = raw as ChatCompletion;

    const usage = extractUsage(resp, {
      prompt: messages.map((m) => `${m.role}:${m.content}`).join("\n"),
      completion:
        resp.choices?.[0]?.message?.content ??
        resp.response ??
        JSON.stringify(resp.tool_calls ?? []),
    });
    totalUsage = addUsage(totalUsage, usage);

    const message = resp.choices?.[0]?.message;
    let toolCalls =
      message?.tool_calls ??
      resp.tool_calls?.map((tc, i) => ({
        id: `call_${i}`,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      })) ??
      [];

    // ── Branch A: model produced no tool calls. We need to decide
    //     whether to (1) nudge it, (2) synthesise a tool call so the
    //     demo can show a real tool result anyway, or (3) accept the
    //     answer and finalise.
    if (toolCalls.length === 0) {
      const answer = message?.content ?? resp.response ?? "";
      const isRefusal =
        !answer.trim().length ||
        /not sufficient|lacking|need more|more (info|detail|context)|don'?t have|don'?t know|please provide/i.test(
          answer,
        );

      // Self-healing on tool-skipping LLMs. Some Workers AI models
      // (notably Llama 3.3 70B for prompts mentioning specific things
      // like "DNS records") ignore `tool_choice: "required"` and
      // respond with "your input is not sufficient" or similar. Two
      // strategies, in order:
      //
      //   1. NUDGE — inject a direct user message reminding the model
      //      to call a tool, and re-enter the loop.
      //   2. SYNTHETIC TOOL CALL — if the nudge also fails, fabricate
      //      a `listZones()` call host-side and feed the result back
      //      to the LLM. This is the demo's last line of defence: it
      //      keeps the audience-visible flow ("loaded tools → tool
      //      result re-tokenised → final answer") intact regardless
      //      of how stubborn the model is. Token math stays honest.
      if (!toolsHaveBeenCalled && isRefusal && !hasNudged) {
        hasNudged = true;
        emit({
          type: "thinking",
          text:
            "Model didn't reach for a tool — re-asking with a direct nudge.",
        });
        messages.push({
          role: "user",
          content:
            "Use the available tools to answer my question. Don't ask for clarification. Start by calling listZones.",
        });
        continue; // re-enter the while loop; roundTrips will increment
      }

      if (!toolsHaveBeenCalled && isRefusal && hasNudged) {
        emit({
          type: "thinking",
          text:
            "Model still won't call a tool — falling back to a synthetic listZones() so the demo can show a real tool result.",
        });
        // Fabricate the tool call. The rest of the loop will dispatch
        // it through the normal path (real Cloudflare API call → real
        // result → real re-tokenised feed back into the LLM). This
        // gives the audience the same token-explosion experience even
        // when the LLM is being stubborn.
        toolCalls = [
          {
            id: "synthetic_listZones",
            type: "function" as const,
            function: { name: "listZones", arguments: "{}" },
          },
        ];
        // Fall through to the tool-execution block below — note we do
        // NOT `continue`. We want to keep this round-trip and surface
        // the synthetic call as if the LLM had asked for it.
      } else {
        // No refusal — the model is just done answering. Finalise.
        emit({
          type: "final",
          answer,
          promptTokens: totalUsage.promptTokens,
          completionTokens: totalUsage.completionTokens,
          totalTokens: totalUsage.totalTokens,
          roundTrips,
          latencyMs: Date.now() - startedAt,
        });
        emit({
          type: "done",
          mode: "mcp",
          promptTokens: totalUsage.promptTokens,
          completionTokens: totalUsage.completionTokens,
          totalTokens: totalUsage.totalTokens,
          roundTrips,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }
    }

    // ── Branch B: at least one tool call was produced (real or
    //     synthetic). Mark it and dispatch.
    toolsHaveBeenCalled = true;

    // Append the assistant's tool_call message to the conversation.
    messages.push({
      role: "assistant",
      content: message?.content ?? "",
      tool_calls: toolCalls,
    });

    // Execute each tool call host-side and append the result as another
    // message. The size of the result is what makes traditional MCP slow.
    for (const tc of toolCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments);
      } catch {
        /* let the LLM see "invalid args" naturally */
      }

      emit({
        type: "tool_call",
        name: tc.function.name,
        args: parsedArgs,
        tokensSoFar: totalUsage.totalTokens,
      });

      let result: unknown;
      try {
        result = await dispatchTool(env, tc.function.name, parsedArgs);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }

      // Two views of the result:
      //
      //   • `fullJson` — the audience-visible truth. Used for the
      //     sizeBytes counter (so the deck can show how much real data
      //     actually came back).
      //   • `llmJson` — the SUMMARISED version that we feed back to
      //     the LLM. Without this, listZones (262 KB / ~66K tokens for
      //     the user's 196-zone account) blows the context window
      //     after one turn. The summariser keeps a sample + counts +
      //     aggregates so the LLM can compose a real answer about real
      //     account data without choking on the raw firehose.
      //
      // Token cost reported to the deck is the summarised cost — that's
      // the actual cost the LLM paid. The audience still sees that
      // it's expensive (a few thousand tokens per round-trip).
      const fullJson = JSON.stringify(result);
      const llmJson = summarizeForLlm(tc.function.name, result);
      const resultTokens = estimateTokens(llmJson);
      totalUsage = addUsage(totalUsage, {
        promptTokens: resultTokens,
        completionTokens: 0,
        totalTokens: resultTokens,
      });

      emit({
        type: "tool_result",
        name: tc.function.name,
        result: redactForUi(result),
        sizeBytes: fullJson.length,
        tokensSoFar: totalUsage.totalTokens,
      });

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: llmJson,
      });
    }
  }

  // Hit the round-trip cap.
  emit({
    type: "final",
    answer:
      "(Demo cap reached after " +
      String(MAX_ROUND_TRIPS) +
      " round-trips — that's exactly the kind of token explosion Code Mode is designed to fix.)",
    promptTokens: totalUsage.promptTokens,
    completionTokens: totalUsage.completionTokens,
    totalTokens: totalUsage.totalTokens,
    roundTrips,
    latencyMs: Date.now() - startedAt,
  });
  emit({
    type: "done",
    mode: "mcp",
    promptTokens: totalUsage.promptTokens,
    completionTokens: totalUsage.completionTokens,
    totalTokens: totalUsage.totalTokens,
    roundTrips,
    latencyMs: Date.now() - startedAt,
  });
}

async function dispatchTool(
  env: Env,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "listZones":
      return MCP_TOOLS.listZones(env);
    case "listDnsRecords":
      return MCP_TOOLS.listDnsRecords(env, String(args.zoneId ?? ""));
    case "listCustomWafRules":
      return MCP_TOOLS.listCustomWafRules(env, String(args.zoneId ?? ""));
    case "getZone":
      return MCP_TOOLS.getZone(env, String(args.zoneId ?? ""));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Cap the size of the tool result we send to the UI. The full result is
 * still passed back into the LLM (that's the whole point of the demo),
 * but we don't want to overwhelm the deck transcript with megabytes of
 * JSON — a small preview is enough.
 */
function redactForUi(result: unknown): unknown {
  if (Array.isArray(result)) {
    if (result.length <= 4) return result;
    return [...result.slice(0, 3), `…and ${result.length - 3} more`];
  }
  return result;
}
