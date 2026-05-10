/**
 * Tests for the /api/admin/auth-status endpoint (issue #120).
 *
 * The endpoint is a lightweight Access-status probe used by the SPA
 * client to gate speaker-notes editing. It sits behind Access at the
 * /api/admin/* path — when reached by an authenticated browser, Access
 * adds `cf-access-authenticated-user-email` and the Worker returns
 * `{ authenticated: true, email }`. When unauthenticated, Access
 * intercepts before the Worker, but the Worker enforces the same
 * `requireAccessAuth()` defense-in-depth that the rest of the admin
 * API uses.
 */
import { describe, expect, it } from "vitest";
import { handleAuthStatus } from "./auth-status";

const env = {};

describe("worker /api/admin/auth-status (issue #120)", () => {
  it("returns 200 + JSON when the access email header is present", async () => {
    const req = new Request("https://example.com/api/admin/auth-status", {
      method: "GET",
      headers: {
        "cf-access-authenticated-user-email": "alice@cloudflare.com",
      },
    });
    const resp = await handleAuthStatus(req, env);
    expect(resp).not.toBeNull();
    expect(resp?.status).toBe(200);
    expect(resp?.headers.get("content-type")).toContain("application/json");
    expect(resp?.headers.get("cache-control")).toBe("no-store");
    const body = (await resp!.json()) as {
      authenticated: boolean;
      email: string | null;
    };
    expect(body).toEqual({ authenticated: true, email: "alice@cloudflare.com" });
  });

  it("returns 403 when the access email header is absent (defense-in-depth)", async () => {
    const req = new Request("https://example.com/api/admin/auth-status", {
      method: "GET",
    });
    const resp = await handleAuthStatus(req, env);
    expect(resp).not.toBeNull();
    expect(resp?.status).toBe(403);
  });

  it("returns 403 when the access email header is empty", async () => {
    const req = new Request("https://example.com/api/admin/auth-status", {
      method: "GET",
      headers: { "cf-access-authenticated-user-email": "  " },
    });
    const resp = await handleAuthStatus(req, env);
    expect(resp?.status).toBe(403);
  });

  it("returns 405 Method Not Allowed for non-GET", async () => {
    const req = new Request("https://example.com/api/admin/auth-status", {
      method: "POST",
      headers: {
        "cf-access-authenticated-user-email": "alice@cloudflare.com",
      },
    });
    const resp = await handleAuthStatus(req, env);
    expect(resp?.status).toBe(405);
    expect(resp?.headers.get("allow")).toBe("GET");
  });

  it("returns null (passes through to other handlers) for a non-matching path", async () => {
    const req = new Request("https://example.com/api/admin/decks", {
      method: "GET",
      headers: {
        "cf-access-authenticated-user-email": "alice@cloudflare.com",
      },
    });
    const resp = await handleAuthStatus(req, env);
    expect(resp).toBeNull();
  });

  it("returns null for the SPA root", async () => {
    const req = new Request("https://example.com/", { method: "GET" });
    const resp = await handleAuthStatus(req, env);
    expect(resp).toBeNull();
  });
});
