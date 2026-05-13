/**
 * Live Code Mode runner — actually executes the LLM-generated TypeScript
 * inside a Cloudflare Dynamic Worker isolate (env.LOADER) instead of
 * mapping prompts to hand-written plans.
 *
 * What changes for the audience:
 *   Before — the LLM's code was DISPLAYED but the answer came from a
 *            canned `code-mode-plans.ts` function. Functionally
 *            equivalent for the four preset prompts but, well, fake.
 *   After  — every Code Mode run spins up a fresh V8 isolate, compiles
 *            the LLM's actual TypeScript as the isolate's `index.js`,
 *            and runs it. Custom prompts work for free. The cold-start
 *            race talked about earlier in the deck (5–15 ms per
 *            isolate) is the engine that powers this.
 *
 * Architecture inside the dynamic worker:
 *
 *   ┌─ /index.js (LLM code, wrapped) ──────────────────────────────┐
 *   │   import { codemode } from './codemode.js';                  │
 *   │   const __logs = [];                                         │
 *   │   const console = { log: (…) => __logs.push(…) };            │
 *   │                                                              │
 *   │   export default { async fetch() {                           │
 *   │       try { <LLM CODE BODY> } catch (err) {…}                │
 *   │       return Response.json({ logs: __logs });                │
 *   │   } };                                                        │
 *   └──────────────────────────────────────────────────────────────┘
 *
 *   ┌─ /codemode.js (typed shim — same surface as cf-api.ts) ───────┐
 *   │   const BASE = 'https://codemode.internal';                   │
 *   │   const call = async (m, a) => …fetch(`${BASE}/${m}`)…;       │
 *   │   export const codemode = {                                   │
 *   │     listZones: () => call('listZones', {}),                   │
 *   │     listDnsRecords: (zoneId) => call('listDnsRecords', {…}),  │
 *   │     …                                                         │
 *   │   };                                                          │
 *   └──────────────────────────────────────────────────────────────┘
 *
 *   The dynamic worker's outbound fetch is intercepted by a
 *   `CodemodeFetcher` WorkerEntrypoint exported FROM THIS WORKER.
 *   We hand a loopback service binding to that class
 *   (`ctx.exports.CodemodeFetcher()`) to env.LOADER.load() as
 *   `globalOutbound`. Cloudflare's runtime requires a real Fetcher
 *   here — a plain object with a fetch method is rejected.
 *
 *   The parent's CF API token never enters the dynamic worker's scope:
 *   the LLM-authored code talks ONLY to codemode.* methods, the shim
 *   issues a fetch to `codemode.internal/{tool}`, the loopback
 *   service binding routes that fetch into the WorkerEntrypoint
 *   running inside the parent (where the env DOES have the token),
 *   the entrypoint dispatches to MCP_TOOLS, and only the result is
 *   serialised back into the dynamic worker.
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "../types";
// `WorkerLoaderWorkerCode` + `WorkerStub` are now global ambient types
// (generated into worker-configuration.d.ts by `wrangler types` once
// the LOADER binding was wired in #190). Alias the verbose name to
// `WorkerCode` so the rest of this file stays close to the source-deck
// port — only the type-resolution path changed.
type WorkerCode = WorkerLoaderWorkerCode;
import { MCP_TOOLS } from "./cf-api";

/** Internal hostname the dynamic worker uses to call back into us. */
const CODEMODE_INTERNAL = "codemode.internal";

export interface RunCodeResult {
  /** Lines the LLM-authored code produced via console.log. */
  logs: string[];
  /**
   * Set when the LLM code threw (with the error message), or when the
   * isolate itself failed to spin up (binding missing, code didn't
   * compile, etc).
   */
  error?: string;
  /**
   * Whether the run actually executed inside a Worker Loader isolate
   * (the truthful "live" path). False = the binding was unavailable
   * and we wouldn't run at all; the caller must decide whether to
   * fall back. We never SILENTLY fall back — the badge in the slide
   * shows which path produced the answer.
   */
  ranInIsolate: boolean;
}

/**
 * `CodemodeFetcher` — the loopback WorkerEntrypoint that the dynamic
 * worker's outbound fetch is routed through. Called as a Fetcher
 * (env.LOADER's globalOutbound), it dispatches `codemode.internal/{tool}`
 * URLs to the real MCP_TOOLS using the parent's env (so secrets stay
 * outside the dynamic worker).
 *
 * Exported from `worker/index.ts` so the runtime can find the class
 * by name when we do `ctx.exports.CodemodeFetcher()`.
 */
export class CodemodeFetcher extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== CODEMODE_INTERNAL) {
      // Block anything that isn't a tool call. Mirrors the security
      // story we tell on the foundation slides: the LLM-authored code
      // can ONLY hit the surface we expose, never the public Internet.
      return new Response("Outbound network blocked", { status: 403 });
    }
    const tool = url.pathname.replace(/^\//, "");
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    let args: Record<string, unknown> = {};
    try {
      args = (await request.json()) as Record<string, unknown>;
    } catch {
      // Empty body is fine for tools without args.
    }
    try {
      const result = await dispatchTool(this.env, tool, args);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}

/**
 * Run an LLM-authored async-function body inside a fresh Dynamic Worker
 * isolate. Returns whatever it console.log'd. Throws if Worker Loader
 * is not available — the caller can decide whether to surface that or
 * fall back to a canned plan.
 */
export async function runLlmCodeInIsolate(opts: {
  env: Env;
  /** ExecutionContext from the parent's fetch handler — we need
   *  ctx.exports to construct the loopback Fetcher. */
  ctx: ExecutionContext;
  /** Raw LLM-generated code (the BODY of an async function). */
  llmCode: string;
  /** Used as a hint for diagnostics; the isolate is fresh per call. */
  runId: string;
  /** Soft cap on logs to avoid the SSE stream growing unbounded. */
  maxLogLines?: number;
}): Promise<RunCodeResult> {
  const { env, ctx, llmCode, maxLogLines = 200 } = opts;

  if (!env.LOADER) {
    throw new Error(
      "Worker Loader binding (env.LOADER) is not available — Dynamic Workers are required for live Code Mode.",
    );
  }

  // ctx.exports is added by the runtime when at least one
  // WorkerEntrypoint subclass is exported from the entry module. We
  // use it here to build a self-loopback Fetcher to CodemodeFetcher.
  const ctxExports = (
    ctx as unknown as {
      exports?: Record<string, (opts?: { props?: unknown }) => Fetcher>;
    }
  ).exports;
  if (!ctxExports?.CodemodeFetcher) {
    throw new Error(
      "ctx.exports.CodemodeFetcher is unavailable — make sure the class is exported from the entry module and the runtime is recent enough.",
    );
  }
  // The runtime expects an Options object even when we have no
  // per-request props. Passing `{}` avoids "parameter 1 is not of
  // type 'Options'".
  const codemodeFetcher = ctxExports.CodemodeFetcher({});

  const indexJs = wrapLlmCode(llmCode);
  const codemodeJs = CODEMODE_SHIM;

  const code: WorkerCode = {
    compatibilityDate: "2026-04-21",
    mainModule: "index.js",
    modules: {
      "index.js": indexJs,
      "codemode.js": codemodeJs,
    },
    // The dynamic worker can ONLY reach codemode.internal — every
    // other outbound destination returns 403. Cf the security story
    // we tell on the foundation slides.
    globalOutbound: codemodeFetcher,
  };

  // Note: load() (not get()) — we want a fresh isolate per request so
  // the audience genuinely sees a 5-15ms cold-start every time.
  const loader = env.LOADER as { load: (c: WorkerCode) => WorkerStub };
  const stub = loader.load(code);
  const entrypoint = stub.getEntrypoint();

  const response = await entrypoint.fetch(
    new Request("https://run.codemode.internal/run"),
  );
  let payload: { logs?: string[]; error?: string } = {};
  try {
    payload = (await response.json()) as { logs?: string[]; error?: string };
  } catch {
    // Non-JSON response — shouldn't happen, but keep going.
    payload = { error: `Non-JSON response from isolate (${response.status})` };
  }

  const logs = (payload.logs ?? []).slice(0, maxLogLines);
  return {
    logs,
    error: payload.error,
    ranInIsolate: true,
  };
}

/**
 * Wrap an LLM-authored async function body in a Worker module that
 * captures console.log and exposes the codemode shim.
 */
function wrapLlmCode(llmCode: string): string {
  // The LLM's code becomes the body of an `async fetch()` inside a
  // wrapper module. We DO NOT escape backticks or `${…}` here: the
  // outer template-literal substitution below is plain string
  // concatenation, so a backtick in the LLM code becomes a literal
  // backtick in the resulting module source — exactly what we want
  // for `console.log(\`...\`)` style answers. Escaping them turned
  // every template literal in the LLM output into "Invalid or
  // unexpected token" syntax errors.
  const safe = llmCode;
  return `import { codemode } from './codemode.js';

const __logs = [];
const __MAX_LINES = 200;
const __MAX_LEN = 4000;

function __fmt(value) {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

const console = {
  log(...args) {
    if (__logs.length >= __MAX_LINES) return;
    const line = args.map(__fmt).join(' ');
    __logs.push(line.length > __MAX_LEN ? line.slice(0, __MAX_LEN) + ' …(truncated)' : line);
  },
};

export default {
  async fetch() {
    try {
      // ─── LLM-authored code starts here ────────────────────────
      ${safe}
      // ─── LLM-authored code ends ───────────────────────────────
      return new Response(JSON.stringify({ logs: __logs }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({ logs: __logs, error: message }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
  },
};
`;
}

/**
 * Codemode shim — the module that the dynamic worker's `import { codemode }`
 * resolves to. Each call POSTs to https://codemode.internal/{tool} with
 * the args as JSON. The dynamic worker's globalOutbound (a loopback
 * service binding to CodemodeFetcher) routes that fetch back into the
 * parent's env, where MCP_TOOLS does the real Cloudflare-API work.
 */
const CODEMODE_SHIM = `const BASE = 'https://${CODEMODE_INTERNAL}';

async function call(tool, args) {
  const res = await fetch(BASE + '/' + tool, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text }; }
  if (!res.ok || (body && body.error)) {
    throw new Error(typeof body?.error === 'string' ? body.error : ('codemode.' + tool + ' failed: HTTP ' + res.status));
  }
  return body;
}

export const codemode = {
  listZones: () => call('listZones', {}),
  listDnsRecords: (zoneId) => call('listDnsRecords', { zoneId }),
  listCustomWafRules: (zoneId) => call('listCustomWafRules', { zoneId }),
  getZone: (zoneId) => call('getZone', { zoneId }),
};
`;

/** Dispatch a tool name to the real MCP_TOOLS in the parent's env. */
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
      throw new Error(`Unknown codemode tool: ${name}`);
  }
}
