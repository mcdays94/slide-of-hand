/**
 * Unit tests for the images API handlers.
 *
 * R2 + KV are both mocked with tiny in-memory stubs. The handler doesn't
 * exercise eventual consistency or range reads — a deterministic Map-
 * backed mock is sufficient. (We're the first module in the repo to
 * touch R2; the pattern here mirrors the FakeKV used in
 * `worker/themes.test.ts` and `worker/element-overrides.test.ts`.)
 */
import { describe, it, expect } from "vitest";
import {
  handleImages,
  type ImagesEnv,
  type ImageRecord,
} from "./images";

/**
 * Construct a Request with the `cf-access-authenticated-user-email`
 * header already set, simulating a request that has cleared Cloudflare
 * Access. Used for admin-endpoint tests.
 */
function adminRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", "test@example.com");
  return new Request(input, { ...init, headers });
}

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

interface FakeR2Object {
  key: string;
  body: ArrayBuffer;
  httpMetadata: { contentType?: string };
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
    // Return a fresh ReadableStream on .body so the response can stream it.
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
    options?: { httpMetadata?: { contentType?: string } },
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
      size: buffer.byteLength,
    };
    this.store.set(key, obj);
    return obj;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeEnv(): { env: ImagesEnv; r2: FakeR2; kv: FakeKV } {
  const r2 = new FakeR2();
  const kv = new FakeKV();
  return {
    env: {
      IMAGES: r2 as unknown as R2Bucket,
      IMAGES_INDEX: kv as unknown as KVNamespace,
    },
    r2,
    kv,
  };
}

/** Asserts the handler owned the path; returns the non-null Response. */
async function call(request: Request, env: ImagesEnv): Promise<Response> {
  const res = await handleImages(request, env);
  if (!res) {
    throw new Error(
      `handler returned null for ${request.method} ${request.url}`,
    );
  }
  return res;
}

/** A tiny PNG-like payload — the bytes don't need to be a valid PNG for
 * our purposes; the handler trusts the multipart `type`. We construct a
 * `File` (not a bare `Blob`) so the `name` survives the FormData round
 * trip — undici's FormData implementation falls back to "blob" for
 * raw Blobs even when a third-arg filename is provided. */
function pngFile(content = "fake png bytes", filename = "test.png"): File {
  return new File([content], filename, { type: "image/png" });
}

function multipartUpload(file: File): FormData {
  const fd = new FormData();
  fd.append("file", file);
  return fd;
}

describe("POST /api/admin/images/<slug> — upload", () => {
  it("rejects without Access header (403) and writes nothing", async () => {
    const { env, r2, kv } = makeEnv();
    const fd = multipartUpload(pngFile());
    const res = await call(
      // No adminRequest wrapper — simulates missing Access auth.
      new Request("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd,
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(r2.store.size).toBe(0);
    expect(kv.store.size).toBe(0);
  });

  it("returns 200 with { src, contentHash, size, mimeType } on a valid upload", async () => {
    const { env } = makeEnv();
    const fd = multipartUpload(pngFile("hello-world"));
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImageRecord;
    expect(body.mimeType).toBe("image/png");
    expect(body.size).toBe("hello-world".length);
    expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.src).toBe(`/images/decks/hello/${body.contentHash}.png`);
    expect(body.originalFilename).toBe("test.png");
    expect(body.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("persists the bytes to R2 with the correct key + contentType", async () => {
    const { env, r2 } = makeEnv();
    const fd = multipartUpload(pngFile("xyz"));
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd,
      }),
      env,
    );
    const body = (await res.json()) as ImageRecord;
    const key = `decks/hello/${body.contentHash}.png`;
    expect(r2.store.has(key)).toBe(true);
    expect(r2.store.get(key)!.httpMetadata.contentType).toBe("image/png");
    expect(r2.store.get(key)!.size).toBe(3);
  });

  it("is content-addressed: same bytes twice → same src + same R2 key", async () => {
    const { env, r2 } = makeEnv();
    const fd1 = multipartUpload(pngFile("identical-bytes", "a.png"));
    const res1 = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd1,
      }),
      env,
    );
    const r1 = (await res1.json()) as ImageRecord;

    const fd2 = multipartUpload(pngFile("identical-bytes", "b.png"));
    const res2 = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd2,
      }),
      env,
    );
    const r2body = (await res2.json()) as ImageRecord;

    expect(r2body.contentHash).toBe(r1.contentHash);
    expect(r2body.src).toBe(r1.src);
    // Only ONE R2 object — second upload was idempotent.
    expect(r2.store.size).toBe(1);
  });

  it("dedupes the index by contentHash on re-upload", async () => {
    const { env, kv } = makeEnv();
    const fd1 = multipartUpload(pngFile("dedup-me", "first.png"));
    await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd1,
      }),
      env,
    );
    const fd2 = multipartUpload(pngFile("dedup-me", "second.png"));
    await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd2,
      }),
      env,
    );
    const stored = JSON.parse(
      kv.store.get("images-index:hello")!,
    ) as ImageRecord[];
    expect(stored).toHaveLength(1);
    // Last upload wins on metadata refresh — originalFilename is updated.
    expect(stored[0].originalFilename).toBe("second.png");
  });

  it("appends distinct entries for distinct bytes", async () => {
    const { env, kv } = makeEnv();
    await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: multipartUpload(pngFile("first")),
      }),
      env,
    );
    await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: multipartUpload(pngFile("second")),
      }),
      env,
    );
    const stored = JSON.parse(
      kv.store.get("images-index:hello")!,
    ) as ImageRecord[];
    expect(stored).toHaveLength(2);
    expect(stored[0].contentHash).not.toBe(stored[1].contentHash);
  });

  it("rejects unsupported MIME types with 415", async () => {
    const { env, r2, kv } = makeEnv();
    const fd = new FormData();
    fd.append(
      "file",
      new Blob(["whatever"], { type: "application/pdf" }),
      "doc.pdf",
    );
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd,
      }),
      env,
    );
    expect(res.status).toBe(415);
    expect(r2.store.size).toBe(0);
    expect(kv.store.size).toBe(0);
  });

  it("accepts each MIME in the allowlist (png, jpeg, webp, gif, svg)", async () => {
    const cases: Array<[string, string]> = [
      ["image/png", "png"],
      ["image/jpeg", "jpg"],
      ["image/webp", "webp"],
      ["image/gif", "gif"],
      ["image/svg+xml", "svg"],
    ];
    for (const [mime, ext] of cases) {
      const { env } = makeEnv();
      const fd = new FormData();
      fd.append(
        "file",
        new Blob([`bytes-for-${ext}`], { type: mime }),
        `f.${ext}`,
      );
      const res = await call(
        adminRequest("https://example.com/api/admin/images/hello", {
          method: "POST",
          body: fd,
        }),
        env,
      );
      expect(res.status, `MIME ${mime}`).toBe(200);
      const body = (await res.json()) as ImageRecord;
      expect(body.src.endsWith(`.${ext}`)).toBe(true);
      expect(body.mimeType).toBe(mime);
    }
  });

  it("rejects with 400 when the file field is missing", async () => {
    const { env } = makeEnv();
    const fd = new FormData();
    fd.append("notfile", "oops");
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd,
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects with 400 when the file is empty", async () => {
    const { env } = makeEnv();
    const fd = new FormData();
    fd.append("file", new Blob([], { type: "image/png" }), "empty.png");
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd,
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects with 413 when the file exceeds the 10MB size limit", async () => {
    const { env, r2, kv } = makeEnv();
    // 10MB + 1 byte. Allocated as a single Uint8Array so the multipart
    // body actually carries the bytes — exercises the post-parse size
    // check rather than the Content-Length precheck (which can't be
    // exercised reliably from happy-dom because the runtime strips
    // client-set Content-Length headers from Request constructors).
    const oversize = new Uint8Array(10 * 1024 * 1024 + 1);
    const fd = new FormData();
    fd.append(
      "file",
      new File([oversize], "huge.png", { type: "image/png" }),
    );
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: fd,
      }),
      env,
    );
    expect(res.status).toBe(413);
    expect(r2.store.size).toBe(0);
    expect(kv.store.size).toBe(0);
  });

  it("rejects an invalid slug with 400", async () => {
    const { env } = makeEnv();
    const fd = multipartUpload(pngFile());
    const res = await call(
      adminRequest("https://example.com/api/admin/images/Bad..Slug", {
        method: "POST",
        body: fd,
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/images/<slug> — index", () => {
  it("rejects without Access header (403)", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/images/hello"),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("returns { images: [] } when no images exist for the slug", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { images: ImageRecord[] };
    expect(body.images).toEqual([]);
  });

  it("returns the persisted index after uploads", async () => {
    const { env } = makeEnv();
    await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: multipartUpload(pngFile("a")),
      }),
      env,
    );
    await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: multipartUpload(pngFile("b")),
      }),
      env,
    );
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello"),
      env,
    );
    const body = (await res.json()) as { images: ImageRecord[] };
    expect(body.images).toHaveLength(2);
    expect(body.images[0].mimeType).toBe("image/png");
  });
});

describe("DELETE /api/admin/images/<slug>/<hash> — remove image", () => {
  it("rejects without Access header (403)", async () => {
    const { env } = makeEnv();
    const fakeHash = "a".repeat(64);
    const res = await call(
      new Request(
        `https://example.com/api/admin/images/hello/${fakeHash}`,
        { method: "DELETE" },
      ),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("removes both the R2 object and the index entry; returns 204", async () => {
    const { env, r2, kv } = makeEnv();
    const upload = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: multipartUpload(pngFile("delete-me")),
      }),
      env,
    );
    const { contentHash } = (await upload.json()) as ImageRecord;
    expect(r2.store.size).toBe(1);

    const res = await call(
      adminRequest(
        `https://example.com/api/admin/images/hello/${contentHash}`,
        { method: "DELETE" },
      ),
      env,
    );
    expect(res.status).toBe(204);
    expect(r2.store.size).toBe(0);
    const stored = JSON.parse(
      kv.store.get("images-index:hello")!,
    ) as ImageRecord[];
    expect(stored).toEqual([]);
  });

  it("is idempotent — deleting a missing hash still returns 204", async () => {
    const { env } = makeEnv();
    const fakeHash = "0".repeat(64);
    const res = await call(
      adminRequest(`https://example.com/api/admin/images/hello/${fakeHash}`, {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(204);
  });

  it("rejects malformed hashes with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello/notahash", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /images/<path> — public serve", () => {
  it("streams the R2 object with content-type + immutable cache-control", async () => {
    const { env } = makeEnv();
    const upload = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "POST",
        body: multipartUpload(pngFile("served-bytes")),
      }),
      env,
    );
    const record = (await upload.json()) as ImageRecord;

    const res = await call(
      new Request(`https://example.com${record.src}`),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const text = await res.text();
    expect(text).toBe("served-bytes");
  });

  it("returns 404 when the R2 object is missing", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request(
        `https://example.com/images/decks/hello/${"a".repeat(64)}.png`,
      ),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 405 for unsupported methods on the public serve path", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/images/decks/hello/abc.png", {
        method: "POST",
      }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe("routing", () => {
  it("returns null for paths the handler does not own", async () => {
    const { env } = makeEnv();
    expect(
      await handleImages(
        new Request("https://example.com/api/themes/hello"),
        env,
      ),
    ).toBeNull();
    expect(
      await handleImages(new Request("https://example.com/decks/hello"), env),
    ).toBeNull();
  });

  it("returns 405 for PATCH on /api/admin/images/<slug>", async () => {
    const { env } = makeEnv();
    const res = await call(
      adminRequest("https://example.com/api/admin/images/hello", {
        method: "PATCH",
      }),
      env,
    );
    expect(res.status).toBe(405);
  });

  it("returns 405 for POST on /api/admin/images/<slug>/<hash>", async () => {
    const { env } = makeEnv();
    const fakeHash = "a".repeat(64);
    const res = await call(
      adminRequest(
        `https://example.com/api/admin/images/hello/${fakeHash}`,
        { method: "POST" },
      ),
      env,
    );
    expect(res.status).toBe(405);
  });
});
