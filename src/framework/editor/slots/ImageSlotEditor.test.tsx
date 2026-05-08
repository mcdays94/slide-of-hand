/**
 * Component tests for `<ImageSlotEditor>`.
 *
 * The editor pulls `slug` from `useParams()`, so every render is wrapped
 * in `<MemoryRouter>` + `<Routes>` matching the `/admin/decks/:slug`
 * pattern — same harness `decks.$slug.analytics.test.tsx` uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ImageSlotEditor } from "./ImageSlotEditor";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";

const spec: SlotSpec = {
  kind: "image",
  label: "Hero",
  required: true,
  description: "Shown above the title.",
};

type ImageValue = Extract<SlotValue, { kind: "image" }>;

function renderInRoute(
  ui: React.ReactNode,
  slug = "hello",
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/admin/decks/${slug}`]}>
      <Routes>
        <Route path="/admin/decks/:slug" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

function makePngFile(name = "photo.png"): File {
  return new File(["fakebytes"], name, { type: "image/png" });
}

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

beforeEach(() => {
  // Default: empty library (used when ImageLibrary opens).
  vi.stubGlobal("fetch", mockFetchOk({ images: [] }));
  // Force localhost for adminWriteHeaders.
  Object.defineProperty(window, "location", {
    value: { hostname: "localhost", href: "http://localhost/" },
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ImageSlotEditor>", () => {
  it("renders the label, drop zone, and a file input", () => {
    const value: ImageValue = { kind: "image", src: "", alt: "" };
    renderInRoute(
      <ImageSlotEditor name="hero" spec={spec} value={value} onChange={() => {}} />,
    );
    expect(screen.getByText("Hero")).toBeDefined();
    expect(screen.getByTestId("slot-image-dropzone-hero")).toBeDefined();
    expect(screen.getByTestId("slot-image-input-hero")).toBeDefined();
  });

  it("shows the required indicator when spec.required is true", () => {
    const value: ImageValue = { kind: "image", src: "", alt: "" };
    renderInRoute(
      <ImageSlotEditor name="hero" spec={spec} value={value} onChange={() => {}} />,
    );
    expect(screen.getAllByLabelText("required").length).toBeGreaterThanOrEqual(1);
  });

  it("constrains the file input via the accept attribute (MIME allowlist)", () => {
    const value: ImageValue = { kind: "image", src: "", alt: "" };
    renderInRoute(
      <ImageSlotEditor name="hero" spec={spec} value={value} onChange={() => {}} />,
    );
    const input = screen.getByTestId(
      "slot-image-input-hero",
    ) as HTMLInputElement;
    expect(input.accept).toContain("image/png");
    expect(input.accept).toContain("image/jpeg");
    expect(input.accept).toContain("image/webp");
    expect(input.accept).toContain("image/gif");
    expect(input.accept).toContain("image/svg+xml");
  });

  it("renders an image preview when value.src is set", () => {
    const value: ImageValue = {
      kind: "image",
      src: "/images/decks/hello/abc.png",
      alt: "Logo",
    };
    renderInRoute(
      <ImageSlotEditor name="hero" spec={spec} value={value} onChange={() => {}} />,
    );
    const preview = screen.getByTestId(
      "slot-image-preview-hero",
    ) as HTMLImageElement;
    expect(preview.src).toContain("/images/decks/hello/abc.png");
    expect(preview.alt).toBe("Logo");
  });

  it("changes the file-pick button label to 'Replace' when a src is set", () => {
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{ kind: "image", src: "/images/x.png", alt: "x" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("slot-image-pick-hero").textContent).toMatch(
      /Replace/,
    );
  });

  it("uploads the dropped file via POST /api/admin/images/<slug> and emits the new src", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ src: "/images/decks/hello/abc.png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onChange = vi.fn();
    const value: ImageValue = { kind: "image", src: "", alt: "" };
    renderInRoute(
      <ImageSlotEditor name="hero" spec={spec} value={value} onChange={onChange} />,
    );

    const file = makePngFile("dropped.png");
    fireEvent.drop(screen.getByTestId("slot-image-dropzone-hero"), {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const lastCall = onChange.mock.calls.at(-1)![0];
    expect(lastCall).toEqual({
      kind: "image",
      src: "/images/decks/hello/abc.png",
      alt: "",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/images/hello",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uploads the file picked via the file input and emits the new src", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ src: "/images/decks/hello/picked.png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onChange = vi.fn();
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{ kind: "image", src: "", alt: "" }}
        onChange={onChange}
      />,
    );

    const input = screen.getByTestId(
      "slot-image-input-hero",
    ) as HTMLInputElement;
    const file = makePngFile("picked.png");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const lastCall = onChange.mock.calls.at(-1)![0];
    expect(lastCall.src).toBe("/images/decks/hello/picked.png");
  });

  it("rejects an unsupported file type without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const onChange = vi.fn();
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{ kind: "image", src: "", alt: "" }}
        onChange={onChange}
      />,
    );

    const bad = new File(["x"], "raw.heic", { type: "image/heic" });
    fireEvent.drop(screen.getByTestId("slot-image-dropzone-hero"), {
      dataTransfer: { files: [bad] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("slot-image-error-hero")).toBeDefined(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows an upload progress indicator while the POST is in flight", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(fetchPromise));

    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{ kind: "image", src: "", alt: "" }}
        onChange={() => {}}
      />,
    );

    const input = screen.getByTestId(
      "slot-image-input-hero",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePngFile()] } });

    await waitFor(() =>
      expect(screen.getByTestId("slot-image-uploading-hero")).toBeDefined(),
    );

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({ src: "/images/decks/hello/done.png" }),
    });

    await waitFor(() =>
      expect(screen.queryByTestId("slot-image-uploading-hero")).toBeNull(),
    );
  });

  it("alt-text input edits emit a fresh image SlotValue", () => {
    const onChange = vi.fn();
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{
          kind: "image",
          src: "/images/decks/hello/x.png",
          alt: "",
        }}
        onChange={onChange}
      />,
    );

    const altInput = screen.getByTestId(
      "slot-image-alt-hero",
    ) as HTMLInputElement;
    fireEvent.change(altInput, { target: { value: "Acme logo" } });

    expect(onChange).toHaveBeenCalledWith({
      kind: "image",
      src: "/images/decks/hello/x.png",
      alt: "Acme logo",
    });
  });

  it("warns when alt is empty AND the slot is required", () => {
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{
          kind: "image",
          src: "/images/decks/hello/x.png",
          alt: "",
        }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("slot-image-alt-warning-hero")).toBeDefined();
  });

  it("does NOT warn when alt is non-empty", () => {
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{
          kind: "image",
          src: "/images/decks/hello/x.png",
          alt: "Logo",
        }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("slot-image-alt-warning-hero")).toBeNull();
  });

  it("does NOT warn when alt is empty but the slot is OPTIONAL", () => {
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={{ ...spec, required: false }}
        value={{ kind: "image", src: "/images/x.png", alt: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("slot-image-alt-warning-hero")).toBeNull();
  });

  it("'Choose from library' opens the ImageLibrary panel", async () => {
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{ kind: "image", src: "", alt: "" }}
        onChange={() => {}}
      />,
    );

    expect(screen.queryByTestId("image-library")).toBeNull();
    fireEvent.click(screen.getByTestId("slot-image-library-hero"));
    await waitFor(() =>
      expect(screen.getByTestId("image-library")).toBeDefined(),
    );
  });

  it("picking a library image emits a new SlotValue and closes the panel", async () => {
    const recordA = {
      src: "/images/decks/hello/aaa.png",
      contentHash: "aaa",
      size: 1024,
      mimeType: "image/png",
      originalFilename: "logo.png",
      uploadedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", mockFetchOk({ images: [recordA] }));

    const onChange = vi.fn();
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{ kind: "image", src: "", alt: "" }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("slot-image-library-hero"));
    await waitFor(() =>
      expect(screen.getByTestId("image-library-pick-aaa")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("image-library-pick-aaa"));

    expect(onChange).toHaveBeenCalledWith({
      kind: "image",
      src: "/images/decks/hello/aaa.png",
      alt: "",
    });
    await waitFor(() =>
      expect(screen.queryByTestId("image-library")).toBeNull(),
    );
  });

  it("preserves revealAt across uploads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ src: "/images/decks/hello/new.png" }),
      }),
    );

    const onChange = vi.fn();
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{
          kind: "image",
          src: "/images/decks/hello/old.png",
          alt: "old",
          revealAt: 2,
        }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByTestId("slot-image-input-hero"), {
      target: { files: [makePngFile()] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.revealAt).toBe(2);
  });

  it("highlights the drop zone on drag over", () => {
    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{ kind: "image", src: "", alt: "" }}
        onChange={() => {}}
      />,
    );
    const zone = screen.getByTestId("slot-image-dropzone-hero");
    fireEvent.dragOver(zone);
    expect(zone.getAttribute("data-drag-over")).toBe("true");
    fireEvent.dragLeave(zone);
    expect(zone.getAttribute("data-drag-over")).toBeNull();
  });

  it("surfaces the upload error via an alert with a dismiss button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom" }),
      }),
    );

    renderInRoute(
      <ImageSlotEditor
        name="hero"
        spec={spec}
        value={{ kind: "image", src: "", alt: "" }}
        onChange={() => {}}
      />,
    );

    fireEvent.change(screen.getByTestId("slot-image-input-hero"), {
      target: { files: [makePngFile()] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("slot-image-error-hero")).toBeDefined(),
    );
    expect(screen.getByTestId("slot-image-error-hero").textContent).toMatch(
      /boom/,
    );

    fireEvent.click(screen.getByTestId("slot-image-error-dismiss-hero"));
    await waitFor(() =>
      expect(screen.queryByTestId("slot-image-error-hero")).toBeNull(),
    );
  });
});
