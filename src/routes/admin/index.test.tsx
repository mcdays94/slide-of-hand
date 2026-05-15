/**
 * Tests for the admin deck index — `/admin` (issue #130).
 *
 * Two flows under test:
 *   1. **Gating**: build-time (source) decks must NOT render a trashcan
 *      affordance. They live in code and cannot be deleted via the UI.
 *      KV-backed decks DO render a trashcan (hover-revealed).
 *   2. **Delete flow**: hover → click trashcan → confirm dialog →
 *      DELETE /api/admin/decks/<slug> → list refetches → row gone.
 *
 * We mock `useAdminDataDeckList` so we control exactly which entries
 * the page renders, regardless of the build-time registry's contents.
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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RegistryEntry } from "@/lib/decks-registry";
import { SettingsProvider } from "@/framework/viewer/useSettings";
import { STORAGE_KEY } from "@/lib/settings";

// Mutable list of entries the mocked hook returns. The mock reads it on
// every call so tests can swap the value between re-fetches.
let mockEntries: RegistryEntry[] = [];

vi.mock("@/lib/decks-registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/decks-registry")>(
    "@/lib/decks-registry",
  );
  return {
    ...actual,
    useAdminDataDeckList: () => ({
      entries: mockEntries,
      isLoading: false,
    }),
  };
});

const ORIGINAL_HOSTNAME = window.location.hostname;
function setHostname(value: string) {
  Object.defineProperty(window.location, "hostname", {
    value,
    configurable: true,
  });
}

async function loadAdminIndex() {
  const mod = await import("@/routes/admin/index");
  return mod.default;
}

function entry(
  slug: string,
  title: string,
  source: "source" | "kv",
  visibility: "public" | "private" = "public",
  extraMeta: { draft?: boolean } = {},
): RegistryEntry {
  return {
    visibility,
    folder: slug,
    meta: {
      slug,
      title,
      date: "2026-05-01",
      ...extraMeta,
    },
    source,
  };
}

beforeEach(() => {
  setHostname("localhost");
  mockEntries = [];
  window.localStorage.clear();
});

afterEach(() => {
  setHostname(ORIGINAL_HOSTNAME);
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("AdminIndex — delete affordance gating (#130)", () => {
  it("KV-backed decks render a trashcan delete button", async () => {
    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("delete-deck-kv-deck")).toBeDefined();
  });

  it("build-time (source) decks do NOT render a trashcan", async () => {
    mockEntries = [entry("hello", "Hello", "source")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("delete-deck-hello")).toBeNull();
  });

  it("renders trashcan ONLY for the KV row in a mixed list", async () => {
    mockEntries = [
      entry("hello", "Hello", "source"),
      entry("kv-deck", "KV Deck", "kv"),
    ];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("delete-deck-hello")).toBeNull();
    expect(screen.getByTestId("delete-deck-kv-deck")).toBeDefined();
  });
});

describe("AdminIndex — delete flow (#130)", () => {
  it("clicking the trashcan opens the confirm dialog with the deck title", async () => {
    mockEntries = [entry("kv-deck", "My KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("delete-deck-kv-deck"));
    expect(screen.getByTestId("confirm-dialog")).toBeDefined();
    // The body should reference the deck title so the user knows
    // which deck they're about to delete.
    expect(screen.getByTestId("confirm-dialog").textContent).toMatch(
      /My KV Deck/,
    );
  });

  it("Cancel closes the dialog without firing a DELETE request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-deck", "My KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("delete-deck-kv-deck"));
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("confirm-dialog")).toBeNull(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Delete fires DELETE /api/admin/decks/<slug> with auth headers in dev", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-deck", "My KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("delete-deck-kv-deck"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/decks/kv-deck");
    expect((init as RequestInit).method).toBe("DELETE");
    const headers = (init as RequestInit).headers as Record<string, string>;
    // Dev (localhost) injects the placeholder Access header so the
    // Worker's `requireAccessAuth` accepts the call under `wrangler dev`.
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
  });

  it("surfaces a server error inline without closing the dialog", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "kv unavailable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-deck", "My KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("delete-deck-kv-deck"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-error").textContent).toMatch(
        /kv unavailable/,
      ),
    );
    // Dialog stays open so the user can retry or cancel.
    expect(screen.getByTestId("confirm-dialog")).toBeDefined();
  });

  it("does NOT alert() on failure (inline error surface only)", async () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "forbidden" }),
      }),
    );

    mockEntries = [entry("kv-deck", "My KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("delete-deck-kv-deck"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-error")).toBeDefined(),
    );
    expect(alertMock).not.toHaveBeenCalled();
  });
});

// ─── Draft filter toggle (issue #191) ────────────────────────────────
// The admin index renders a small "Show drafts" / "Hide drafts"
// segmented toggle in the chrome. Toggling persists via `settings.ts`
// (`showDrafts`) and re-renders the grid so drafts (decks with
// `meta.draft === true`) are hidden when the user opts out. Default:
// `showDrafts === true` so admin sees everything on first paint.
describe("AdminIndex — draft filter toggle (#191)", () => {
  async function renderAdmin() {
    const AdminIndex = await loadAdminIndex();
    return render(
      <SettingsProvider>
        <MemoryRouter>
          <AdminIndex />
        </MemoryRouter>
      </SettingsProvider>,
    );
  }

  it("renders the draft-filter toggle in the chrome", async () => {
    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();
    expect(screen.getByTestId("admin-draft-filter")).toBeDefined();
  });

  it("default state is 'Show drafts' (showDrafts === true)", async () => {
    mockEntries = [
      entry("published", "Published", "source"),
      entry("a-draft", "A Draft", "source", "public", { draft: true }),
    ];
    await renderAdmin();
    // Both decks are visible by default.
    expect(screen.getByText("Published")).toBeDefined();
    expect(screen.getByText("A Draft")).toBeDefined();
    // The "show drafts" segment is the active one.
    const showBtn = screen.getByTestId("admin-draft-filter-show");
    expect(showBtn.getAttribute("aria-checked")).toBe("true");
  });

  it("renders all decks when showDrafts === true (including drafts)", async () => {
    mockEntries = [
      entry("published", "Published", "source"),
      entry("a-draft", "A Draft", "source", "public", { draft: true }),
      entry("another", "Another", "kv", "private", { draft: true }),
    ];
    await renderAdmin();
    expect(screen.getByText("Published")).toBeDefined();
    expect(screen.getByText("A Draft")).toBeDefined();
    expect(screen.getByText("Another")).toBeDefined();
  });

  it("hides drafts when showDrafts === false; keeps non-drafts visible", async () => {
    mockEntries = [
      entry("published", "Published", "source"),
      entry("legacy", "Legacy", "source"),
      entry("a-draft", "A Draft", "source", "public", { draft: true }),
    ];
    await renderAdmin();
    // Toggle to "Hide drafts".
    act(() => {
      fireEvent.click(screen.getByTestId("admin-draft-filter-hide"));
    });
    expect(screen.getByText("Published")).toBeDefined();
    expect(screen.getByText("Legacy")).toBeDefined();
    expect(screen.queryByText("A Draft")).toBeNull();
  });

  it("decks with `draft: false` or undefined always show even when hiding drafts", async () => {
    mockEntries = [
      entry("explicit-false", "Explicit False", "source", "public", {
        draft: false,
      }),
      entry("undefined-draft", "Undefined Draft", "source"),
      entry("real-draft", "Real Draft", "source", "public", { draft: true }),
    ];
    await renderAdmin();
    act(() => {
      fireEvent.click(screen.getByTestId("admin-draft-filter-hide"));
    });
    expect(screen.getByText("Explicit False")).toBeDefined();
    expect(screen.getByText("Undefined Draft")).toBeDefined();
    expect(screen.queryByText("Real Draft")).toBeNull();
  });

  it("toggle persists to localStorage", async () => {
    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();
    act(() => {
      fireEvent.click(screen.getByTestId("admin-draft-filter-hide"));
    });
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(
      (JSON.parse(raw!) as { showDrafts?: boolean }).showDrafts,
    ).toBe(false);
  });

  it("restores persisted `showDrafts === false` on next mount", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showDrafts: false }),
    );
    mockEntries = [
      entry("published", "Published", "source"),
      entry("a-draft", "A Draft", "source", "public", { draft: true }),
    ];
    await renderAdmin();
    // Draft should be hidden from the first paint.
    expect(screen.getByText("Published")).toBeDefined();
    expect(screen.queryByText("A Draft")).toBeNull();
    // And the "hide drafts" segment is active.
    const hideBtn = screen.getByTestId("admin-draft-filter-hide");
    expect(hideBtn.getAttribute("aria-checked")).toBe("true");
  });

  it("deck count reflects the filtered set when hiding drafts", async () => {
    mockEntries = [
      entry("published", "Published", "source"),
      entry("legacy", "Legacy", "source"),
      entry("a-draft", "A Draft", "source", "public", { draft: true }),
    ];
    await renderAdmin();
    // 3 decks visible by default.
    expect(screen.getByText(/3 decks available/)).toBeDefined();
    act(() => {
      fireEvent.click(screen.getByTestId("admin-draft-filter-hide"));
    });
    // 2 decks visible after hiding the draft.
    expect(screen.getByText(/2 decks available/)).toBeDefined();
  });
});
