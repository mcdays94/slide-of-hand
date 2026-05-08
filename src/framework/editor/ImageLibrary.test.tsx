/**
 * Component tests for `<ImageLibrary>`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ImageLibrary, type ImageLibraryRecord } from "./ImageLibrary";

const recordA: ImageLibraryRecord = {
  src: "/images/decks/hello/aaa.png",
  contentHash: "aaa",
  size: 1024,
  mimeType: "image/png",
  originalFilename: "logo.png",
  uploadedAt: "2026-01-01T00:00:00.000Z",
};
const recordB: ImageLibraryRecord = {
  src: "/images/decks/hello/bbb.jpg",
  contentHash: "bbb",
  size: 2048,
  mimeType: "image/jpeg",
  originalFilename: "team.jpg",
  uploadedAt: "2026-01-02T00:00:00.000Z",
};

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch({ images: [] }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ImageLibrary>", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <ImageLibrary
        slug="hello"
        open={false}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("fetches /api/admin/images/<slug> on open", async () => {
    const fetchMock = mockFetch({ images: [recordA, recordB] });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ImageLibrary
        slug="hello"
        open={true}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("image-library-grid")).toBeDefined(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/images/hello");
  });

  it("renders thumbnails for each record", async () => {
    vi.stubGlobal("fetch", mockFetch({ images: [recordA, recordB] }));

    render(
      <ImageLibrary
        slug="hello"
        open={true}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("image-library-grid")).toBeDefined(),
    );

    // `alt=""` makes <img> presentational (no role="img"), so query by tag.
    const imgs = screen
      .getByTestId("image-library-grid")
      .querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0].src).toContain("/images/decks/hello/aaa.png");
    expect(imgs[1].src).toContain("/images/decks/hello/bbb.jpg");
  });

  it("calls onPick with the chosen src when a tile is clicked", async () => {
    vi.stubGlobal("fetch", mockFetch({ images: [recordA, recordB] }));
    const onPick = vi.fn();

    render(
      <ImageLibrary
        slug="hello"
        open={true}
        onPick={onPick}
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("image-library-pick-aaa")).toBeDefined(),
    );

    fireEvent.click(screen.getByTestId("image-library-pick-aaa"));
    expect(onPick).toHaveBeenCalledWith("/images/decks/hello/aaa.png");
  });

  it("shows an empty state when the library has no records", async () => {
    vi.stubGlobal("fetch", mockFetch({ images: [] }));

    render(
      <ImageLibrary
        slug="hello"
        open={true}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("image-library-empty")).toBeDefined(),
    );
  });

  it("shows an error state on a failed fetch", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false, 500));

    render(
      <ImageLibrary
        slug="hello"
        open={true}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("image-library-error")).toBeDefined(),
    );
    expect(screen.getByTestId("image-library-error").textContent).toMatch(
      /HTTP 500/,
    );
  });

  it("close button calls onClose", async () => {
    vi.stubGlobal("fetch", mockFetch({ images: [] }));
    const onClose = vi.fn();

    render(
      <ImageLibrary
        slug="hello"
        open={true}
        onPick={() => {}}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId("image-library-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key calls onClose", async () => {
    vi.stubGlobal("fetch", mockFetch({ images: [] }));
    const onClose = vi.fn();

    render(
      <ImageLibrary
        slug="hello"
        open={true}
        onPick={() => {}}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
