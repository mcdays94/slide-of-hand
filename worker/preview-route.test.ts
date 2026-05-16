/**
 * Unit tests for the draft-preview route handler.
 *
 * Layered semantics covered (auth + mapping gates from #268, then the
 * R2-backed bundle serving added in #278):
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
 *   8. Valid mapping + matching sha + R2 object present → 200 with
 *      the object body and the `contentType` / `cacheControl` the
 *      bundle-put-time policy stamped onto R2's httpMetadata.
 *   9. Valid mapping + matching sha + missing R2 object → 404 with
 *      a generic message (must NOT leak `ownerEmail` or
 *      `draftRepoName`).
 *  10. `/preview/<id>/<sha>/` (trailing slash, no path) serves
 *      `index.html` from the bundle.
 */

import { describe, it, expect } from "vitest";
import { handlePreview, type PreviewEnv } from "./preview-route";
import {
  upsertDraftPreviewMapping,
} from "./draft-previews-store";
import { putPreviewBundleObject } from "./preview-bundles";

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

/**
 * Minimal in-memory R2 stand-in. The bundle helpers in
 * `worker/preview-bundles.ts` only use `put`, `get`, `delete`, and
 * `list` — this fake covers the subset the route exercises (put +
 * get). A separate test file (`worker/preview-bundles.test.ts`) covers
 * the helpers themselves more thoroughly.
 */
interface FakeR2Object {
  key: string;
  body: ArrayBuffer;
  httpMetadata: { contentType?: string; cacheControl?: string };
}

class FakeR2 {
  store = new Map<string, FakeR2Object>();

  async get(key: string): Promise<unknown> {
    const obj = this.store.get(key);
    if (!obj) return null;
    const bytes = new Uint8Array(obj.body);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return { ...obj, body };
  }

  async put(
    key: string,
    body: ArrayBuffer | Uint8Array | string,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
    },
  ): Promise<FakeR2Object> {
    let buffer: ArrayBuffer;
    if (body instanceof ArrayBuffer) {
      buffer = body;
    } else if (body instanceof Uint8Array) {
      buffer = body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer;
    } else {
      buffer = new TextEncoder().encode(body).buffer as ArrayBuffer;
    }
    const obj: FakeR2Object = {
      key,
      body: buffer,
      httpMetadata: options?.httpMetadata ?? {},
    };
    this.store.set(key, obj);
    return obj;
  }
}

function makeEnv(): { env: PreviewEnv; kv: FakeKV; r2: FakeR2 } {
  const kv = new FakeKV();
  const r2 = new FakeR2();
  const env: PreviewEnv = {
    ARTIFACTS: {} as Artifacts,
    DECKS: kv as unknown as KVNamespace,
    PREVIEW_BUNDLES: r2 as unknown as R2Bucket,
  };
  return { env, kv, r2 };
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
      "/preview/not-an-id/07a3259/index.html",
      "/preview/pv_0123456789abcdef/short/index.html",
      "/preview/pv_0123456789abcdef/07a3259/../etc/passwd",
    ];
    for (const path of malformed) {
      const res = await handlePreview(authed(path), env);
      expect(res?.status, `expected 400 for ${path}`).toBe(400);
    }
  });

  it("rejects malformed URLs before reading R2 (defence-in-depth)", async () => {
    // The route's path-traversal defence lives in `parsePreviewRoute`
    // (see `src/lib/draft-previews.test.ts`). Note that the URL
    // constructor itself collapses `..` segments at request-parse
    // time, so the most direct way to exercise the "no R2 read on a
    // malformed URL" guarantee is to use a URL shape the URL
    // constructor leaves alone but the parser rejects (here: an
    // invalid sha). We assert no R2 read occurs by tracking access
    // on the fake bucket.
    const { env, r2 } = makeEnv();
    await seedMapping(env);
    let r2Reads = 0;
    const origGet = r2.get.bind(r2);
    r2.get = async (key: string) => {
      r2Reads += 1;
      return origGet(key);
    };
    const res = await handlePreview(
      authed("/preview/pv_0123456789abcdef/short/index.html"),
      env,
    );
    expect(res?.status).toBe(400);
    expect(r2Reads).toBe(0);
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

  it("serves index.html from R2 with text/html + no-store on a valid hit", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    await putPreviewBundleObject(env, {
      previewId: mapping.previewId,
      sha: "07a3259",
      path: "index.html",
      body: "<!doctype html><html><body>hello</body></html>",
    });
    const res = await handlePreview(
      authed(`/preview/${mapping.previewId}/07a3259/index.html`),
      env,
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(res?.headers.get("cache-control")).toBe("no-store");
    const text = await res?.text();
    expect(text).toContain("<!doctype html>");
  });

  it("maps a trailing-slash request to index.html", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    await putPreviewBundleObject(env, {
      previewId: mapping.previewId,
      sha: "07a3259",
      path: "index.html",
      body: "<!doctype html><html></html>",
    });
    const res = await handlePreview(
      authed(`/preview/${mapping.previewId}/07a3259/`),
      env,
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(res?.headers.get("cache-control")).toBe("no-store");
    const text = await res?.text();
    expect(text).toContain("<!doctype html>");
  });

  it("serves nested asset paths with the stamped content-type + cache-control", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    await putPreviewBundleObject(env, {
      previewId: mapping.previewId,
      sha: "07a3259",
      path: "assets/index-DXq8Sx0t.js",
      body: "console.log('hi');",
    });
    const res = await handlePreview(
      authed(
        `/preview/${mapping.previewId}/07a3259/assets/index-DXq8Sx0t.js`,
      ),
      env,
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe(
      "application/javascript; charset=utf-8",
    );
    expect(res?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const text = await res?.text();
    expect(text).toBe("console.log('hi');");
  });

  it("returns 404 for a missing R2 object without leaking owner/repo metadata", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    // Note: no `putPreviewBundleObject` — R2 is empty.
    const res = await handlePreview(
      authed(`/preview/${mapping.previewId}/07a3259/missing.html`),
      env,
    );
    expect(res?.status).toBe(404);
    const text = await res?.text();
    expect(text).not.toContain("owner@example.test");
    expect(text).not.toContain("draft-deck-hello-abcd");
  });

  it("response body does not contain ownerEmail or draftRepoName on a hit", async () => {
    const { env } = makeEnv();
    const mapping = await seedMapping(env);
    await putPreviewBundleObject(env, {
      previewId: mapping.previewId,
      sha: "07a3259",
      path: "index.html",
      body: "<!doctype html><html></html>",
    });
    const res = await handlePreview(
      authed(`/preview/${mapping.previewId}/07a3259/index.html`),
      env,
    );
    const text = await res?.text();
    expect(text).not.toContain("owner@example.test");
    expect(text).not.toContain("draft-deck-hello-abcd");
    // And no leaky headers either.
    const allHeaders = JSON.stringify(
      Object.fromEntries(res!.headers.entries()),
    );
    expect(allHeaders).not.toContain("owner@example.test");
    expect(allHeaders).not.toContain("draft-deck-hello-abcd");
  });
});
