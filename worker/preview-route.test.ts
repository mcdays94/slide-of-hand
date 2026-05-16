/**
 * Unit tests for the draft-preview route handler (issue #268).
 *
 * Layered semantics covered:
 *
 *   1. Non-preview pathnames → null (fall through to the next handler).
 *   2. No Access auth → 403 (delegated to `requireAccessAuth`).
 *   3. Access via service token / no email → 403 (preview is a
 *      per-user interactive surface).
 *   4. Malformed URL inside `/preview/` → 400 with a generic message.
 *   5. Unknown previewId → 404 (no leak of whether the id ever
 *      existed).
 *   6. Owner mismatch → 403 with a generic message (no leak of
 *      `ownerEmail` or `draftRepoName`).
 *   7. SHA mismatch → 409 with the expected sha, scoped to the
 *      owning user.
 *   8. Valid mapping + matching sha → 501 stub including `previewId`,
 *      `slug`, and requested `path` for debugging — but NOT
 *      `ownerEmail` or `draftRepoName`.
 */

import { describe, it, expect } from "vitest";
import { handlePreview, type PreviewEnv } from "./preview-route";
import {
  upsertDraftPreviewMapping,
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

function makeEnv(): { env: PreviewEnv; kv: FakeKV } {
  const kv = new FakeKV();
  const env: PreviewEnv = {
    ARTIFACTS: {} as Artifacts,
    DECKS: kv as unknown as KVNamespace,
  };
  return { env, kv };
}

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://slideofhand.lusostreams.com${path}`, init);
}

function authed(
  path: string,
  email: string = "owner@example.test",
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", email);
  return req(path, { ...init, headers });
}

function serviceToken(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-access-jwt-assertion", "fake.jwt.assertion");
  return req(path, { ...init, headers });
}

async function seedMapping(env: PreviewEnv) {
  return upsertDraftPreviewMapping(env, {
    ownerEmail: "owner@example.test",
    slug: "hello",
    draftRepoName: "draft-deck-hello-abcd",
    latestCommitSha: "07a3259",
  });
}

describe("handlePreview", () => {
  it("returns null for non-preview paths", async () => {
    const { env } = makeEnv();
    await expect(handlePreview(req("/decks/hello"), env)).resolves.toBeNull();
    await expect(handlePreview(req("/"), env)).resolves.toBeNull();
    await expect(handlePreview(req("/api/admin/foo"), env)).resolves.toBeNull();
  });

  it("rejects unauthenticated requests with 403", async () => {
    const { env } = makeEnv();
    const res = await handlePreview(
      req("/preview/pv_0123456789abcdef/07a3259/index.html"),
      env,
    );
    expect(res?.status).toBe(403);
  });

  it("rejects service-token (no email) requests with 403", async () => {
    const { env } = makeEnv();
    const res = await handlePreview(
      serviceToken("/preview/pv_0123456789abcdef/07a3259/index.html"),
      env,
    );
    expect(res?.status).toBe(403);
    const body = (await res?.json()) as { error: string };
    expect(body.error).toMatch(/interactive/i);
  });

  it("returns 400 for malformed preview URLs", async () => {
    const { env } = makeEnv();
    const malformed = [
      "/preview/",
      "/preview/pv_0123456789abcdef",
      "/preview/pv_0123456789abcdef/07a3259",
      "/preview/not-an-id/07a3259/index.html",
      "/preview/pv_0123456789abcdef/short/index.html",
      "/preview/pv_0123456789abcdef/07a3259/../etc/passwd",
    ];
    for (const path of malformed) {
      const res = await handlePreview(authed(path), env);
      expect(res?.status, `expected 400 for ${path}`).toBe(400);
    }
  });

  it("returns 404 for an unknown previewId", async () => {
    const { env } = makeEnv();
    const res = await handlePreview(
      authed("/preview/pv_0123456789abcdef/07a3259/index.html"),
      env,
    );
    expect(res?.status).toBe(404);
    const body = (await res?.json()) as { error: string };
    // The error message MUST NOT reveal owner email or repo name.
    expect(body.error).not.toMatch(/owner/i);
    expect(body.error).not.toMatch(/draft-deck/i);
  });

  it("returns 403 for an owner mismatch without leaking ownerEmail or draftRepoName", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    const res = await handlePreview(
      authed(
        `/preview/${mapping.previewId}/07a3259/index.html`,
        "intruder@example.test",
      ),
      env,
    );
    expect(res?.status).toBe(403);
    const text = await res?.text();
    expect(text).not.toContain("owner@example.test");
    expect(text).not.toContain("draft-deck-hello-abcd");
  });

  it("returns 409 for a sha mismatch with the latest known sha", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    const res = await handlePreview(
      authed(`/preview/${mapping.previewId}/deadbee/index.html`),
      env,
    );
    expect(res?.status).toBe(409);
    const body = (await res?.json()) as {
      error: string;
      expectedSha: string;
      requestedSha: string;
    };
    expect(body.expectedSha).toBe("07a3259");
    expect(body.requestedSha).toBe("deadbee");
    // Must not leak owner/repo metadata.
    expect(JSON.stringify(body)).not.toContain("owner@example.test");
    expect(JSON.stringify(body)).not.toContain("draft-deck-hello-abcd");
  });

  it("returns 501 stub including previewId, slug, and path on a valid hit", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    const res = await handlePreview(
      authed(`/preview/${mapping.previewId}/07a3259/index.html`),
      env,
    );
    expect(res?.status).toBe(501);
    const body = (await res?.json()) as {
      ok: boolean;
      error: string;
      previewId: string;
      slug: string;
      path: string;
      sha: string;
    };
    expect(body.ok).toBe(false);
    expect(body.previewId).toBe(mapping.previewId);
    expect(body.slug).toBe("hello");
    expect(body.path).toBe("index.html");
    expect(body.sha).toBe("07a3259");
    // Must NOT leak owner/repo metadata.
    expect(JSON.stringify(body)).not.toContain("owner@example.test");
    expect(JSON.stringify(body)).not.toContain("draft-deck-hello-abcd");
  });

  it("returns 501 stub for nested asset paths on a valid hit", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    const res = await handlePreview(
      authed(`/preview/${mapping.previewId}/07a3259/assets/index-XYZ.js`),
      env,
    );
    expect(res?.status).toBe(501);
    const body = (await res?.json()) as { path: string };
    expect(body.path).toBe("assets/index-XYZ.js");
  });

  it("keeps preview responses no-store", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    const res = await handlePreview(
      authed(`/preview/${mapping.previewId}/07a3259/index.html`),
      env,
    );
    expect(res?.headers.get("cache-control")).toBe("no-store");
  });
});
