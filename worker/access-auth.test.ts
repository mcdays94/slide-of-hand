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
