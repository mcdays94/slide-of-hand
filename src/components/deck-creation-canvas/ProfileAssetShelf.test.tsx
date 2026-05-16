/**
 * Tests for `<ProfileAssetShelf>` (issue #266). Mirrors the
 * `DraftAssetShelf.test.tsx` pattern: the `useProfileAssets` hook
 * is mocked so we exercise the component's rendering + interaction
 * surface without re-testing the hook's fetch plumbing (covered in
 * `useProfileAssets.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Hoisted mock spies so the `vi.mock` factory can reference them.
const { useProfileAssetsMock } = vi.hoisted(() => ({
  useProfileAssetsMock: vi.fn(),
}));

vi.mock("@/hooks/useProfileAssets", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/useProfileAssets")
  >("@/hooks/useProfileAssets");
  return {
    ...actual,
    useProfileAssets: useProfileAssetsMock,
  };
});

import { ProfileAssetShelf } from "./ProfileAssetShelf";

afterEach(() => {
  cleanup();
  useProfileAssetsMock.mockReset();
});

function record(overrides: Partial<{
  src: string;
  contentHash: string;
  size: number;
  mimeType: string;
  originalFilename: string;
  uploadedAt: string;
}> = {}) {
  return {
    src: "/images/profile/abcd/aaaa.png",
    contentHash: "a".repeat(64),
    size: 10,
    mimeType: "image/png",
    originalFilename: "speaker.png",
    uploadedAt: "2026-05-16T00:00:00Z",
    ...overrides,
  };
}

describe("<ProfileAssetShelf>", () => {
  it("renders the header + explainer", () => {
    useProfileAssetsMock.mockReturnValue({
      assets: [],
      error: null,
      loading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
      clearError: vi.fn(),
    });
    render(<ProfileAssetShelf />);
    expect(screen.getByTestId("profile-asset-shelf")).toBeDefined();
    // The header is a <h2> with the canonical caps label.
    expect(
      screen.getByRole("heading", { name: /profile assets/i }),
    ).toBeDefined();
    expect(screen.getByText(/recurring assets/i)).toBeDefined();
  });

  it("renders the empty state when the user has no profile assets", () => {
    useProfileAssetsMock.mockReturnValue({
      assets: [],
      error: null,
      loading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
      clearError: vi.fn(),
    });
    render(<ProfileAssetShelf />);
    expect(screen.getByTestId("profile-asset-shelf-empty")).toBeDefined();
  });

  it("renders a row per asset with the public URL surfaced", () => {
    const r1 = record({
      contentHash: "a".repeat(64),
      originalFilename: "speaker.png",
      src: "/images/profile/abcd/aaaa.png",
    });
    const r2 = record({
      contentHash: "b".repeat(64),
      originalFilename: "logo.svg",
      mimeType: "image/svg+xml",
      src: "/images/profile/abcd/bbbb.svg",
    });
    useProfileAssetsMock.mockReturnValue({
      assets: [r1, r2],
      error: null,
      loading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
      clearError: vi.fn(),
    });
    render(<ProfileAssetShelf />);
    expect(screen.getByTestId(`profile-asset-shelf-item-${r1.contentHash}`))
      .toBeDefined();
    expect(screen.getByTestId(`profile-asset-shelf-item-${r2.contentHash}`))
      .toBeDefined();
    // URLs are visible — the shelf's primary affordance.
    expect(screen.getByText(r1.src)).toBeDefined();
    expect(screen.getByText(r2.src)).toBeDefined();
    expect(screen.getByText("speaker.png")).toBeDefined();
    expect(screen.getByText("logo.svg")).toBeDefined();
  });

  it("never displays the user's raw email anywhere on the shelf", () => {
    // The hook intentionally never has access to the email; the
    // shelf must not derive it either. This is a contract test
    // against an accidental future regression.
    useProfileAssetsMock.mockReturnValue({
      assets: [record()],
      error: null,
      loading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
      clearError: vi.fn(),
    });
    const { container } = render(<ProfileAssetShelf />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/@/);
  });

  it("calls upload(file) when a file is picked", async () => {
    const upload = vi.fn().mockResolvedValue(record());
    useProfileAssetsMock.mockReturnValue({
      assets: [],
      error: null,
      loading: false,
      upload,
      remove: vi.fn(),
      refresh: vi.fn(),
      clearError: vi.fn(),
    });
    render(<ProfileAssetShelf />);
    const input = screen.getByTestId(
      "profile-asset-shelf-file-input",
    ) as HTMLInputElement;
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0].name).toBe("logo.png");
  });

  it("invokes navigator.clipboard.writeText with the URL when Copy is clicked", async () => {
    const rec = record();
    useProfileAssetsMock.mockReturnValue({
      assets: [rec],
      error: null,
      loading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
      clearError: vi.fn(),
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<ProfileAssetShelf />);
    const copyBtn = screen.getByTestId(
      `profile-asset-shelf-copy-${rec.contentHash}`,
    );
    fireEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalledWith(rec.src);
  });

  it("calls remove(contentHash) when Delete is clicked", () => {
    const rec = record();
    const remove = vi.fn();
    useProfileAssetsMock.mockReturnValue({
      assets: [rec],
      error: null,
      loading: false,
      upload: vi.fn(),
      remove,
      refresh: vi.fn(),
      clearError: vi.fn(),
    });
    render(<ProfileAssetShelf />);
    const delBtn = screen.getByTestId(
      `profile-asset-shelf-delete-${rec.contentHash}`,
    );
    fireEvent.click(delBtn);
    expect(remove).toHaveBeenCalledWith(rec.contentHash);
  });

  it("surfaces the hook's error string in an alert role", () => {
    useProfileAssetsMock.mockReturnValue({
      assets: [],
      error: "Upload failed (HTTP 415)",
      loading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
      clearError: vi.fn(),
    });
    render(<ProfileAssetShelf />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/upload failed/i);
  });
});
