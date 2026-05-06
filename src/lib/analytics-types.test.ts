/**
 * Pure-validation tests for the analytics types module. No Worker, no
 * DOM — these are isolated checks on the validator and ID guards so the
 * two consumers (Worker + SPA hook) can rely on them.
 */
import { describe, it, expect } from "vitest";
import {
  EVENT_TYPES,
  isAnalyticsRange,
  isEventType,
  isValidId,
  isValidSessionId,
  validateBeaconBody,
} from "./analytics-types";

const validBody = {
  slug: "hello",
  slideId: "cover",
  eventType: "view" as const,
  sessionId: "11111111-2222-3333-4444-555555555555",
};

describe("isValidId", () => {
  it.each([
    ["hello", true],
    ["hello-world", true],
    ["a", true],
    ["a1b2", true],
    ["", false],
    ["-leading", false],
    ["trailing-", false],
    ["UPPER", false],
    ["with..dots", false],
    ["space here", false],
    ["a".repeat(201), false],
  ])("isValidId(%j) === %s", (input, expected) => {
    expect(isValidId(input)).toBe(expected);
  });
});

describe("isValidSessionId", () => {
  it("accepts a v4 UUID", () => {
    expect(
      isValidSessionId("11111111-2222-3333-4444-555555555555"),
    ).toBe(true);
  });
  it("accepts a short hex string", () => {
    expect(isValidSessionId("abc123")).toBe(true);
  });
  it("rejects empty string", () => {
    expect(isValidSessionId("")).toBe(false);
  });
  it("rejects non-alphanumeric characters", () => {
    expect(isValidSessionId("not-a-session-😀")).toBe(false);
  });

  it("accepts alphanumeric strings (test fixtures)", () => {
    expect(isValidSessionId("test-session-probe-1")).toBe(true);
  });
  it("rejects strings longer than 64 chars", () => {
    expect(isValidSessionId("a".repeat(65))).toBe(false);
  });
});

describe("isEventType", () => {
  it.each(EVENT_TYPES)("accepts %s", (event) => {
    expect(isEventType(event)).toBe(true);
  });
  it("rejects an unknown event", () => {
    expect(isEventType("scroll")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isEventType(42)).toBe(false);
    expect(isEventType(null)).toBe(false);
  });
});

describe("isAnalyticsRange", () => {
  it("accepts 24h / 7d / 30d", () => {
    expect(isAnalyticsRange("24h")).toBe(true);
    expect(isAnalyticsRange("7d")).toBe(true);
    expect(isAnalyticsRange("30d")).toBe(true);
  });
  it("rejects others", () => {
    expect(isAnalyticsRange("90d")).toBe(false);
    expect(isAnalyticsRange("")).toBe(false);
    expect(isAnalyticsRange(7)).toBe(false);
  });
});

describe("validateBeaconBody", () => {
  it("accepts a minimal valid body and defaults numeric fields to 0", () => {
    const out = validateBeaconBody(validBody);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.durationMs).toBe(0);
    expect(out.value.phaseIndex).toBe(0);
    expect(out.value.slug).toBe("hello");
  });

  it("accepts integer durationMs and phaseIndex", () => {
    const out = validateBeaconBody({
      ...validBody,
      durationMs: 1500,
      phaseIndex: 2,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.durationMs).toBe(1500);
    expect(out.value.phaseIndex).toBe(2);
  });

  it.each([
    ["string body", "not an object"],
    ["null body", null],
    ["array body", []],
    ["missing slug", { ...validBody, slug: undefined }],
    ["bad slug", { ...validBody, slug: "WITH SPACES" }],
    ["bad slideId", { ...validBody, slideId: ".." }],
    ["bad eventType", { ...validBody, eventType: "scroll" }],
    ["bad sessionId", { ...validBody, sessionId: "" }],
    ["negative durationMs", { ...validBody, durationMs: -1 }],
    ["non-integer durationMs", { ...validBody, durationMs: 1.5 }],
    ["negative phaseIndex", { ...validBody, phaseIndex: -2 }],
    [
      "huge durationMs",
      { ...validBody, durationMs: 99_999_999_999 },
    ],
  ])("rejects %s", (_, body) => {
    const out = validateBeaconBody(body);
    expect(out.ok).toBe(false);
  });
});
