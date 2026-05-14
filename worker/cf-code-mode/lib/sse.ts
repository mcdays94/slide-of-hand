import type { RunEvent } from "../types";

/**
 * Tiny Server-Sent Events helper. Produces a `Response` whose body is a
 * ReadableStream the deck can consume with EventSource.
 *
 * Usage:
 *   return sseStream(async (emit) => {
 *     emit({ type: "start", ... });
 *     await doWork();
 *     emit({ type: "done", ... });
 *   });
 */
export function sseStream(
  produce: (emit: (event: RunEvent) => void) => Promise<void> | void,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: RunEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      try {
        await produce(emit);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: "error", message: msg, recoverable: false });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
