/**
 * Unit tests for `adminWriteHeaders` — the shared dev-auth header
 * injection helper. Mirrors the behaviour-shape of the inline
 * `adminWriteHeaders()` in `useElementOverrides.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { adminWriteHeaders } from "./admin-fetch";

const ORIGINAL_HOSTNAME = window.location.hostname;

function setHostname(value: string) {
  Object.defineProperty(window.location, "hostname", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  setHostname(ORIGINAL_HOSTNAME);
});

describe("adminWriteHeaders", () => {
  it("always sets content-type to application/json", () => {
    const headers = adminWriteHeaders();
    expect(headers["content-type"]).toBe("application/json");
  });

  it("injects dev-auth header on localhost", () => {
    setHostname("localhost");
    const headers = adminWriteHeaders();
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
  });

  it("injects dev-auth header on 127.0.0.1", () => {
    setHostname("127.0.0.1");
    const headers = adminWriteHeaders();
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
  });

  it("injects dev-auth header on portless *.localhost", () => {
    setHostname("slide-of-hand.localhost");
    const headers = adminWriteHeaders();
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
  });

  it("does not inject dev-auth header on a real production hostname", () => {
    setHostname("slideofhand.lusostreams.com");
    const headers = adminWriteHeaders();
    expect(headers["cf-access-authenticated-user-email"]).toBeUndefined();
  });

  it("merges in extra headers without overwriting content-type", () => {
    setHostname("localhost");
    const headers = adminWriteHeaders({ "x-foo": "bar" });
    expect(headers["x-foo"]).toBe("bar");
    expect(headers["content-type"]).toBe("application/json");
  });
});
