/**
 * cf-dynamic-workers / spawn — the deep module that wraps
 * `env.LOADER.load(...)`.
 *
 * Ported from the source deck's `worker/spawn.ts` (issue #167).
 * Behavioural fidelity to the original is the priority; the only
 * structural changes are:
 *
 *   - Imports `SNIPPETS` from the deck-local `lib/snippets.ts` (rather
 *     than a sibling under `src/lib/`).
 *   - Uses the global `WorkerLoader` + `WorkerStub` types from
 *     `worker-configuration.d.ts` directly, rather than re-declaring
 *     a local interface. The global types are now correct because
 *     issue #106 wired the binding into wrangler.jsonc.
 *
 * ## Public interface
 *
 *   spawn(env, snippetId, codeOverride?) → Promise<SpawnResult>
 *   spawnMany(env, count)               → Promise<MultiSpawnResult>
 *   spawnGlobe(env)                     → Promise<GlobeSpawnResult>
 *   forwardSession(env, id, subpath, request) → Promise<Response>
 *
 * ## Responsibilities
 *
 *   - Resolve the canonical snippet source (or a speaker-supplied
 *     override) and construct correct `LOADER.load` options per
 *     snippet kind. Centralising this per-snippet binding-surface
 *     decision in one place is the whole reason this is a deep module
 *     — easy to audit + change in lockstep.
 *   - Invoke the spawned worker's default fetch entrypoint and time
 *     the round-trip with `performance.now()`.
 *   - Return a structured SpawnResult — never throw to the caller.
 *
 * The route handler in `worker/cf-dynamic-workers/index.ts` is
 * intentionally thin: it parses the JSON body, calls `spawn(...)`,
 * and JSON-encodes the result. All real logic lives here so it can
 * be unit-tested in isolation with a mock LOADER.
 */

import type { Snippet, SnippetId } from "../../src/decks/public/cf-dynamic-workers/lib/snippets";
import { SNIPPETS } from "../../src/decks/public/cf-dynamic-workers/lib/snippets";
import { GLOBE_HOST_CODE } from "./globe-host";

/** Result envelope returned by every spawn, success or failure. */
export interface SpawnResult {
  /** Stable per-isolate id — also used as the loader cache key when relevant. */
  id: string;
  /** Wall-clock ms from `LOADER.load` to the entrypoint's response. */
  elapsedMs: number;
  /** Reserved for a future phase — not yet wired up. Placeholder 0 for now. */
  memoryKb: number;
  /**
   * The parsed JSON body the snippet returned. Always present on success.
   * Snippets are expected to return JSON; non-JSON bodies surface as a
   * `{ raw: <text> }` shape so the deck never crashes.
   */
  result?: unknown;
  /** Present iff the spawn or the snippet itself failed. */
  error?: string;
  /** True iff the snippet returned a 2xx response and parsed as JSON. */
  ok: boolean;
}

/**
 * The narrow env shape this module needs. `LOADER` is required — the
 * whole point. `AI` is unused here (the spawned isolate calls it via
 * SELF instead of receiving the binding directly, see `loadOptionsFor`
 * for `case "ai"`). `SELF` is required for the AI snippet + the globe
 * snippet because both spawned isolates need to call back into the
 * parent worker.
 */
export interface SpawnEnv {
  LOADER: WorkerLoader;
  AI?: Ai;
  /**
   * Self-service binding (Fetcher back into the parent worker). Used
   * as the spawned isolate's `globalOutbound` for the AI + globe
   * snippets. Configured in `wrangler.jsonc` as
   * `services: [{ binding: "SELF", service: "reaction" }]`.
   */
  SELF?: Fetcher;
}

/**
 * Per-snippet construction of `LOADER.load` options. Centralising this
 * here (rather than inlining at the call site) is the whole reason
 * this module is a deep module — every snippet's security/binding
 * surface lives in one place and is easy to audit.
 *
 * Defaults: every snippet runs with `globalOutbound: null` (no
 * outbound network from the spawned isolate) and an empty `env`.
 * Snippets that need a relaxation opt in below.
 */
function loadOptionsFor(snippet: Snippet, env: SpawnEnv): WorkerLoaderWorkerCode {
  const base: WorkerLoaderWorkerCode = {
    compatibilityDate: "2026-05-05",
    mainModule: "snippet.js",
    modules: { "snippet.js": snippet.code },
    globalOutbound: null,
    env: {},
  };

  switch (snippet.id) {
    case "compute":
      // Pure CPU. No network, no env, no escape hatch.
      return base;

    case "fetch":
      // Allow outbound network. Omitting `globalOutbound` lets the
      // spawned isolate use the parent worker's outbound surface.
      return { ...base, globalOutbound: undefined };

    case "ai":
      // Worker Loader can't serialise the AI binding cross-isolate via
      // `env` (it's not a structured-cloneable object). Workaround: hand
      // the spawned isolate the parent worker's SELF service binding as
      // its `globalOutbound`. The snippet's `fetch()` then ends up
      // hitting the parent worker again, which intercepts a known
      // internal path and runs the real `env.AI.run(...)`. From the
      // audience's POV the dynamic worker is calling AI — and it is,
      // just routed through the parent's binding.
      return {
        ...base,
        globalOutbound: env.SELF as Fetcher | undefined,
      };

    case "sandbox-fail":
      // The point of this snippet is to demonstrate refusal. Strict
      // isolation (globalOutbound: null, env: {}) is the whole story.
      return base;

    case "globe-app":
      // The globe-spawn endpoint replaces this with the real bundled
      // globe app via `spawnGlobe(env)`. This case is unreachable from
      // the regular spawn path because the deck routes the globe-app
      // snippet through `spawnGlobe()` directly; included for
      // exhaustiveness so the switch is total.
      return base;

    case "spawn-many":
      // Each isolate runs a fast compute (no network, no env). The
      // multi-spawn endpoint runs N of these in parallel.
      return base;
  }
}

/** Deterministic, short id for the spawned isolate — visible in the UI. */
function makeIsolateId(): string {
  // 8 hex chars is plenty for "different every spawn" + concise on-screen.
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `iso_${hex}`;
}

/**
 * Construct the LOADER options for a globe-app session. The spawned
 * isolate is given the parent worker's SELF service binding as its
 * globalOutbound so it can fetch the static globe-app HTML from the
 * parent's ASSETS — which is the magic that lets a dynamic worker
 * serve a React + three.js page without bundling those into its own
 * code.
 */
function globeAppLoadOptions(self: Fetcher): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: "2026-05-05",
    mainModule: "globe-host.js",
    modules: { "globe-host.js": GLOBE_HOST_CODE },
    globalOutbound: self,
    env: {},
  };
}

/**
 * Result envelope for `spawnGlobe`. The id is the cache key for the
 * spawned worker; the sessionUrl is the path the deck's iframe should
 * point at. Calls to `/api/cf-dynamic-workers/session/:id/*` will be
 * routed back into the cached isolate via `forwardSession`.
 */
export interface GlobeSpawnResult {
  id: string;
  elapsedMs: number;
  ok: boolean;
  sessionUrl?: string;
  error?: string;
}

/**
 * Spawn (or warm) a globe-app isolate. Returns a session URL the deck
 * can iframe. The isolate is cached via `LOADER.get(id, factory)` so
 * subsequent requests in the same session reuse it (no cold-start on
 * every request).
 */
export async function spawnGlobe(env: SpawnEnv): Promise<GlobeSpawnResult> {
  const id = makeIsolateId();
  const t0 = performance.now();

  if (!env.SELF) {
    return {
      id,
      elapsedMs: 0,
      ok: false,
      error: "SELF service binding unavailable; cannot spawn globe app.",
    };
  }
  if (!env.LOADER || typeof env.LOADER.get !== "function") {
    return {
      id,
      elapsedMs: 0,
      ok: false,
      error: "LOADER.get unavailable.",
    };
  }

  try {
    const self = env.SELF;
    await env.LOADER.get(id, async () => globeAppLoadOptions(self));
    return {
      id,
      elapsedMs: Number((performance.now() - t0).toFixed(2)),
      ok: true,
      sessionUrl: `/api/cf-dynamic-workers/session/${id}/`,
    };
  } catch (cause) {
    return {
      id,
      elapsedMs: Number((performance.now() - t0).toFixed(2)),
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Result envelope for the multi-spawn flow. `totalElapsedMs` is the
 * wall-clock elapsed for the entire batch (so it measures the slowest
 * isolate plus the orchestration overhead). Each entry in `isolates`
 * is the SpawnResult for a single isolate.
 */
export interface MultiSpawnResult {
  count: number;
  totalElapsedMs: number;
  ok: boolean;
  isolates: Array<{
    id: string;
    elapsedMs: number;
    memoryKb: number;
    ok: boolean;
    result?: unknown;
    error?: string;
  }>;
}

/**
 * Spawn N isolates running the canonical "spawn-many" snippet (a fast
 * compute). The Worker Loader runtime caps **concurrent** Dynamic
 * Workers at 4 per parent request — going past that surfaces "Too many
 * concurrent dynamic workers" on the overflowing isolates. We work
 * within the limit by running batches of 4 in parallel, waiting for
 * each batch to fully resolve (which disposes those isolates), and
 * then spawning the next batch.
 *
 * Net effect for the audience: a press that says "10 isolates" really
 * does birth 10 isolates with 10 distinct ids — just in three quick
 * waves of four-four-two rather than one wave of ten. Total wall-clock
 * stays well under 100 ms because each isolate's compute finishes in
 * a few ms.
 *
 * Capped at 32 to keep the demo bounded on stage.
 */
export async function spawnMany(
  env: SpawnEnv,
  count: number,
): Promise<MultiSpawnResult> {
  const safeCount = Math.max(1, Math.min(32, Math.floor(count)));
  const BATCH_SIZE = 4;
  const t0 = performance.now();

  const results: SpawnResult[] = [];
  for (let offset = 0; offset < safeCount; offset += BATCH_SIZE) {
    const batch = Math.min(BATCH_SIZE, safeCount - offset);
    const tasks = Array.from({ length: batch }, () =>
      spawn(env, "spawn-many"),
    );
    const batchResults = await Promise.all(tasks);
    results.push(...batchResults);
  }

  const totalElapsedMs = Number((performance.now() - t0).toFixed(2));
  const ok = results.every((r) => r.ok);

  return {
    count: safeCount,
    totalElapsedMs,
    ok,
    isolates: results.map((r) => ({
      id: r.id,
      elapsedMs: r.elapsedMs,
      memoryKb: r.memoryKb,
      ok: r.ok,
      result: r.result,
      error: r.error,
    })),
  };
}

/**
 * Forward an incoming request into a previously-spawned globe isolate.
 *
 * `id` is the path segment from `/api/cf-dynamic-workers/session/:id/*`;
 * `subpath` is the remainder (e.g. `/` or `/index.html`). We re-fetch
 * the cached stub via `LOADER.get(id, factory)` — if the isolate is
 * still warm, the factory does not re-run.
 */
export async function forwardSession(
  env: SpawnEnv,
  id: string,
  subpath: string,
  request: Request,
): Promise<Response> {
  if (!env.SELF) {
    return new Response("SELF service binding unavailable.", { status: 500 });
  }
  if (!env.LOADER || typeof env.LOADER.get !== "function") {
    return new Response("LOADER.get unavailable.", { status: 500 });
  }

  let stub: WorkerStub;
  try {
    const self = env.SELF;
    stub = await env.LOADER.get(id, async () => globeAppLoadOptions(self));
  } catch (cause) {
    return new Response(
      `failed to load isolate ${id}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { status: 502 },
    );
  }

  // Build the inner request: same method, same body, headers + injected id.
  const innerHeaders = new Headers(request.headers);
  innerHeaders.set("x-isolate-id", id);
  const innerUrl = `https://session.internal${subpath || "/"}`;
  const innerRequest = new Request(innerUrl, {
    method: request.method,
    headers: innerHeaders,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
  });

  return await stub.getEntrypoint().fetch(innerRequest);
}

/** Parse a Response into either parsed JSON or a `{ raw }` text fallback. */
async function readResponseBody(response: Response): Promise<unknown> {
  const ct = response.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return await response.json();
  }
  const text = await response.text();
  return { raw: text.slice(0, 4096) };
}

/**
 * The single public entry point. Loads the requested snippet into a fresh
 * Dynamic Worker, invokes its default fetch handler, and returns a
 * SpawnResult. Never throws to the caller; all error paths are encoded
 * into `{ ok: false, error }`.
 */
export async function spawn(
  env: SpawnEnv,
  snippetId: SnippetId,
  codeOverride?: string,
): Promise<SpawnResult> {
  const id = makeIsolateId();
  const t0 = performance.now();

  const baseSnippet = SNIPPETS[snippetId];
  if (!baseSnippet) {
    return {
      id,
      elapsedMs: 0,
      memoryKb: 0,
      ok: false,
      error: `unknown snippet id: ${String(snippetId)}`,
    };
  }

  const snippet: Snippet =
    typeof codeOverride === "string" && codeOverride.trim().length > 0
      ? { ...baseSnippet, code: codeOverride }
      : baseSnippet;

  try {
    const options = loadOptionsFor(snippet, env);
    const stub = env.LOADER.load(options);
    const entrypoint = stub.getEntrypoint();

    // The internal URL is opaque — the spawned isolate ignores it because
    // its router just looks at method/path. Using a stable URL keeps the
    // spawned-side trivial to reason about.
    const inner = await entrypoint.fetch(
      new Request("https://internal.dynamic-worker/run", { method: "GET" }),
    );

    const result = await readResponseBody(inner);
    const elapsedMs = performance.now() - t0;

    return {
      id,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      memoryKb: 0,
      ok: inner.ok,
      result,
      error: inner.ok ? undefined : `snippet returned status ${inner.status}`,
    };
  } catch (cause) {
    const elapsedMs = performance.now() - t0;
    return {
      id,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      memoryKb: 0,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
