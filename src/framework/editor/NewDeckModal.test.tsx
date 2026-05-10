/**
 * Tests for `<NewDeckModal>` + the `slugify` helper.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { NewDeckModal, slugify } from "./NewDeckModal";

const ORIGINAL_HOSTNAME = window.location.hostname;
function setHostname(value: string) {
  Object.defineProperty(window.location, "hostname", {
    value,
    configurable: true,
  });
}

/**
 * Tiny route-witness helper: when navigation happens via React Router,
 * we render the current pathname into the DOM so tests can assert on
 * the post-submit URL without needing to peek at the router internals.
 */
function PathWitness() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname + location.search}</div>;
}

function renderModal(open: boolean, onClose = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <PathWitness />
              <NewDeckModal open={open} onClose={onClose} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setHostname("localhost");
});

afterEach(() => {
  setHostname(ORIGINAL_HOSTNAME);
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("slugify", () => {
  it("lowercases and hyphenates whitespace", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("strips punctuation", () => {
    expect(slugify("Hello, Slide of Hand!")).toBe("hello-slide-of-hand");
  });
  it("collapses runs of non-alphanumerics", () => {
    expect(slugify("a   b___c")).toBe("a-b-c");
  });
  it("trims leading/trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });
  it("strips diacritics", () => {
    expect(slugify("Câmara Município")).toBe("camara-municipio");
  });
  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});

describe("<NewDeckModal>", () => {
  it("does not render when open=false", () => {
    renderModal(false);
    expect(screen.queryByTestId("new-deck-modal")).toBeNull();
  });

  it("renders the title input always; hides advanced section by default", () => {
    renderModal(true);
    expect(screen.getByTestId("new-deck-title")).toBeDefined();
    expect(screen.queryByTestId("advanced-section")).toBeNull();
  });

  it("clicking 'Show advanced settings' reveals the advanced section", () => {
    renderModal(true);
    fireEvent.click(screen.getByTestId("advanced-toggle"));
    expect(screen.getByTestId("advanced-section")).toBeDefined();
  });

  it("auto-generates the slug from the title", () => {
    renderModal(true);
    const titleInput = screen.getByTestId(
      "new-deck-title",
    ) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "My Deck Idea" } });

    fireEvent.click(screen.getByTestId("advanced-toggle"));
    const slugInput = screen.getByTestId(
      "new-deck-slug",
    ) as HTMLInputElement;
    expect(slugInput.value).toBe("my-deck-idea");
  });

  it("once the slug is edited, it stops tracking the title", () => {
    renderModal(true);
    fireEvent.click(screen.getByTestId("advanced-toggle"));

    const titleInput = screen.getByTestId(
      "new-deck-title",
    ) as HTMLInputElement;
    const slugInput = screen.getByTestId(
      "new-deck-slug",
    ) as HTMLInputElement;

    fireEvent.change(titleInput, { target: { value: "First title" } });
    expect(slugInput.value).toBe("first-title");

    // User overrides the slug.
    fireEvent.change(slugInput, { target: { value: "custom-slug" } });
    // Title changes again — slug must NOT update.
    fireEvent.change(titleInput, { target: { value: "Second title" } });
    expect(slugInput.value).toBe("custom-slug");
  });

  it("Submit posts the deck and navigates to /admin/decks/<slug>?edit=1", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ meta: { slug: "my-deck" }, slides: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    renderModal(true, onClose);

    fireEvent.change(screen.getByTestId("new-deck-title"), {
      target: { value: "My Deck" },
    });
    fireEvent.submit(screen.getByTestId("new-deck-submit").closest("form")!);

    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(
        "/admin/decks/my-deck?edit=1",
      ),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/decks/my-deck");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.meta.title).toBe("My Deck");
    expect(body.meta.slug).toBe("my-deck");
    // Issue #129: visibility defaults to "public" — most authored decks
    // are intended for the public index. Authors who want private
    // explicitly flip the segmented control.
    expect(body.meta.visibility).toBe("public");
    expect(Array.isArray(body.slides)).toBe(true);
    expect(body.slides).toHaveLength(0);
    expect(onClose).toHaveBeenCalled();
  });

  it("defaults the visibility segmented control to Public", () => {
    renderModal(true);
    fireEvent.click(screen.getByTestId("advanced-toggle"));
    const publicBtn = screen.getByTestId("new-deck-visibility-public");
    const privateBtn = screen.getByTestId("new-deck-visibility-private");
    expect(publicBtn.getAttribute("aria-checked")).toBe("true");
    expect(privateBtn.getAttribute("aria-checked")).toBe("false");
  });

  it("flipping visibility to Private submits visibility=private", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ meta: { slug: "secret-deck" }, slides: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderModal(true);

    fireEvent.change(screen.getByTestId("new-deck-title"), {
      target: { value: "Secret Deck" },
    });
    fireEvent.click(screen.getByTestId("advanced-toggle"));
    fireEvent.click(screen.getByTestId("new-deck-visibility-private"));

    // Selection should flip visually.
    expect(
      screen.getByTestId("new-deck-visibility-private").getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(
      screen.getByTestId("new-deck-visibility-public").getAttribute(
        "aria-checked",
      ),
    ).toBe("false");

    fireEvent.submit(screen.getByTestId("new-deck-submit").closest("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.meta.visibility).toBe("private");
  });

  it("surfaces a server error message inline without closing the modal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "slug already taken" }),
      }),
    );
    const onClose = vi.fn();
    renderModal(true, onClose);

    fireEvent.change(screen.getByTestId("new-deck-title"), {
      target: { value: "Dupe" },
    });
    fireEvent.submit(screen.getByTestId("new-deck-submit").closest("form")!);

    await waitFor(() =>
      expect(screen.getByTestId("new-deck-error").textContent).toBe(
        "slug already taken",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("surfaces a client validation error for an invalid slug", async () => {
    vi.stubGlobal("fetch", vi.fn());
    renderModal(true);

    fireEvent.change(screen.getByTestId("new-deck-title"), {
      target: { value: "Hi" },
    });
    fireEvent.click(screen.getByTestId("advanced-toggle"));
    fireEvent.change(screen.getByTestId("new-deck-slug"), {
      target: { value: "Invalid Slug!" },
    });
    fireEvent.submit(screen.getByTestId("new-deck-submit").closest("form")!);

    await waitFor(() =>
      expect(screen.getByTestId("new-deck-error").textContent).toMatch(
        /kebab-case/,
      ),
    );
  });
});
