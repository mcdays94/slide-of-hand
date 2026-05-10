/**
 * Tests for the HTML cache-control rewriter (`worker/cache-control.ts`).
 *
 * Lives at `worker/index.test.ts` because the rewriter is part of the
 * Worker entry's response pipeline; the production-smoke curls in the
 * post-deploy ritual (see RESUME.md) verify the integration through
 * `env.ASSETS.fetch(...)`.
 */
import { describe, it, expect } from "vitest";
import { enforceHtmlNoCache } from "./cache-control";

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
