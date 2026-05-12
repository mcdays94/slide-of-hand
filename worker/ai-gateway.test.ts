/**
 * Tests for `worker/ai-gateway.ts` — the AI Gateway auth helper.
 *
 * The helper is tiny but security-adjacent: it controls whether
 * `cf-aig-authorization: Bearer <token>` is sent on every Workers
 * AI call. Buggy here means either the chat stream silently fails
 * (token not sent when gateway requires auth) or the token leaks
 * inadvertently (header attached when it shouldn't be).
 */

import { describe, expect, it } from "vitest";
import { buildAiGatewayHeaders } from "./ai-gateway";

describe("buildAiGatewayHeaders", () => {
  it("returns the auth header object when given a non-empty token", () => {
    const out = buildAiGatewayHeaders("secret-abc");
    expect(out).toEqual({ "cf-aig-authorization": "Bearer secret-abc" });
  });

  it("returns undefined when given undefined", () => {
    expect(buildAiGatewayHeaders(undefined)).toBeUndefined();
  });

  it("returns undefined when given an empty string", () => {
    // Common when a Worker secret has been deleted but the binding
    // still resolves to "" rather than removing the property.
    expect(buildAiGatewayHeaders("")).toBeUndefined();
  });

  it("returns undefined when given a whitespace-only string", () => {
    // Defence against a misconfigured secret that's all whitespace
    // (e.g. accidentally piped from a file with a trailing newline
    // that didn't get stripped). We treat it as 'unset' rather than
    // sending `Bearer    ` to the upstream.
    expect(buildAiGatewayHeaders("   ")).toBeUndefined();
    expect(buildAiGatewayHeaders("\n")).toBeUndefined();
    expect(buildAiGatewayHeaders("\t  \n")).toBeUndefined();
  });

  it("does NOT trim the token itself — preserves the value verbatim", () => {
    // Real-world tokens (cfut_...) don't have whitespace, but we
    // shouldn't silently mutate the secret. If a token comes in
    // with surrounding whitespace that's a config bug at the
    // caller's level, not something we paper over by trimming.
    // (The 'all whitespace' branch above is the only short-circuit.)
    const out = buildAiGatewayHeaders(" tok ");
    expect(out).toEqual({ "cf-aig-authorization": "Bearer  tok " });
  });
});
