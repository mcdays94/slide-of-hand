/**
 * Tests for the cache-control pipeline (`worker/cache-control.ts`).
 *
 * Lives at `worker/index.test.ts` because the pipeline is part of the
 * Worker entry's response handler; the production-smoke curls in the
 * post-deploy ritual (see RESUME.md) verify the integration through
 * `env.ASSETS.fetch(...)`.
 */
import { describe, it, expect } from "vitest";
import {
  enforceHtmlNoCache,
  enforceHashedAssetImmutable,
  isHashedAssetPath,
  applyCacheControl,
} from "./cache-control";

function htmlResponse(extraHeaders: Record<string, string> = {}): Response {
  return new Response("<!doctype html><html></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

function jsResponse(): Response {
  return new Response("// some js", {
    status: 200,
    headers: {
      "content-type": "application/javascript",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

describe("enforceHtmlNoCache", () => {
  it("rewrites Cache-Control on HTML responses to no-cache, must-revalidate", () => {
    const input = htmlResponse({ "cache-control": "public, max-age=3600" });
    const output = enforceHtmlNoCache(input);
    expect(output.headers.get("cache-control")).toBe(
      "no-cache, must-revalidate",
    );
  });

  it("sets Cache-Control on HTML responses that had no Cache-Control header", () => {
    const input = htmlResponse();
    const output = enforceHtmlNoCache(input);
    expect(output.headers.get("cache-control")).toBe(
      "no-cache, must-revalidate",
    );
  });

  it("preserves other headers on HTML responses (content-type, etc.)", () => {
    const input = htmlResponse({
      "x-custom-header": "preserved",
      etag: '"abc123"',
    });
    const output = enforceHtmlNoCache(input);
    expect(output.headers.get("x-custom-header")).toBe("preserved");
    expect(output.headers.get("etag")).toBe('"abc123"');
    expect(output.headers.get("content-type")?.startsWith("text/html")).toBe(
      true,
    );
  });

  it("passes JS responses through untouched (immutable hashed-asset cache)", () => {
    const input = jsResponse();
    const output = enforceHtmlNoCache(input);
    expect(output).toBe(input);
    expect(output.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("passes through responses with no content-type header", () => {
    const input = new Response("raw bytes", { status: 200 });
    const output = enforceHtmlNoCache(input);
    expect(output).toBe(input);
  });

  it("is case-insensitive on the content-type header value", () => {
    const input = new Response("<!doctype html>", {
      headers: { "content-type": "TEXT/HTML; charset=UTF-8" },
    });
    const output = enforceHtmlNoCache(input);
    expect(output.headers.get("cache-control")).toBe(
      "no-cache, must-revalidate",
    );
  });

  it("preserves the status and statusText on rewritten responses", () => {
    const input = new Response("<!doctype html>...", {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/html" },
    });
    const output = enforceHtmlNoCache(input);
    expect(output.status).toBe(200);
    expect(output.statusText).toBe("OK");
  });

  it("does not touch text/plain responses (e.g. /robots.txt) — only text/html", () => {
    const input = new Response("User-agent: *", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=86400",
      },
    });
    const output = enforceHtmlNoCache(input);
    expect(output.headers.get("cache-control")).toBe(
      "public, max-age=86400",
    );
  });
});

describe("isHashedAssetPath", () => {
  it("recognises Vite-style hashed JS chunks", () => {
    expect(isHashedAssetPath("/assets/index-Bu7OSlod.js")).toBe(true);
    expect(isHashedAssetPath("/assets/StudioAgentPanel-CY_BZ3T0.js")).toBe(
      true,
    );
    expect(isHashedAssetPath("/assets/NotesEditor-CXEB_OZx.js.map")).toBe(true);
  });

  it("recognises Vite-style hashed CSS chunks", () => {
    expect(isHashedAssetPath("/assets/index-aBcD1234.css")).toBe(true);
  });

  it("recognises Vite-style hashed image chunks", () => {
    expect(isHashedAssetPath("/assets/photo-DyXKPTPP.svg")).toBe(true);
  });

  it("rejects /assets/ paths without a hash component", () => {
    expect(isHashedAssetPath("/assets/index.js")).toBe(false);
    expect(isHashedAssetPath("/assets/index.css")).toBe(false);
  });

  it("rejects non-/assets paths", () => {
    expect(isHashedAssetPath("/")).toBe(false);
    expect(isHashedAssetPath("/index.html")).toBe(false);
    expect(isHashedAssetPath("/thumbnails/hello/01.png")).toBe(false);
    expect(isHashedAssetPath("/decks/hello")).toBe(false);
    expect(isHashedAssetPath("/api/admin/decks")).toBe(false);
  });

  it("rejects paths that look hashed but aren't under /assets/", () => {
    expect(isHashedAssetPath("/something/index-Bu7OSlod.js")).toBe(false);
  });
});

describe("enforceHashedAssetImmutable", () => {
  function jsRequest(pathname: string): Request {
    return new Request(`https://slideofhand.lusostreams.com${pathname}`);
  }

  function jsResponse(extraHeaders: Record<string, string> = {}): Response {
    return new Response("// content", {
      status: 200,
      headers: {
        "content-type": "text/javascript",
        ...extraHeaders,
      },
    });
  }

  it("sets immutable, year-long Cache-Control on hashed JS responses", () => {
    const req = jsRequest("/assets/index-Bu7OSlod.js");
    const resp = jsResponse({ "cache-control": "public, max-age=0" });
    const output = enforceHashedAssetImmutable(req, resp);
    expect(output.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("sets immutable Cache-Control on hashed CSS responses", () => {
    const req = jsRequest("/assets/index-aBcD1234.css");
    const resp = new Response(".x{}", {
      status: 200,
      headers: { "content-type": "text/css" },
    });
    const output = enforceHashedAssetImmutable(req, resp);
    expect(output.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("preserves other headers on rewritten responses", () => {
    const req = jsRequest("/assets/index-Bu7OSlod.js");
    const resp = jsResponse({
      etag: '"abc123"',
      "x-custom": "preserved",
    });
    const output = enforceHashedAssetImmutable(req, resp);
    expect(output.headers.get("etag")).toBe('"abc123"');
    expect(output.headers.get("x-custom")).toBe("preserved");
    expect(output.headers.get("content-type")).toBe("text/javascript");
  });

  it("does NOT mark non-200 hashed-asset responses immutable (e.g. 404 after a deploy)", () => {
    const req = jsRequest("/assets/deleted-AbCd1234.js");
    const resp = new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
    const output = enforceHashedAssetImmutable(req, resp);
    expect(output).toBe(resp);
  });

  it("passes through non-hashed paths untouched", () => {
    const req = jsRequest("/");
    const resp = new Response("<!doctype html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const output = enforceHashedAssetImmutable(req, resp);
    expect(output).toBe(resp);
  });
});

describe("applyCacheControl (full pipeline)", () => {
  it("HTML at / → no-cache, must-revalidate", () => {
    const req = new Request("https://slideofhand.lusostreams.com/");
    const resp = new Response("<!doctype html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const output = applyCacheControl(req, resp);
    expect(output.headers.get("cache-control")).toBe(
      "no-cache, must-revalidate",
    );
  });

  it("hashed JS at /assets/index-Bu7OSlod.js → immutable", () => {
    const req = new Request(
      "https://slideofhand.lusostreams.com/assets/index-Bu7OSlod.js",
    );
    const resp = new Response("// content", {
      status: 200,
      headers: { "content-type": "text/javascript" },
    });
    const output = applyCacheControl(req, resp);
    expect(output.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("SPA fallback at /decks/hello (HTML response from binding) → no-cache", () => {
    // /decks/hello isn't a real file; not_found_handling routes it to
    // index.html. Content-type is text/html, path is non-hashed, so
    // only enforceHtmlNoCache applies.
    const req = new Request("https://slideofhand.lusostreams.com/decks/hello");
    const resp = new Response("<!doctype html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const output = applyCacheControl(req, resp);
    expect(output.headers.get("cache-control")).toBe(
      "no-cache, must-revalidate",
    );
  });

  it("thumbnail PNG (not hashed, not HTML) passes through untouched", () => {
    const req = new Request(
      "https://slideofhand.lusostreams.com/thumbnails/hello/01.png",
    );
    const resp = new Response("PNGBYTES", {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      },
    });
    const output = applyCacheControl(req, resp);
    expect(output.headers.get("cache-control")).toBe(
      "public, max-age=86400",
    );
  });
});
