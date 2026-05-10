import { describe, it, expect } from "vitest";
import { requireAccessAuth, getAccessUserEmail } from "./access-auth";

describe("requireAccessAuth", () => {
  it("returns null when cf-access-authenticated-user-email is set", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: { "cf-access-authenticated-user-email": "test@example.com" },
    });
    expect(requireAccessAuth(req)).toBeNull();
  });

  it("returns 403 when the header is absent", async () => {
    const req = new Request("https://example.com/api/admin/themes/hello");
    const res = requireAccessAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(res!.headers.get("cache-control")).toBe("no-store");
    const body = (await res!.json()) as { error: string };
    expect(body.error).toMatch(/Cloudflare Access/i);
  });

  it("returns 403 when the header is empty string", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: { "cf-access-authenticated-user-email": "" },
    });
    const res = requireAccessAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns 403 when the header is whitespace only", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: { "cf-access-authenticated-user-email": "   " },
    });
    const res = requireAccessAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  // ── Service-token authentication (#131 phase 1 follow-up) ──────────────
  // Service tokens authenticate to Access non-interactively. They don't
  // have a user email, so `requireAccessAuth` accepts the presence of
  // `cf-access-client-id` as an alternative signal.

  it("returns null when only cf-access-client-id is set (service token)", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: { "cf-access-client-id": "abc123.access" },
    });
    expect(requireAccessAuth(req)).toBeNull();
  });

  it("returns null when both email AND client-id are set", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: {
        "cf-access-authenticated-user-email": "user@example.com",
        "cf-access-client-id": "abc123.access",
      },
    });
    expect(requireAccessAuth(req)).toBeNull();
  });

  it("returns 403 when cf-access-client-id is empty string", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: { "cf-access-client-id": "" },
    });
    const res = requireAccessAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns 403 when cf-access-client-id is whitespace only", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: { "cf-access-client-id": "   " },
    });
    const res = requireAccessAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  // ── JWT-assertion authentication (#131 follow-up; verified 2026-05-10) ──
  // Access forwards `cf-access-jwt-assertion` on every validated request
  // (both interactive user and service-token flows). This is the
  // canonical signal — interactive flows ALSO get the email header,
  // service-token flows do NOT, so JWT is what makes service-token
  // requests succeed.

  it("returns null when only cf-access-jwt-assertion is set (service token)", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: {
        "cf-access-jwt-assertion": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.placeholder",
      },
    });
    expect(requireAccessAuth(req)).toBeNull();
  });

  it("returns null when both email AND JWT are set (interactive)", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: {
        "cf-access-authenticated-user-email": "user@example.com",
        "cf-access-jwt-assertion": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.placeholder",
      },
    });
    expect(requireAccessAuth(req)).toBeNull();
  });

  it("returns 403 when cf-access-jwt-assertion is empty", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: { "cf-access-jwt-assertion": "" },
    });
    const res = requireAccessAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns 403 when cf-access-jwt-assertion is whitespace only", () => {
    const req = new Request("https://example.com/api/admin/themes/hello", {
      headers: { "cf-access-jwt-assertion": "   " },
    });
    const res = requireAccessAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});

describe("getAccessUserEmail", () => {
  it("returns the email when present", () => {
    const req = new Request("https://example.com/", {
      headers: { "cf-access-authenticated-user-email": "test@example.com" },
    });
    expect(getAccessUserEmail(req)).toBe("test@example.com");
  });

  it("trims whitespace around the email", () => {
    const req = new Request("https://example.com/", {
      headers: {
        "cf-access-authenticated-user-email": "  test@example.com  ",
      },
    });
    expect(getAccessUserEmail(req)).toBe("test@example.com");
  });

  it("returns null when the header is absent", () => {
    const req = new Request("https://example.com/");
    expect(getAccessUserEmail(req)).toBeNull();
  });

  it("returns null when the header is whitespace only", () => {
    const req = new Request("https://example.com/", {
      headers: { "cf-access-authenticated-user-email": "   " },
    });
    expect(getAccessUserEmail(req)).toBeNull();
  });
});
