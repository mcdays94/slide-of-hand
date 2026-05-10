import type { RunEvent } from "../../lib/run-events";

/**
 * Tiny SSE-over-POST client.
 *
 * EventSource only supports GET, but the Worker's run endpoints are
 * POST (we ship a JSON body). This streams the response body, splits
 * on the SSE delimiter (`\n\n`), and emits each `data:` payload as a
 * parsed `RunEvent`.
 *
 * Returns an `AbortController` so the caller can cancel a run on Reset.
 */
export interface RunStreamOpts {
  url: string;
  prompt: string;
  modelId: string;
  /**
   * Optional preset prompt id. When set, the worker selects the
   * matching hand-written Code Mode plan (e.g. dns-records-by-type)
   * instead of falling back to the generic "lists zones" plan. Free-
   * form prompts pass `undefined`/null, in which case the worker's
   * fallback is the intended behaviour.
   */
  promptId?: string | null;
  signal?: AbortSignal;
  onEvent: (event: RunEvent) => void;
}

export async function streamRun(opts: RunStreamOpts): Promise<void> {
  // Build the body conditionally so a missing/null promptId never
  // appears as `"promptId": null` on the wire — the worker treats null
  // as "force the fallback even though I might have matched a preset".
  const body: { prompt: string; modelId: string; promptId?: string } = {
    prompt: opts.prompt,
    modelId: opts.modelId,
  };
  if (opts.promptId) body.promptId = opts.promptId;

  const res = await fetch(opts.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker ${res.status}: ${text || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const event = JSON.parse(payload) as RunEvent;
        opts.onEvent(event);
      } catch {
        /* ignore malformed line — keep streaming */
      }
    }
  }
}
