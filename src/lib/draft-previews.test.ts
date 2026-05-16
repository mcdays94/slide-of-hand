/**
 * Unit tests for the shared draft-preview contract (issue #268).
 *
 * Covers:
 *   - Opaque `previewId` validity rules (`pv_<16+ lowercase hex>`).
 *   - Route parser for `/preview/<previewId>/<sha>/<path...>`.
 *   - Wire-shape validator for `DraftPreviewMapping` records.
 *   - `generatePreviewId()` returns a syntactically valid id.
 */

import { describe, it, expect } from "vitest";
import {
  generatePreviewId,
  isValidPreviewId,
  isValidPreviewSha,
  parsePreviewRoute,
  validateDraftPreviewMapping,
} from "./draft-previews";

describe("isValidPreviewId", () => {
  it("accepts a canonical pv_<16-hex> id", () => {
    expect(isValidPreviewId("pv_0123456789abcdef")).toBe(true);
  });

  it("accepts longer hex ids", () => {
    expect(isValidPreviewId("pv_0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("rejects ids without the pv_ prefix", () => {
    expect(isValidPreviewId("0123456789abcdef")).toBe(false);
    expect(isValidPreviewId("pp_0123456789abcdef")).toBe(false);
  });

  it("rejects uppercase or non-hex characters", () => {
    expect(isValidPreviewId("pv_0123456789ABCDEF")).toBe(false);
    expect(isValidPreviewId("pv_0123456789abcdez")).toBe(false);
  });

  it("rejects ids that are too short", () => {
    expect(isValidPreviewId("pv_short")).toBe(false);
    expect(isValidPreviewId("pv_")).toBe(false);
  });

  it("rejects empty / non-string inputs", () => {
    expect(isValidPreviewId("")).toBe(false);
    expect(isValidPreviewId("pv_../etc/passwd")).toBe(false);
  });
});

describe("isValidPreviewSha", () => {
  it("accepts 7-char short SHAs", () => {
    expect(isValidPreviewSha("07a3259")).toBe(true);
  });

  it("accepts full 40-char SHAs", () => {
    expect(isValidPreviewSha("a".repeat(40))).toBe(true);
  });

  it("rejects shorter than 7", () => {
    expect(isValidPreviewSha("07a325")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidPreviewSha("07a325g")).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(isValidPreviewSha("07A3259")).toBe(false);
  });

  it("rejects empty", () => {
    expect(isValidPreviewSha("")).toBe(false);
  });
});

describe("parsePreviewRoute", () => {
  it("parses a canonical index.html request", () => {
    const result = parsePreviewRoute(
      "/preview/pv_0123456789abcdef/07a3259/index.html",
    );
    expect(result).toEqual({
      ok: true,
      previewId: "pv_0123456789abcdef",
      sha: "07a3259",
      path: "index.html",
    });
  });

  it("parses nested asset paths", () => {
    const result = parsePreviewRoute(
      "/preview/pv_0123456789abcdef/07a3259/assets/index-XYZ.js",
    );
    expect(result).toEqual({
      ok: true,
      previewId: "pv_0123456789abcdef",
      sha: "07a3259",
      path: "assets/index-XYZ.js",
    });
  });

  it("returns notPreview for paths outside /preview/", () => {
    const result = parsePreviewRoute("/decks/hello");
    expect(result).toEqual({ ok: false, reason: "not-preview" });
  });

  it("returns malformed for /preview/ with no id", () => {
    expect(parsePreviewRoute("/preview/")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("returns malformed for /preview/<id> with no sha", () => {
    expect(parsePreviewRoute("/preview/pv_0123456789abcdef")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("returns malformed for /preview/<id>/<sha> with no path", () => {
    expect(
      parsePreviewRoute("/preview/pv_0123456789abcdef/07a3259"),
    ).toEqual({ ok: false, reason: "malformed" });
    expect(
      parsePreviewRoute("/preview/pv_0123456789abcdef/07a3259/"),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("returns malformed for an invalid previewId", () => {
    expect(
      parsePreviewRoute("/preview/not-a-preview-id/07a3259/index.html"),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("returns malformed for an invalid sha", () => {
    expect(
      parsePreviewRoute("/preview/pv_0123456789abcdef/short/index.html"),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects path-traversal segments", () => {
    expect(
      parsePreviewRoute(
        "/preview/pv_0123456789abcdef/07a3259/../etc/passwd",
      ),
    ).toEqual({ ok: false, reason: "malformed" });
    expect(
      parsePreviewRoute(
        "/preview/pv_0123456789abcdef/07a3259/foo/../bar",
      ),
    ).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("generatePreviewId", () => {
  it("returns a syntactically valid previewId", () => {
    const id = generatePreviewId();
    expect(isValidPreviewId(id)).toBe(true);
  });

  it("returns unique ids across calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 32; i += 1) ids.add(generatePreviewId());
    expect(ids.size).toBe(32);
  });
});

describe("validateDraftPreviewMapping", () => {
  const validRecord = {
    previewId: "pv_0123456789abcdef",
    ownerEmail: "owner@example.test",
    draftRepoName: "draft-deck-some-slug-abcd1234",
    slug: "some-slug",
    latestCommitSha: "07a3259",
    createdAt: "2026-05-16T10:00:00.000Z",
    updatedAt: "2026-05-16T10:00:00.000Z",
  };

  it("accepts a canonical record", () => {
    const result = validateDraftPreviewMapping(validRecord);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(validRecord);
  });

  it("rejects non-object inputs", () => {
    expect(validateDraftPreviewMapping(null).ok).toBe(false);
    expect(validateDraftPreviewMapping("nope").ok).toBe(false);
    expect(validateDraftPreviewMapping(42).ok).toBe(false);
  });

  it("rejects an invalid previewId", () => {
    expect(
      validateDraftPreviewMapping({ ...validRecord, previewId: "nope" }).ok,
    ).toBe(false);
  });

  it("rejects an empty ownerEmail", () => {
    expect(
      validateDraftPreviewMapping({ ...validRecord, ownerEmail: "" }).ok,
    ).toBe(false);
    expect(
      validateDraftPreviewMapping({
        ...validRecord,
        ownerEmail: 42 as unknown as string,
      }).ok,
    ).toBe(false);
  });

  it("rejects an invalid slug", () => {
    expect(
      validateDraftPreviewMapping({ ...validRecord, slug: "Has Spaces" }).ok,
    ).toBe(false);
  });

  it("rejects an invalid latestCommitSha", () => {
    expect(
      validateDraftPreviewMapping({
        ...validRecord,
        latestCommitSha: "short",
      }).ok,
    ).toBe(false);
  });

  it("rejects a missing draftRepoName", () => {
    const r = { ...validRecord } as Record<string, unknown>;
    delete r.draftRepoName;
    expect(validateDraftPreviewMapping(r).ok).toBe(false);
  });

  it("rejects an unparseable timestamp", () => {
    expect(
      validateDraftPreviewMapping({ ...validRecord, createdAt: "not-a-date" })
        .ok,
    ).toBe(false);
  });
});
