/**
 * Unit tests for the draft-preview KV storage helpers (issue #268).
 *
 * Covers the round-trip of `upsertDraftPreviewMapping` /
 * `getDraftPreviewMapping` / `deleteDraftPreviewMapping`, including:
 *
 *   - First-create populates the by-slug pointer + the record.
 *   - Update is idempotent and refreshes `updatedAt`.
 *   - Reads validate the stored record and reject corruption.
 *   - Owner email is hashed in the by-slug key (no raw email in keys).
 */

import { describe, it, expect } from "vitest";
import {
  deleteDraftPreviewMapping,
  draftPreviewKey,
  draftPreviewBySlugKey,
  getDraftPreviewMapping,
  getDraftPreviewMappingBySlug,
  hashOwnerForKey,
  upsertDraftPreviewMapping,
  type DraftPreviewStoreEnv,
} from "./draft-previews-store";

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: "json"): Promise<unknown> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    if (type === "json") return JSON.parse(raw);
    return raw;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeEnv(): { env: DraftPreviewStoreEnv; kv: FakeKV } {
  const kv = new FakeKV();
  return { env: { DECKS: kv as unknown as KVNamespace }, kv };
}

const OWNER = "owner@example.test";

describe("draft preview KV keys", () => {
  it("scopes the record key by previewId", () => {
    expect(draftPreviewKey("pv_0123456789abcdef")).toBe(
      "draft-preview:pv_0123456789abcdef",
    );
  });

  it("uses a hashed owner in the by-slug key", async () => {
    const hash = await hashOwnerForKey(OWNER);
    expect(draftPreviewBySlugKey(hash, "hello")).toBe(
      `draft-preview-by-slug:${hash}:hello`,
    );
    // The hash MUST NOT contain the raw email.
    expect(draftPreviewBySlugKey(hash, "hello")).not.toContain(OWNER);
  });
});

describe("hashOwnerForKey", () => {
  it("is deterministic across calls", async () => {
    const a = await hashOwnerForKey(OWNER);
    const b = await hashOwnerForKey(OWNER);
    expect(a).toBe(b);
  });

  it("returns hex characters only", async () => {
    const hash = await hashOwnerForKey(OWNER);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("differs across different owners", async () => {
    const a = await hashOwnerForKey("a@example.test");
    const b = await hashOwnerForKey("b@example.test");
    expect(a).not.toBe(b);
  });

  it("normalises case so equivalent emails hash the same", async () => {
    const a = await hashOwnerForKey("Owner@Example.Test");
    const b = await hashOwnerForKey("owner@example.test");
    expect(a).toBe(b);
  });
});

describe("upsertDraftPreviewMapping", () => {
  it("creates a new mapping, persists the record, and writes the by-slug pointer", async () => {
    const { env, kv } = makeEnv();
    const result = await upsertDraftPreviewMapping(env, {
      ownerEmail: OWNER,
      slug: "hello",
      draftRepoName: "draft-deck-hello-abcd",
      latestCommitSha: "07a3259",
    });

    expect(result.previewId).toMatch(/^pv_[0-9a-f]{16,}$/);
    expect(result.ownerEmail).toBe(OWNER);
    expect(result.slug).toBe("hello");
    expect(result.latestCommitSha).toBe("07a3259");
    expect(result.draftRepoName).toBe("draft-deck-hello-abcd");
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBe(result.createdAt);

    // Record key lookup
    expect(
      JSON.parse(kv.store.get(draftPreviewKey(result.previewId))!),
    ).toEqual(result);

    // By-slug pointer
    const hash = await hashOwnerForKey(OWNER);
    expect(kv.store.get(draftPreviewBySlugKey(hash, "hello"))).toBe(
      result.previewId,
    );
  });

  it("never includes the raw owner email in any KV key", async () => {
    const { env, kv } = makeEnv();
    await upsertDraftPreviewMapping(env, {
      ownerEmail: OWNER,
      slug: "hello",
      draftRepoName: "draft-deck-hello-abcd",
      latestCommitSha: "07a3259",
    });

    for (const key of kv.store.keys()) {
      expect(key).not.toContain(OWNER);
      expect(key.toLowerCase()).not.toContain("example.test");
    }
  });

  it("re-uses an existing previewId for the same owner+slug on update", async () => {
    const { env } = makeEnv();
    const first = await upsertDraftPreviewMapping(env, {
      ownerEmail: OWNER,
      slug: "hello",
      draftRepoName: "draft-deck-hello-abcd",
      latestCommitSha: "07a3259",
    });
    // Wait a microtask so the updatedAt differs (Date.now ticks per ms,
    // but the explicit clock injection below avoids flakiness).
    const second = await upsertDraftPreviewMapping(env, {
      ownerEmail: OWNER,
      slug: "hello",
      draftRepoName: "draft-deck-hello-abcd",
      latestCommitSha: "9e8f0a1",
      now: new Date("2030-01-01T00:00:00.000Z"),
    });

    expect(second.previewId).toBe(first.previewId);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe("2030-01-01T00:00:00.000Z");
    expect(second.latestCommitSha).toBe("9e8f0a1");
  });

  it("rejects an invalid slug", async () => {
    const { env } = makeEnv();
    await expect(
      upsertDraftPreviewMapping(env, {
        ownerEmail: OWNER,
        slug: "Bad Slug",
        draftRepoName: "draft-deck-x",
        latestCommitSha: "07a3259",
      }),
    ).rejects.toThrow(/slug/);
  });

  it("rejects an invalid sha", async () => {
    const { env } = makeEnv();
    await expect(
      upsertDraftPreviewMapping(env, {
        ownerEmail: OWNER,
        slug: "hello",
        draftRepoName: "draft-deck-x",
        latestCommitSha: "short",
      }),
    ).rejects.toThrow(/sha/i);
  });

  it("rejects an empty draftRepoName", async () => {
    const { env } = makeEnv();
    await expect(
      upsertDraftPreviewMapping(env, {
        ownerEmail: OWNER,
        slug: "hello",
        draftRepoName: "",
        latestCommitSha: "07a3259",
      }),
    ).rejects.toThrow(/draftRepoName/);
  });

  it("rejects an empty ownerEmail", async () => {
    const { env } = makeEnv();
    await expect(
      upsertDraftPreviewMapping(env, {
        ownerEmail: "   ",
        slug: "hello",
        draftRepoName: "draft-deck-x",
        latestCommitSha: "07a3259",
      }),
    ).rejects.toThrow(/ownerEmail/);
  });
});

describe("getDraftPreviewMapping", () => {
  it("returns null for an unknown previewId", async () => {
    const { env } = makeEnv();
    expect(await getDraftPreviewMapping(env, "pv_0000000000000000")).toBeNull();
  });

  it("round-trips a created mapping", async () => {
    const { env } = makeEnv();
    const created = await upsertDraftPreviewMapping(env, {
      ownerEmail: OWNER,
      slug: "hello",
      draftRepoName: "draft-deck-hello-abcd",
      latestCommitSha: "07a3259",
    });
    expect(await getDraftPreviewMapping(env, created.previewId)).toEqual(
      created,
    );
  });

  it("treats a corrupted record as missing", async () => {
    const { env, kv } = makeEnv();
    kv.store.set(
      draftPreviewKey("pv_0123456789abcdef"),
      JSON.stringify({ previewId: "nope", broken: true }),
    );
    expect(await getDraftPreviewMapping(env, "pv_0123456789abcdef")).toBeNull();
  });

  it("rejects a syntactically invalid previewId at lookup time", async () => {
    const { env } = makeEnv();
    expect(await getDraftPreviewMapping(env, "not-an-id")).toBeNull();
  });
});

describe("getDraftPreviewMappingBySlug", () => {
  it("returns null when no pointer exists", async () => {
    const { env } = makeEnv();
    expect(
      await getDraftPreviewMappingBySlug(env, OWNER, "hello"),
    ).toBeNull();
  });

  it("returns the mapping when a pointer exists", async () => {
    const { env } = makeEnv();
    const created = await upsertDraftPreviewMapping(env, {
      ownerEmail: OWNER,
      slug: "hello",
      draftRepoName: "draft-deck-hello-abcd",
      latestCommitSha: "07a3259",
    });
    expect(
      await getDraftPreviewMappingBySlug(env, OWNER, "hello"),
    ).toEqual(created);
  });

  it("returns null for a slug owned by a different user", async () => {
    const { env } = makeEnv();
    await upsertDraftPreviewMapping(env, {
      ownerEmail: OWNER,
      slug: "hello",
      draftRepoName: "draft-deck-hello-abcd",
      latestCommitSha: "07a3259",
    });
    expect(
      await getDraftPreviewMappingBySlug(env, "other@example.test", "hello"),
    ).toBeNull();
  });
});

describe("deleteDraftPreviewMapping", () => {
  it("removes the record AND the by-slug pointer", async () => {
    const { env, kv } = makeEnv();
    const created = await upsertDraftPreviewMapping(env, {
      ownerEmail: OWNER,
      slug: "hello",
      draftRepoName: "draft-deck-hello-abcd",
      latestCommitSha: "07a3259",
    });

    await deleteDraftPreviewMapping(env, created.previewId);

    expect(kv.store.size).toBe(0);
    expect(await getDraftPreviewMapping(env, created.previewId)).toBeNull();
    expect(
      await getDraftPreviewMappingBySlug(env, OWNER, "hello"),
    ).toBeNull();
  });

  it("is idempotent for a missing previewId", async () => {
    const { env } = makeEnv();
    await expect(
      deleteDraftPreviewMapping(env, "pv_0000000000000000"),
    ).resolves.toBeUndefined();
  });

  it("ignores syntactically invalid previewIds", async () => {
    const { env } = makeEnv();
    await expect(
      deleteDraftPreviewMapping(env, "not-an-id"),
    ).resolves.toBeUndefined();
  });
});
