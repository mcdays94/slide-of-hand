/**
 * Unit tests for the preview-bundle storage helpers.
 *
 * Mirrors the FakeR2 pattern from `worker/images.test.ts` and extends
 * it with `list()` support so we can exercise `deletePreviewBundlePrefix`
 * end-to-end. The harness deliberately does NOT use vitest-pool-workers
 * — the helpers are pure functions over an R2Bucket-shaped binding and
 * the in-memory mock is sufficient.
 */
import { describe, it, expect } from "vitest";
import {
  previewBundleObjectKey,
  previewBundlePrefix,
  sanitizePreviewBundlePath,
  inferPreviewContentType,
  previewBundleCacheControl,
  putPreviewBundleObject,
  getPreviewBundleObject,
  deletePreviewBundlePrefix,
  type PreviewBundlesEnv,
} from "./preview-bundles";

interface FakeR2Object {
  key: string;
  body: ArrayBuffer;
  httpMetadata: { contentType?: string; cacheControl?: string };
  customMetadata: Record<string, string>;
  size: number;
}

class FakeR2 {
  store = new Map<string, FakeR2Object>();

  async head(key: string): Promise<FakeR2Object | null> {
    return this.store.get(key) ?? null;
  }

  async get(
    key: string,
  ): Promise<
    | (FakeR2Object & { body: ReadableStream<Uint8Array> | ArrayBuffer })
    | null
  > {
    const obj = this.store.get(key);
    if (!obj) return null;
    const bytes = new Uint8Array(obj.body);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return { ...obj, body } as unknown as FakeR2Object & {
      body: ReadableStream<Uint8Array>;
    };
  }

  async put(
    key: string,
    body: ArrayBuffer | Uint8Array | string,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
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
      customMetadata: options?.customMetadata ?? {},
      size: buffer.byteLength,
    };
    this.store.set(key, obj);
    return obj;
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) this.store.delete(k);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes: string[];
  }> {
    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 1000;
    const allKeys = [...this.store.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort();
    const startIndex = options?.cursor
      ? allKeys.findIndex((k) => k > options.cursor!)
      : 0;
    const offset = startIndex < 0 ? allKeys.length : startIndex;
    const slice = allKeys.slice(offset, offset + limit);
    const truncated = offset + limit < allKeys.length;
    return {
      objects: slice.map((k) => ({ key: k })),
      truncated,
      cursor: truncated ? slice[slice.length - 1] : undefined,
      delimitedPrefixes: [],
    };
  }
}

function makeEnv(): { env: PreviewBundlesEnv; r2: FakeR2 } {
  const r2 = new FakeR2();
  return {
    env: { PREVIEW_BUNDLES: r2 as unknown as R2Bucket },
    r2,
  };
}

const VALID_ID = "pv_0123456789abcdef";
const VALID_SHA = "07a3259abcdef01";

// ---------------------------------------------------------------- //
// Key + prefix helpers
// ---------------------------------------------------------------- //

describe("previewBundlePrefix / previewBundleObjectKey", () => {
  it("produces a stable prefix under preview-bundles/<id>/<sha>/", () => {
    expect(previewBundlePrefix({ previewId: VALID_ID, sha: VALID_SHA })).toBe(
      `preview-bundles/${VALID_ID}/${VALID_SHA}/`,
    );
  });

  it("joins prefix + sanitized path", () => {
    expect(
      previewBundleObjectKey({
        previewId: VALID_ID,
        sha: VALID_SHA,
        path: "index.html",
      }),
    ).toBe(`preview-bundles/${VALID_ID}/${VALID_SHA}/index.html`);

    expect(
      previewBundleObjectKey({
        previewId: VALID_ID,
        sha: VALID_SHA,
        path: "assets/index-DXq8Sx0t.js",
      }),
    ).toBe(
      `preview-bundles/${VALID_ID}/${VALID_SHA}/assets/index-DXq8Sx0t.js`,
    );
  });

  it("rejects invalid previewId / sha at key-build time", () => {
    expect(() =>
      previewBundleObjectKey({
        previewId: "not-a-pv-id",
        sha: VALID_SHA,
        path: "index.html",
      }),
    ).toThrow(/previewId/);

    expect(() =>
      previewBundleObjectKey({
        previewId: VALID_ID,
        sha: "ZZZ",
        path: "index.html",
      }),
    ).toThrow(/sha/);
  });
});

// ---------------------------------------------------------------- //
// Path sanitization
// ---------------------------------------------------------------- //

describe("sanitizePreviewBundlePath", () => {
  it("returns the input verbatim for benign relative paths", () => {
    expect(sanitizePreviewBundlePath("index.html")).toBe("index.html");
    expect(sanitizePreviewBundlePath("assets/index-DXq8Sx0t.js")).toBe(
      "assets/index-DXq8Sx0t.js",
    );
    expect(sanitizePreviewBundlePath("nested/dir/file.svg")).toBe(
      "nested/dir/file.svg",
    );
  });

  it("rejects empty paths", () => {
    expect(() => sanitizePreviewBundlePath("")).toThrow(/empty/);
  });

  it("rejects absolute paths", () => {
    expect(() => sanitizePreviewBundlePath("/index.html")).toThrow(/absolute/);
  });

  it("rejects path traversal segments", () => {
    expect(() => sanitizePreviewBundlePath("..")).toThrow(/traversal/);
    expect(() => sanitizePreviewBundlePath("../etc/passwd")).toThrow(
      /traversal/,
    );
    expect(() => sanitizePreviewBundlePath("assets/../secret")).toThrow(
      /traversal/,
    );
    expect(() => sanitizePreviewBundlePath("./index.html")).toThrow(
      /traversal/,
    );
    expect(() => sanitizePreviewBundlePath("foo/./bar")).toThrow(/traversal/);
  });

  it("rejects empty segments (double slash)", () => {
    expect(() => sanitizePreviewBundlePath("foo//bar")).toThrow(/empty/);
    expect(() => sanitizePreviewBundlePath("foo/")).toThrow(/empty/);
  });

  it("rejects control characters", () => {
    expect(() => sanitizePreviewBundlePath("foo\x00bar")).toThrow(/control/);
    expect(() => sanitizePreviewBundlePath("foo\nbar")).toThrow(/control/);
    expect(() => sanitizePreviewBundlePath("foo\rbar")).toThrow(/control/);
    expect(() => sanitizePreviewBundlePath("foo\tbar")).toThrow(/control/);
  });

  it("rejects backslashes (windows-style separators)", () => {
    expect(() => sanitizePreviewBundlePath("foo\\bar")).toThrow();
  });
});

// ---------------------------------------------------------------- //
// Content-type inference
// ---------------------------------------------------------------- //

describe("inferPreviewContentType", () => {
  it.each<[string, string]>([
    ["index.html", "text/html; charset=utf-8"],
    ["foo.htm", "text/html; charset=utf-8"],
    ["assets/index-XYZ.js", "application/javascript; charset=utf-8"],
    ["assets/index-XYZ.mjs", "application/javascript; charset=utf-8"],
    ["assets/index-XYZ.css", "text/css; charset=utf-8"],
    ["logo.svg", "image/svg+xml"],
    ["img.png", "image/png"],
    ["img.jpg", "image/jpeg"],
    ["img.jpeg", "image/jpeg"],
    ["img.webp", "image/webp"],
    ["img.gif", "image/gif"],
    ["foo.json", "application/json; charset=utf-8"],
    ["nothing", "application/octet-stream"],
    ["foo.unknownext", "application/octet-stream"],
  ])("infers %s -> %s", (path, expected) => {
    expect(inferPreviewContentType(path)).toBe(expected);
  });

  it("is case-insensitive on the extension", () => {
    expect(inferPreviewContentType("logo.SVG")).toBe("image/svg+xml");
    expect(inferPreviewContentType("foo.HTML")).toBe(
      "text/html; charset=utf-8",
    );
  });
});

// ---------------------------------------------------------------- //
// Cache-control policy
// ---------------------------------------------------------------- //

describe("previewBundleCacheControl", () => {
  it("marks index.html no-store", () => {
    expect(previewBundleCacheControl("index.html")).toBe("no-store");
  });

  it("marks any *.html no-store", () => {
    expect(previewBundleCacheControl("nested/page.html")).toBe("no-store");
    expect(previewBundleCacheControl("FOO.HTML")).toBe("no-store");
  });

  it("marks hashed assets under assets/ as long-lived immutable", () => {
    expect(previewBundleCacheControl("assets/index-DXq8Sx0t.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(previewBundleCacheControl("assets/vendor-abc12345.css")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(previewBundleCacheControl("assets/icon-deadbeef.svg")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("marks non-hashed files (even under assets/) conservatively", () => {
    // No hash fragment → can't safely long-cache.
    expect(previewBundleCacheControl("assets/index.js")).toBe("no-store");
    expect(previewBundleCacheControl("favicon.ico")).toBe("no-store");
    expect(previewBundleCacheControl("robots.txt")).toBe("no-store");
  });

  it("marks files outside assets/ conservatively even if they look hashed", () => {
    // Hash convention is tied to the `assets/` Vite output dir; a
    // hash-looking name elsewhere is not a contract we control.
    expect(previewBundleCacheControl("foo-DXq8Sx0t.js")).toBe("no-store");
  });
});

// ---------------------------------------------------------------- //
// put / get / delete primitives
// ---------------------------------------------------------------- //

describe("putPreviewBundleObject + getPreviewBundleObject", () => {
  it("writes body + inferred content-type + cache-control metadata", async () => {
    const { env, r2 } = makeEnv();
    await putPreviewBundleObject(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
      path: "index.html",
      body: "<!doctype html><html></html>",
    });
    const stored = r2.store.get(
      `preview-bundles/${VALID_ID}/${VALID_SHA}/index.html`,
    );
    expect(stored).toBeTruthy();
    expect(stored!.httpMetadata.contentType).toBe(
      "text/html; charset=utf-8",
    );
    expect(stored!.httpMetadata.cacheControl).toBe("no-store");
    expect(new TextDecoder().decode(stored!.body)).toContain("<!doctype html>");
  });

  it("respects an explicit contentType override", async () => {
    const { env, r2 } = makeEnv();
    await putPreviewBundleObject(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
      path: "assets/index-DXq8Sx0t.js",
      body: "console.log('hi');",
      contentType: "application/javascript; charset=utf-8",
    });
    const stored = r2.store.get(
      `preview-bundles/${VALID_ID}/${VALID_SHA}/assets/index-DXq8Sx0t.js`,
    );
    expect(stored!.httpMetadata.contentType).toBe(
      "application/javascript; charset=utf-8",
    );
    expect(stored!.httpMetadata.cacheControl).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("rejects path-traversal at put time", async () => {
    const { env, r2 } = makeEnv();
    await expect(
      putPreviewBundleObject(env, {
        previewId: VALID_ID,
        sha: VALID_SHA,
        path: "../escape",
        body: "x",
      }),
    ).rejects.toThrow(/traversal/);
    expect(r2.store.size).toBe(0);
  });

  it("getPreviewBundleObject returns the stored body + httpMetadata", async () => {
    const { env } = makeEnv();
    await putPreviewBundleObject(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
      path: "assets/style-deadbeef.css",
      body: "body{}",
    });
    const obj = await getPreviewBundleObject(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
      path: "assets/style-deadbeef.css",
    });
    expect(obj).not.toBeNull();
    // The fake R2 returns the body as a ReadableStream — read it back.
    const reader = (obj!.body as ReadableStream<Uint8Array>).getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value!)).toBe("body{}");
    expect(obj!.httpMetadata?.contentType).toBe("text/css; charset=utf-8");
  });

  it("getPreviewBundleObject returns null for a missing object", async () => {
    const { env } = makeEnv();
    const obj = await getPreviewBundleObject(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
      path: "missing.html",
    });
    expect(obj).toBeNull();
  });
});

describe("deletePreviewBundlePrefix", () => {
  it("removes every object under the given previewId/sha and reports the count", async () => {
    const { env, r2 } = makeEnv();
    await putPreviewBundleObject(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
      path: "index.html",
      body: "x",
    });
    await putPreviewBundleObject(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
      path: "assets/index-DXq8Sx0t.js",
      body: "y",
    });
    await putPreviewBundleObject(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
      path: "assets/style-deadbeef.css",
      body: "z",
    });
    // Sibling sha under the same previewId — must NOT be touched.
    await putPreviewBundleObject(env, {
      previewId: VALID_ID,
      sha: "0badf00d",
      path: "index.html",
      body: "sibling",
    });
    expect(r2.store.size).toBe(4);

    const result = await deletePreviewBundlePrefix(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
    });
    expect(result.deleted).toBe(3);
    expect(r2.store.size).toBe(1);
    // The sibling sha's object survives.
    expect(
      r2.store.has(`preview-bundles/${VALID_ID}/0badf00d/index.html`),
    ).toBe(true);
  });

  it("is a no-op (deleted=0) when the prefix has no objects", async () => {
    const { env } = makeEnv();
    const result = await deletePreviewBundlePrefix(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
    });
    expect(result.deleted).toBe(0);
  });

  it("paginates through more than one R2 list page", async () => {
    const { env, r2 } = makeEnv();
    // Write 250 files; the helper requests pages of 100 internally and
    // must keep going until the listing is exhausted.
    for (let i = 0; i < 250; i++) {
      await putPreviewBundleObject(env, {
        previewId: VALID_ID,
        sha: VALID_SHA,
        path: `assets/chunk-${i.toString().padStart(5, "0")}.js`,
        body: "x",
      });
    }
    expect(r2.store.size).toBe(250);
    const result = await deletePreviewBundlePrefix(env, {
      previewId: VALID_ID,
      sha: VALID_SHA,
    });
    expect(result.deleted).toBe(250);
    expect(r2.store.size).toBe(0);
  });
});
