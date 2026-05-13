/**
 * cf-dynamic-workers / globe-host
 *
 * The Worker module shipped to the spawned isolate for the
 * `spawn-the-globe-app` snippet. This is the entire fetch handler that
 * runs inside the dynamic isolate spawned via `env.LOADER.load(...)`.
 *
 * Ported from the source deck's `worker/globe-host.ts` (issue #167 /
 * #106 follow-up). The source string is verbatim — only the file
 * header has changed to reflect its new home inside slide-of-hand's
 * platform worker.
 *
 * ## How it works
 *
 * The spawned isolate's only job is to serve the globe app's HTML at
 * its session URL. It fetches the canonical globe HTML from the parent
 * worker via the SELF service binding (passed in as `globalOutbound`),
 * substitutes the placeholder isolate id, and returns the result. The
 * isolate has no idea what URL the audience is looking at — it just
 * sees a request, fetches a template, and returns the personalised
 * page.
 *
 * The parent worker's session forwarder injects `x-isolate-id` into
 * every request before forwarding, so the spawned isolate knows what
 * id to render.
 *
 * ## Parent-side asset path
 *
 * The string fetches `https://parent.internal/globe-app/index.html` —
 * the host is opaque (it's a Fetcher, not a real DNS resolution), but
 * the PATH must match what the parent serves. Slide of Hand's deck
 * lives at `src/decks/public/cf-dynamic-workers/globe-app/` and the
 * Vite SPA build serves it under that exact path. So the string is
 * literal.
 */

export const GLOBE_HOST_CODE = `// Spawned-worker code: served by env.LOADER.load(...) modules['globe-host.js'].
// This is the entire fetch handler the dynamic isolate runs. The parent
// worker hands it a SELF service binding via globalOutbound, so this
// fetch() goes back to the parent, which serves the built globe-app.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const isolateId = request.headers.get("x-isolate-id") || "unknown";

    // Only the root path serves the globe HTML; everything else 404s so
    // we don't accidentally proxy random asset requests (those should be
    // satisfied by the parent's ASSETS binding directly via the iframe).
    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      return new Response("not found", { status: 404 });
    }

    // Fetch the canonical globe-app HTML from the parent. \`globalOutbound\`
    // points at the parent worker (SELF service binding); the URL host
    // is opaque — the parent's fetch handler routes by path.
    const upstream = await fetch("https://parent.internal/globe-app/index.html");
    if (!upstream.ok) {
      return new Response(
        "Failed to load globe template: " + upstream.status,
        { status: 502 },
      );
    }

    // The parent's globe-app/index.html ships with __ISOLATE_ID__ as the
    // body's data-isolate-id placeholder. Replace it with the real id so
    // the watermark in the bottom-left of the page identifies THIS
    // specific isolate. Globe-app asset URLs are absolute (/globe-app/
    // assets/...) so they resolve against the iframe origin (the parent
    // worker's ASSETS binding) without further rewriting.
    const html = await upstream.text();
    const personalised = html.replace(/__ISOLATE_ID__/g, isolateId);

    return new Response(personalised, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-served-by-isolate": isolateId,
      },
    });
  },
};
`;
