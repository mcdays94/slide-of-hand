/**
 * Tests for `<DraftAssetShelf>` — the asset-upload affordance that
 * appears on `/admin/decks/new` once the model has picked a slug
 * (issue #235).
 *
 * The shelf:
 *
 *   - Renders nothing when no slug is known (pre-tool-call).
 *   - Renders an upload control + the existing image library once a
 *     slug is known.
 *   - Routes uploads through the existing `/api/admin/images/<slug>`
 *     endpoint (via `useImageUpload`), surfacing the returned URL in
 *     a copy-able list so the user can paste it into a follow-up
 *     prompt.
 *
 * We mock `useImageUpload` at the module boundary so we don't double-
 * test the hook's already-covered fetch wiring. The library fetch is
 * stubbed via `vi.stubGlobal("fetch")` because `<ImageLibrary>` calls
 * `fetch` directly on mount.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

// Hoisted mock so the factory below can reference it.
const { uploadMock, clearErrorMock, useImageUploadMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  clearErrorMock: vi.fn(),
  useImageUploadMock: vi.fn(),
}));

vi.mock("@/framework/editor/useImageUpload", () => ({
  useImageUpload: useImageUploadMock,
  ALLOWED_IMAGE_MIME_TYPES: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
  ],
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  isAllowedImageMime: (m: string) =>
    [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/svg+xml",
    ].includes(m),
}));

// Module under test is imported AFTER vi.mock so the mock wins.
// eslint-disable-next-line import/first
import { DraftAssetShelf } from "./DraftAssetShelf";

function makeFile(name: string, mime: string, size = 100): File {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type: mime });
}

function setupHook(overrides: Partial<{ uploading: boolean; error: string | null; progress: number }> = {}) {
  useImageUploadMock.mockReturnValue({
    upload: uploadMock,
    uploading: overrides.uploading ?? false,
    progress: overrides.progress ?? 0,
    error: overrides.error ?? null,
    clearError: clearErrorMock,
  });
}

beforeEach(() => {
  uploadMock.mockReset();
  clearErrorMock.mockReset();
  useImageUploadMock.mockReset();
  setupHook();
  // Default the library fetch to an empty index. Specific tests
  // override per-call.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ images: [] }),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<DraftAssetShelf> — slug gating", () => {
  it("renders nothing when slug is undefined", () => {
    const { container } = render(<DraftAssetShelf slug={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the shelf with a heading once a slug is provided", () => {
    render(<DraftAssetShelf slug="crdt-collab" />);
    expect(screen.getByTestId("draft-asset-shelf")).toBeDefined();
    expect(
      screen.getByRole("heading", { name: /draft assets/i }),
    ).toBeDefined();
  });

  it("shows the slug in the heading or copy so the user knows where uploads land", () => {
    render(<DraftAssetShelf slug="crdt-collab" />);
    const shelf = screen.getByTestId("draft-asset-shelf");
    expect(shelf.textContent ?? "").toContain("crdt-collab");
  });

  it("explains that uploads are scoped to this draft and can be referenced in follow-up prompts", () => {
    render(<DraftAssetShelf slug="crdt-collab" />);
    // Copy is intentional UX: the user needs to know (a) where the
    // file lives and (b) that they can ask the AI to use it.
    const shelf = screen.getByTestId("draft-asset-shelf");
    expect(shelf.textContent ?? "").toMatch(/follow-?up prompt/i);
  });
});

describe("<DraftAssetShelf> — upload flow", () => {
  it("renders a file input that accepts the image MIME allowlist", () => {
    render(<DraftAssetShelf slug="crdt-collab" />);
    const input = screen.getByTestId(
      "draft-asset-shelf-file-input",
    ) as HTMLInputElement;
    expect(input.type).toBe("file");
    // Accept attr should include at least the canonical image types.
    expect(input.accept).toMatch(/image\/png/);
    expect(input.accept).toMatch(/image\/jpeg/);
    expect(input.accept).toMatch(/image\/webp/);
  });

  it("calls upload(file, slug) when the user picks a file", async () => {
    uploadMock.mockResolvedValue({
      src: "/images/decks/crdt-collab/abc.png",
      alt: "",
    });
    render(<DraftAssetShelf slug="crdt-collab" />);
    const input = screen.getByTestId(
      "draft-asset-shelf-file-input",
    ) as HTMLInputElement;
    const file = makeFile("photo.png", "image/png");
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(file, "crdt-collab");
  });

  it("renders the uploaded URL as a code-style row after a successful upload", async () => {
    uploadMock.mockResolvedValue({
      src: "/images/decks/crdt-collab/abc.png",
      alt: "",
    });
    render(<DraftAssetShelf slug="crdt-collab" />);
    const input = screen.getByTestId(
      "draft-asset-shelf-file-input",
    ) as HTMLInputElement;
    const file = makeFile("photo.png", "image/png");
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("draft-asset-shelf-uploaded-url"),
      ).toBeDefined();
    });
    expect(
      screen.getByTestId("draft-asset-shelf-uploaded-url").textContent ?? "",
    ).toContain("/images/decks/crdt-collab/abc.png");
  });

  it("does NOT call upload when the input fires with an empty file list", async () => {
    render(<DraftAssetShelf slug="crdt-collab" />);
    const input = screen.getByTestId(
      "draft-asset-shelf-file-input",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [] } });
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("renders an inline progress / uploading hint while uploading", () => {
    setupHook({ uploading: true });
    render(<DraftAssetShelf slug="crdt-collab" />);
    expect(
      screen.getByTestId("draft-asset-shelf-uploading"),
    ).toBeDefined();
  });

  it("renders the hook's error message when upload fails", () => {
    setupHook({ error: "File too large" });
    render(<DraftAssetShelf slug="crdt-collab" />);
    const err = screen.getByTestId("draft-asset-shelf-error");
    expect(err.textContent ?? "").toMatch(/file too large/i);
  });
});

describe("<DraftAssetShelf> — copy URL button", () => {
  it("copies the uploaded URL to the clipboard when clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: { clipboard: { writeText } },
    });

    uploadMock.mockResolvedValue({
      src: "/images/decks/crdt-collab/abc.png",
      alt: "",
    });
    render(<DraftAssetShelf slug="crdt-collab" />);
    const input = screen.getByTestId(
      "draft-asset-shelf-file-input",
    ) as HTMLInputElement;
    const file = makeFile("photo.png", "image/png");
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    const btn = await screen.findByTestId("draft-asset-shelf-copy-url");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeText).toHaveBeenCalledWith(
      "/images/decks/crdt-collab/abc.png",
    );
  });
});

describe("<DraftAssetShelf> — library list", () => {
  it("fetches /api/admin/images/<slug> on mount and renders existing entries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        images: [
          {
            src: "/images/decks/crdt-collab/old.png",
            contentHash: "old",
            size: 1234,
            mimeType: "image/png",
            originalFilename: "old.png",
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DraftAssetShelf slug="crdt-collab" />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/images/crdt-collab");
    await waitFor(() => {
      expect(
        screen.getByTestId("draft-asset-shelf-library-item-old"),
      ).toBeDefined();
    });
  });

  it("renders an empty-library hint when the slug has no images yet", async () => {
    render(<DraftAssetShelf slug="crdt-collab" />);
    await waitFor(() => {
      expect(
        screen.getByTestId("draft-asset-shelf-library-empty"),
      ).toBeDefined();
    });
  });
});
