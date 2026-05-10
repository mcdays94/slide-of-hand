/**
 * Canonical snippet library — single source of truth for the live demo.
 *
 * Imported by:
 *   - the frontend (src/...) to populate the textarea on slide 08
 *   - the backend (worker/spawn.ts) to ship as `mainModule` to LOADER.load
 *
 * Every snippet is a complete Cloudflare Worker module (i.e. it exports
 * `default { fetch(request, env) { ... } }`). When a Spawn click hits the
 * backend, the spawn module loads the snippet into a fresh Dynamic Worker
 * isolate, calls `entrypoint.fetch(...)`, and returns whatever JSON the
 * snippet's response body produced.
 *
 * Phase 3a (this commit) ships compute / fetch / ai / sandbox-fail.
 * Phase 3b will replace the globe-app stub with the real bundled globe app.
 */

export type SnippetId =
  | "compute"
  | "fetch"
  | "ai"
  | "sandbox-fail"
  | "globe-app"
  | "spawn-many";

export interface Snippet {
  id: SnippetId;
  /** Short label shown on the tab in slide 08. */
  label: string;
  /** One-line description shown beneath the label. */
  description: string;
  /** The Worker module source — exported `default { fetch(request, env) { … } }`. */
  code: string;
  /**
   * The PARENT worker source — i.e. the code that calls
   * `env.LOADER.load(...)` to spawn the snippet above. This is what the
   * audience must SEE for the live demo to land: the spawn isn't
   * magic, it's a single function call that hands the snippet over to
   * the runtime. Each snippet has a slightly different parent shape
   * because the security/binding surface (globalOutbound, env passed
   * down) is per-snippet — that's the whole point of `loadOptionsFor`
   * in worker/spawn.ts. The string here is the lightly-simplified
   * pedagogical version of that real construction.
   */
  parentCode: string;
}

const COMPUTE_CODE = `// Compute the 1000th prime number — pure CPU, no network, no env.
// Runs inside a fresh V8 isolate spawned by env.LOADER.load(...).
export default {
  async fetch(request) {
    const t0 = performance.now();
    const primes = [];
    let n = 2;
    while (primes.length < 1000) {
      let isPrime = true;
      for (const p of primes) {
        if (p * p > n) break;
        if (n % p === 0) {
          isPrime = false;
          break;
        }
      }
      if (isPrime) primes.push(n);
      n++;
    }
    const elapsedMs = performance.now() - t0;
    return Response.json({
      kind: "compute",
      label: "1000th prime number",
      value: primes[primes.length - 1],
      tested: n - 2,
      computeMs: Number(elapsedMs.toFixed(2)),
    });
  },
};
`;

const FETCH_CODE = `// Outbound fetch from inside the isolate — proves the spawned Worker
// can reach the network when the parent allows it. The parent passes
// a fetcher via globalOutbound, so the isolate's global fetch() is
// gated through the parent's network.
export default {
  async fetch(request) {
    const r = await fetch(
      "https://api.github.com/repos/cloudflare/workers-sdk",
      { headers: { "user-agent": "cf-dynamic-workers-slides-demo" } },
    );
    if (!r.ok) {
      return Response.json(
        { kind: "fetch", error: \`upstream returned \${r.status}\` },
        { status: 502 },
      );
    }
    const repo = await r.json();
    return Response.json({
      kind: "fetch",
      label: "GitHub: cloudflare/workers-sdk",
      url: repo.html_url,
      stars: repo.stargazers_count,
      openIssues: repo.open_issues_count,
      lastPush: repo.pushed_at,
    });
  },
};
`;

const AI_CODE = `// Workers AI from inside the isolate. The parent worker hands us its
// SELF service binding as our 'globalOutbound', so a normal fetch()
// here goes back to the parent — which intercepts /__internal/ai-proxy
// and runs the real env.AI.run(...). Same model, same auth — but the
// calling code is shipped at runtime, not deployed up front.
export default {
  async fetch(request) {
    const r = await fetch("https://parent/__internal/ai-proxy", {
      method: "POST",
      body: JSON.stringify({
        model: "@cf/meta/llama-3.1-8b-instruct",
        input: {
          messages: [
            {
              role: "system",
              content:
                "Reply in plain prose. Be concise. No bullet points. Maximum two sentences.",
            },
            {
              role: "user",
              content:
                "In two sentences, explain what a Cloudflare Dynamic Worker is to someone who has never written code.",
            },
          ],
          max_tokens: 180,
        },
      }),
    });
    if (!r.ok) {
      const body = await r.json();
      return Response.json(
        { kind: "ai", error: "ai_call_failed", upstream: body },
        { status: 502 },
      );
    }
    const data = await r.json();
    const reply = typeof data === "object" && data && "response" in data
      ? String(data.response).trim()
      : JSON.stringify(data);
    return Response.json({
      kind: "ai",
      label: "Workers AI · llama-3.1-8b-instruct",
      reply,
    });
  },
};
`;

const SANDBOX_FAIL_CODE = `// Run untrusted — the parent loads this snippet with globalOutbound: null,
// which strips the spawned isolate of all outbound network access. The
// snippet then deliberately tries to do things a malicious payload might
// try. Every attempt is caught and surfaced — the audience sees the
// sandbox refusing each one in turn.
export default {
  async fetch(request, env) {
    const attempts = [];

    // 1. Outbound fetch to the public internet
    try {
      await fetch("https://example.com/");
      attempts.push({
        action: "fetch https://example.com",
        outcome: "ALLOWED (unexpected!)",
      });
    } catch (cause) {
      attempts.push({
        action: "fetch https://example.com",
        outcome: "BLOCKED",
        reason: String(cause).slice(0, 200),
      });
    }

    // 2. Outbound fetch to the Cloudflare API (i.e. attempt to abuse parent)
    try {
      await fetch("https://api.cloudflare.com/client/v4/user");
      attempts.push({
        action: "fetch https://api.cloudflare.com/client/v4/user",
        outcome: "ALLOWED (unexpected!)",
      });
    } catch (cause) {
      attempts.push({
        action: "fetch https://api.cloudflare.com/client/v4/user",
        outcome: "BLOCKED",
        reason: String(cause).slice(0, 200),
      });
    }

    // 3. Inspect the env handed to us (should be empty — no parent secrets)
    const envKeys = env ? Object.keys(env) : [];
    attempts.push({
      action: "Object.keys(env)",
      outcome: envKeys.length === 0 ? "EMPTY (as expected)" : "EXPOSED",
      keys: envKeys,
    });

    return Response.json({
      kind: "sandbox-fail",
      label: "Untrusted code · sandbox enforcement",
      isolation: "globalOutbound: null, env: {}",
      attempts,
    });
  },
};
`;

/**
 * Parent-worker code blocks. These are the code that the speaker is
 * actually running on stage when they click Spawn — the wrapper that
 * calls `env.LOADER.load(...)` and hands the snippet to the runtime.
 * Showing them next to the spawned snippet is what turns the live
 * demo from "look, JavaScript ran" into "look, ONE function call
 * spun up an entire isolate."
 *
 * Kept simplified: in real life worker/spawn.ts has a switch over
 * snippet ids (see `loadOptionsFor`). On the slide we show the
 * relevant LOADER.load shape for each snippet inline so the audience
 * doesn't have to mentally branch.
 */

const COMPUTE_PARENT = `// Your worker — runs on every request.
export default {
  async fetch(request, env) {
    // ONE call. This is the entire spawn API.
    const isolate = env.LOADER.load({
      mainModule: "snippet.js",
      modules: { "snippet.js": userCode },
    });
    return isolate.getEntrypoint().fetch(request);
  },
};
`;

const FETCH_PARENT = `// Your worker — gives the spawned isolate network access.
export default {
  async fetch(request, env) {
    const isolate = env.LOADER.load({
      mainModule: "snippet.js",
      modules: { "snippet.js": userCode },
      // Omitting globalOutbound = use the parent worker's outbound
      // surface; the isolate can fetch() the public internet.
    });
    return isolate.getEntrypoint().fetch(request);
  },
};
`;

const AI_PARENT = `// Your worker — hands the AI binding to the spawned isolate.
export default {
  async fetch(request, env) {
    const isolate = env.LOADER.load({
      mainModule: "snippet.js",
      modules: { "snippet.js": userCode },
      // Workers AI isn't structured-cloneable — we can't pass it
      // directly. Instead: hand the isolate a Fetcher back to US
      // (env.SELF), and we intercept /__internal/ai-proxy below to
      // run the real env.AI.run(...) on its behalf.
      globalOutbound: env.SELF,
    });
    return isolate.getEntrypoint().fetch(request);
  },
};
`;

const SANDBOX_FAIL_PARENT = `// Your worker — locks the isolate down before handing it work.
export default {
  async fetch(request, env) {
    const isolate = env.LOADER.load({
      mainModule: "snippet.js",
      modules: { "snippet.js": userCode },
      env: {},               // No parent secrets reach the isolate.
      globalOutbound: null,  // No outbound network at all.
    });
    return isolate.getEntrypoint().fetch(request);
  },
};
`;

const SPAWN_MANY_PARENT = `// Your worker — spawn ten isolates in parallel.
export default {
  async fetch(request, env) {
    const isolates = await Promise.all(
      Array.from({ length: 10 }, () =>
        env.LOADER.load({
          mainModule: "snippet.js",
          modules: { "snippet.js": userCode },
        }),
      ),
    );
    const responses = await Promise.all(
      isolates.map((iso) => iso.getEntrypoint().fetch(request)),
    );
    return Response.json({ count: responses.length });
  },
};
`;

const GLOBE_APP_PARENT = `// Your worker — caches the spawned isolate by session id so the
// iframe's many requests reuse the same warm Dynamic Worker.
export default {
  async fetch(request, env) {
    const id = "iso_" + crypto.randomUUID().slice(0, 8);
    const isolate = await env.LOADER.get(id, () => ({
      mainModule: "globe-host.js",
      modules: { "globe-host.js": globeSource },
      // The spawned isolate fetches the static globe HTML through us.
      globalOutbound: env.SELF,
    }));
    // The iframe later hits /api/session/<id>/, which routes back into
    // this same cached isolate via env.LOADER.get.
    return Response.json({ sessionUrl: \`/api/session/\${id}/\` });
  },
};
`;

export const SNIPPETS: Record<SnippetId, Snippet> = {
  compute: {
    id: "compute",
    label: "Pure compute",
    description:
      "Computes the 1000th prime inside the spawned isolate. No network, no env — just CPU.",
    code: COMPUTE_CODE,
    parentCode: COMPUTE_PARENT,
  },
  fetch: {
    id: "fetch",
    label: "Fetch the world",
    description:
      "Outbound HTTP from the spawned isolate. The parent allows network and the worker pulls live data from a public API.",
    code: FETCH_CODE,
    parentCode: FETCH_PARENT,
  },
  ai: {
    id: "ai",
    label: "Tiny AI call",
    description:
      "The parent passes its Workers AI binding into the spawned isolate. The dynamic worker calls a model and returns the reply.",
    code: AI_CODE,
    parentCode: AI_PARENT,
  },
  "sandbox-fail": {
    id: "sandbox-fail",
    label: "Run untrusted",
    description:
      "Same isolate, but loaded with globalOutbound: null and an empty env. Watch every forbidden action get refused.",
    code: SANDBOX_FAIL_CODE,
    parentCode: SANDBOX_FAIL_PARENT,
  },
  "globe-app": {
    id: "globe-app",
    label: "Spawn the globe app",
    description:
      "Hits a different endpoint (/api/spawn/globe). The parent loads a Dynamic Worker that serves a 3D globe at a fresh /api/session/:id/ URL — and the iframe to the right loads that session live.",
    parentCode: GLOBE_APP_PARENT,
    code: `// Spawned isolate, served by env.LOADER.load(...).
// Its globalOutbound is the parent worker's SELF service binding,
// so fetch() calls go back to the parent for the static globe HTML.
// The forwarder injects \`x-isolate-id\` so this worker knows which
// session it's serving — and stamps that into the page's watermark.
export default {
  async fetch(request) {
    const isolateId = request.headers.get("x-isolate-id") || "unknown";
    const upstream = await fetch("https://parent/globe-app/index.html");
    if (!upstream.ok) {
      return new Response("globe-app fetch failed", { status: 502 });
    }
    const html = await upstream.text();
    const personalised = html.replace(/__ISOLATE_ID__/g, isolateId);
    return new Response(personalised, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
`,
  },
  "spawn-many": {
    id: "spawn-many",
    label: "Spawn many in parallel",
    description:
      "The parent calls env.LOADER.load(...) ten times in parallel via Promise.all. Each isolate is a brand-new V8 — different IDs, independent memory, all spawned and disposed in the same wall-clock window.",
    parentCode: SPAWN_MANY_PARENT,
    code: `// This is the code that runs INSIDE each spawned isolate. Below is
// a thin compute that finishes in <1 ms — but the magic isn't here:
// it's the parent worker spawning ten copies of this in parallel via
// Promise.all(env.LOADER.load(...)). Ten isolates. Ten IDs. One press.
export default {
  async fetch(request) {
    const target = 100;
    const primes = [];
    let n = 2;
    while (primes.length < target) {
      let isPrime = true;
      for (const p of primes) {
        if (p * p > n) break;
        if (n % p === 0) {
          isPrime = false;
          break;
        }
      }
      if (isPrime) primes.push(n);
      n++;
    }
    return Response.json({
      kind: "compute",
      value: primes[primes.length - 1],
    });
  },
};
`,
  },
};
