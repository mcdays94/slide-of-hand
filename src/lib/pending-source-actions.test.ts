/**
 * Unit tests for the shared pending-source-action validator + helpers
 * (issue #246 / PRD #242).
 *
 * The validator is exercised end-to-end by the worker tests in
 * `worker/pending-source-actions.test.ts`; this file pins down the
 * pure-function contract so the worker tests can focus on the route +
 * KV concerns.
 */

import { describe, it, expect } from "vitest";
import {
  validatePendingSourceAction,
  expectedStateFor,
} from "./pending-source-actions";

const VALID = {
  slug: "hello",
  action: "archive" as const,
  prUrl: "https://github.com/mcdays94/slide-of-hand/pull/123",
  expectedState: "archived" as const,
  createdAt: "2026-05-15T11:23:45.000Z",
};

describe("validatePendingSourceAction", () => {
  it("accepts a valid record", () => {
    const r = validatePendingSourceAction(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(VALID);
  });

  it("accepts queued, running, and failed records without a prUrl", () => {
    for (const status of ["queued", "running", "failed"] as const) {
      const r = validatePendingSourceAction({
        slug: "hello",
        action: "archive",
        status,
        expectedState: "archived",
        createdAt: "2026-05-15T11:23:45.000Z",
        updatedAt: "2026-05-15T11:24:45.000Z",
        ...(status === "failed" ? { error: "Sandbox failed" } : {}),
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.status).toBe(status);
        expect(r.value.prUrl).toBeUndefined();
      }
    }
  });

  it("accepts a pr_open record with a prUrl", () => {
    const r = validatePendingSourceAction({ ...VALID, status: "pr_open" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("pr_open");
  });

  it("accepts legacy no-status records with a prUrl", () => {
    const r = validatePendingSourceAction(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBeUndefined();
      expect(r.value.prUrl).toBe(VALID.prUrl);
    }
  });

  it("rejects non-objects", () => {
    expect(validatePendingSourceAction(null).ok).toBe(false);
    expect(validatePendingSourceAction("foo").ok).toBe(false);
    expect(validatePendingSourceAction(42).ok).toBe(false);
  });

  it("rejects missing / empty slug", () => {
    expect(validatePendingSourceAction({ ...VALID, slug: "" }).ok).toBe(false);
    const { slug: _slug, ...withoutSlug } = VALID;
    expect(validatePendingSourceAction(withoutSlug).ok).toBe(false);
  });

  it("rejects unknown actions", () => {
    expect(
      validatePendingSourceAction({ ...VALID, action: "explode" }).ok,
    ).toBe(false);
  });

  it("rejects non-http(s) prUrl values", () => {
    expect(
      validatePendingSourceAction({
        ...VALID,
        prUrl: "javascript:alert(1)",
      }).ok,
    ).toBe(false);
    expect(
      validatePendingSourceAction({ ...VALID, prUrl: "not a url" }).ok,
    ).toBe(false);
    expect(
      validatePendingSourceAction({
        ...VALID,
        prUrl: "ftp://example.com/foo",
      }).ok,
    ).toBe(false);
  });

  it("rejects pr_open records without a prUrl", () => {
    const { prUrl: _drop, ...withoutPrUrl } = VALID;
    expect(
      validatePendingSourceAction({ ...withoutPrUrl, status: "pr_open" }).ok,
    ).toBe(false);
  });

  it("rejects unknown expectedState values", () => {
    expect(
      validatePendingSourceAction({
        ...VALID,
        expectedState: "pending-cleanup",
      }).ok,
    ).toBe(false);
  });

  it("synthesises createdAt when omitted", () => {
    const { createdAt: _drop, ...without } = VALID;
    const r = validatePendingSourceAction(without);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(typeof r.value.createdAt).toBe("string");
      expect(Number.isFinite(Date.parse(r.value.createdAt))).toBe(true);
    }
  });

  it("rejects a non-parseable createdAt", () => {
    expect(
      validatePendingSourceAction({ ...VALID, createdAt: "not-a-date" }).ok,
    ).toBe(false);
  });
});

describe("expectedStateFor", () => {
  it("maps each action to its terminal state", () => {
    expect(expectedStateFor("archive")).toBe("archived");
    expect(expectedStateFor("restore")).toBe("active");
    expect(expectedStateFor("delete")).toBe("deleted");
  });
});
