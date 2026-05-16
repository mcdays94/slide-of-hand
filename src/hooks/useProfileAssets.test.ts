/**
 * Tests for `useProfileAssets` (issue #266). The pattern mirrors
 * `useImageUpload.test.ts` — fetch is stubbed; the hook's behaviour
 * is verified via observable state transitions and the request
 * arguments it sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useProfileAssets } from "./useProfileAssets";

function makeFile(bytes: number, type: string, name = "photo.png"): File {
  const blob = new File(["x"], name, { type });
  Object.defineProperty(blob, "size", { value: bytes });
  return blob;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { hostname: "localhost", href: "http://localhost/" },
    writable: true,
  });
});

describe("useProfileAssets — list on mount", () => {
  it("fetches /api/admin/profile-assets and populates `assets`", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          images: [
            {
              src: "/images/profile/abcd/aaaa.png",
              contentHash: "a".repeat(64),
              size: 10,
              mimeType: "image/png",
              originalFilename: "speaker.png",
              uploadedAt: "2026-05-16T00:00:00Z",
            },
          ],
        }),
      );

    const { result } = renderHook(() => useProfileAssets());

    await waitFor(() => {
      expect(result.current.assets).not.toBeNull();
    });
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.assets?.[0].originalFilename).toBe("speaker.png");
    // The first call must be the list endpoint with a GET.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/profile-assets",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("treats a 403 as empty (service-token / unauthenticated callers)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    );
    const { result } = renderHook(() => useProfileAssets());
    await waitFor(() => {
      expect(result.current.assets).toEqual([]);
    });
    expect(result.current.error).toBeNull();
  });
});

describe("useProfileAssets — upload", () => {
  it("posts multipart to /api/admin/profile-assets and prepends the new record", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    // Initial list — empty.
    fetchMock.mockResolvedValueOnce(jsonResponse({ images: [] }));
    // Upload — returns the new record.
    const record = {
      src: "/images/profile/abcd/aaaa.png",
      contentHash: "a".repeat(64),
      size: 11,
      mimeType: "image/png",
      originalFilename: "speaker.png",
      uploadedAt: "2026-05-16T00:00:00Z",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(record));

    const { result } = renderHook(() => useProfileAssets());
    await waitFor(() => expect(result.current.assets).toEqual([]));

    await act(async () => {
      await result.current.upload(
        makeFile(11, "image/png", "speaker.png"),
      );
    });

    expect(result.current.assets).toEqual([record]);
    // Second call is the multipart POST.
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/admin/profile-assets");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("rejects unsupported MIME locally without hitting the network", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ images: [] }));

    const { result } = renderHook(() => useProfileAssets());
    await waitFor(() => expect(result.current.assets).toEqual([]));

    await expect(
      act(async () => {
        await result.current.upload(makeFile(10, "application/pdf", "x.pdf"));
      }),
    ).rejects.toThrow(/Unsupported file type/);
    // Only the initial list call should have hit the network — the
    // upload short-circuited locally.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects files over 10 MB locally without hitting the network", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ images: [] }));

    const { result } = renderHook(() => useProfileAssets());
    await waitFor(() => expect(result.current.assets).toEqual([]));

    await expect(
      act(async () => {
        await result.current.upload(
          makeFile(10 * 1024 * 1024 + 1, "image/png"),
        );
      }),
    ).rejects.toThrow(/File too large/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useProfileAssets — remove", () => {
  it("calls DELETE with the contentHash and drops the entry from state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const existing = {
      src: "/images/profile/abcd/aaaa.png",
      contentHash: "a".repeat(64),
      size: 10,
      mimeType: "image/png",
      originalFilename: "speaker.png",
      uploadedAt: "2026-05-16T00:00:00Z",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ images: [existing] }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useProfileAssets());
    await waitFor(() => expect(result.current.assets).toHaveLength(1));

    await act(async () => {
      await result.current.remove(existing.contentHash);
    });

    expect(result.current.assets).toEqual([]);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`/api/admin/profile-assets/${existing.contentHash}`);
    expect(init?.method).toBe("DELETE");
  });
});

describe("useProfileAssets — refresh", () => {
  it("can be called manually to re-list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(jsonResponse({ images: [] }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        images: [
          {
            src: "/images/profile/abcd/aaaa.png",
            contentHash: "a".repeat(64),
            size: 10,
            mimeType: "image/png",
            originalFilename: "logo.png",
            uploadedAt: "2026-05-16T00:00:00Z",
          },
        ],
      }),
    );

    const { result } = renderHook(() => useProfileAssets());
    await waitFor(() => expect(result.current.assets).toEqual([]));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.assets).toHaveLength(1);
  });
});
