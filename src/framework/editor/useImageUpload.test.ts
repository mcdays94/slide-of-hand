/**
 * Tests for `useImageUpload`. Mirrors the fetch-mock pattern used by
 * `useElementOverrides.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useImageUpload,
  isAllowedImageMime,
  MAX_UPLOAD_BYTES,
  ALLOWED_IMAGE_MIME_TYPES,
} from "./useImageUpload";

function makeFile(
  bytes: number,
  type: string,
  name = "photo.png",
): File {
  // We don't need real bytes for the unit tests — a one-byte payload
  // with a faked `size` is all that matters. happy-dom's File ctor
  // honours the array length, so we pass a Uint8Array of `bytes`.
  // For the >10MB test we'd allocate 10MB which is wasteful in a unit
  // test; cheaper to fake `size` via Object.defineProperty.
  const blob = new File(["x"], name, { type });
  Object.defineProperty(blob, "size", { value: bytes });
  return blob;
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Force "localhost" so adminWriteHeaders injects the dev access header.
  // happy-dom uses http://localhost/ by default — defensive.
  Object.defineProperty(window, "location", {
    value: { hostname: "localhost", href: "http://localhost/" },
    writable: true,
  });
});

describe("ALLOWED_IMAGE_MIME_TYPES", () => {
  it("matches the worker MIME allowlist", () => {
    // Sanity: this list must stay in lockstep with worker/images.ts.
    // If the worker grows a kind, this assertion will fail and remind
    // us to update both sides.
    expect([...ALLOWED_IMAGE_MIME_TYPES].sort()).toEqual(
      [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/svg+xml",
      ].sort(),
    );
  });

  it("isAllowedImageMime accepts the allowlist", () => {
    for (const mime of ALLOWED_IMAGE_MIME_TYPES) {
      expect(isAllowedImageMime(mime)).toBe(true);
    }
  });

  it("isAllowedImageMime rejects everything else", () => {
    expect(isAllowedImageMime("image/heic")).toBe(false);
    expect(isAllowedImageMime("application/pdf")).toBe(false);
    expect(isAllowedImageMime("")).toBe(false);
  });
});

describe("useImageUpload", () => {
  it("starts in idle state", () => {
    const { result } = renderHook(() => useImageUpload());
    expect(result.current.uploading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBe(0);
  });

  it("rejects unsupported MIME types BEFORE calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImageUpload());
    const bad = makeFile(1024, "image/heic", "raw.heic");

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.upload(bad, "hello");
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/Unsupported file type/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/Unsupported file type/);
  });

  it("rejects files larger than 10 MB BEFORE calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImageUpload());
    const huge = makeFile(MAX_UPLOAD_BYTES + 1, "image/png");

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.upload(huge, "hello");
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/too large/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/too large/i);
  });

  it("POSTs multipart to /api/admin/images/<slug> and returns src", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        src: "/images/decks/hello/abc.png",
        contentHash: "abc",
        size: 100,
        mimeType: "image/png",
        originalFilename: "photo.png",
        uploadedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImageUpload());
    const file = makeFile(100, "image/png", "photo.png");

    let uploadResult: { src: string; alt: string } | undefined;
    await act(async () => {
      uploadResult = await result.current.upload(file, "hello");
    });

    expect(uploadResult).toEqual({
      src: "/images/decks/hello/abc.png",
      alt: "",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/images/hello");
    expect(init.method).toBe("POST");
    // Body must be FormData (browser sets the multipart boundary).
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
    // Must NOT set content-type — the browser owns the boundary.
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
    // Localhost dev injects the access header.
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");

    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBe(100);
  });

  it("URL-encodes slugs with special characters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ src: "/images/decks/q3-2026/abc.png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImageUpload());
    const file = makeFile(100, "image/png");

    await act(async () => {
      await result.current.upload(file, "q3-2026");
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/images/q3-2026");
  });

  it("surfaces the server's error message on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 415,
      json: async () => ({ error: "unsupported MIME type: image/heic" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImageUpload());
    const file = makeFile(100, "image/png");

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.upload(file, "hello");
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/unsupported MIME type/);
    expect(result.current.error).toMatch(/unsupported MIME type/);
    expect(result.current.uploading).toBe(false);
  });

  it("falls back to a generic message when the server response is not JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImageUpload());
    const file = makeFile(100, "image/png");

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.upload(file, "hello");
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/HTTP 500/);
    expect(result.current.error).toMatch(/HTTP 500/);
  });

  it("clearError() drops a stale error", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const { result } = renderHook(() => useImageUpload());
    const bad = makeFile(1024, "image/heic");

    await act(async () => {
      try {
        await result.current.upload(bad, "hello");
      } catch {
        // expected
      }
    });
    expect(result.current.error).not.toBeNull();

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("flips uploading=true during the in-flight fetch", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImageUpload());
    const file = makeFile(100, "image/png");

    let uploadPromise: Promise<unknown> | undefined;
    await act(async () => {
      uploadPromise = result.current.upload(file, "hello");
      // Yield once so React commits the `uploading=true` state.
      await Promise.resolve();
    });
    expect(result.current.uploading).toBe(true);

    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({ src: "/images/decks/hello/x.png" }),
      });
      await uploadPromise;
    });
    expect(result.current.uploading).toBe(false);
  });
});
