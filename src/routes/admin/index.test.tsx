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
  extraMeta: { draft?: boolean; archived?: boolean } = {},
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

describe("AdminIndex — delete affordance gating (#130, updated by #244)", () => {
  it("KV-backed active decks include a Delete menu item", async () => {
    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );
    // The lifecycle menu trigger is rendered; clicking it surfaces the
    // Delete item.
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    expect(screen.getByTestId("lifecycle-menu-delete-kv-deck")).toBeDefined();
  });

  it("build-time (source) active decks do NOT include a Delete menu item", async () => {
    mockEntries = [entry("hello", "Hello", "source")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );
    // Source decks still get a lifecycle menu (Archive is wired) but
    // Delete is not present.
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    expect(screen.queryByTestId("lifecycle-menu-delete-hello")).toBeNull();
  });

  it("renders Delete ONLY for the KV row in a mixed list", async () => {
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
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    expect(screen.queryByTestId("lifecycle-menu-delete-hello")).toBeNull();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    expect(screen.getByTestId("lifecycle-menu-delete-kv-deck")).toBeDefined();
  });
});

describe("AdminIndex — delete flow (#130, updated for #244 typed-slug)", () => {
  /**
   * Issue #244 replaces the single-click trashcan with a lifecycle
   * action menu and a typed-slug destructive confirmation. Each test
   * walks the canonical flow:
   *   1. Click the menu trigger to open the menu.
   *   2. Click the Delete menu item to open the typed-slug dialog.
   *   3. Type the slug into the typed-slug input.
   *   4. Click confirm.
   * The legacy KV delete behaviour (DELETE /api/admin/decks/<slug> +
   * reload) is preserved end-to-end.
   */
  function openDeleteDialog(slug: string) {
    fireEvent.click(screen.getByTestId(`lifecycle-menu-trigger-${slug}`));
    fireEvent.click(screen.getByTestId(`lifecycle-menu-delete-${slug}`));
  }
  function typeSlug(slug: string) {
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: slug },
    });
  }

  it("clicking Delete in the menu opens the typed-slug dialog with the deck title", async () => {
    mockEntries = [entry("kv-deck", "My KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    openDeleteDialog("kv-deck");
    expect(screen.getByTestId("confirm-dialog")).toBeDefined();
    // The body references the deck title.
    expect(screen.getByTestId("confirm-dialog").textContent).toMatch(
      /My KV Deck/,
    );
    // Typed-slug guard is present.
    expect(screen.getByTestId("typed-slug-input")).toBeDefined();
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

    openDeleteDialog("kv-deck");
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("confirm-dialog")).toBeNull(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Confirm without typing the slug does NOT fire a DELETE request (typed-slug guard)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-deck", "My KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );

    openDeleteDialog("kv-deck");
    // Click confirm BEFORE typing — disabled button should swallow it.
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Delete fires DELETE /api/admin/decks/<slug> with auth headers in dev once the slug is typed", async () => {
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

    openDeleteDialog("kv-deck");
    typeSlug("kv-deck");
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

    openDeleteDialog("kv-deck");
    typeSlug("kv-deck");
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

    openDeleteDialog("kv-deck");
    typeSlug("kv-deck");
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-error")).toBeDefined(),
    );
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("does NOT call window.confirm anywhere in the delete flow", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 204 }),
    );

    mockEntries = [entry("kv-deck", "My KV Deck", "kv")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );

    openDeleteDialog("kv-deck");
    typeSlug("kv-deck");
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(confirmSpy).not.toHaveBeenCalled());
    confirmSpy.mockRestore();
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

// ─── Archived section (issue #243 / PRD #242) ────────────────────────
// The admin index splits decks into two sections:
//   - Active: non-archived decks (subject to the showDrafts toggle).
//   - Archived: decks with meta.archived === true (always visible).
// Active renders first, Archived second.
describe("AdminIndex — Archived section (#243)", () => {
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

  it("renders an Archived section when at least one entry is archived", async () => {
    mockEntries = [
      entry("active-one", "Active One", "source"),
      entry("retired-one", "Retired One", "source", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();
    expect(screen.getByTestId("admin-archived-section")).toBeDefined();
    // The active section is also rendered.
    expect(screen.getByTestId("admin-active-section")).toBeDefined();
  });

  it("does NOT render the Archived section when no entries are archived", async () => {
    mockEntries = [
      entry("active-one", "Active One", "source"),
      entry("active-two", "Active Two", "kv"),
    ];
    await renderAdmin();
    expect(screen.queryByTestId("admin-archived-section")).toBeNull();
  });

  it("places archived source decks in the Archived section", async () => {
    mockEntries = [
      entry("active-one", "Active One", "source"),
      entry("retired-source", "Retired Source", "source", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();
    const archived = screen.getByTestId("admin-archived-section");
    expect(archived.textContent).toMatch(/Retired Source/);
    // Active deck must NOT appear inside the Archived section.
    expect(archived.textContent).not.toMatch(/Active One/);
  });

  it("places KV-backed archived decks in the Archived section", async () => {
    mockEntries = [
      entry("active-one", "Active One", "source"),
      entry("retired-kv", "Retired KV", "kv", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();
    const archived = screen.getByTestId("admin-archived-section");
    expect(archived.textContent).toMatch(/Retired KV/);
  });

  it("Active first, Archived below", async () => {
    mockEntries = [
      entry("retired-one", "Retired One", "source", "public", {
        archived: true,
      }),
      entry("active-one", "Active One", "source"),
    ];
    await renderAdmin();
    const active = screen.getByTestId("admin-active-section");
    const archived = screen.getByTestId("admin-archived-section");
    // Active must appear before Archived in document order.
    expect(active.compareDocumentPosition(archived) &
      Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("archived wins over draft: a deck with both flags lives in Archived only", async () => {
    mockEntries = [
      entry("active-one", "Active One", "source"),
      entry("both-flags", "Both Flags", "source", "public", {
        draft: true,
        archived: true,
      }),
    ];
    await renderAdmin();
    const active = screen.getByTestId("admin-active-section");
    const archived = screen.getByTestId("admin-archived-section");
    expect(archived.textContent).toMatch(/Both Flags/);
    expect(active.textContent).not.toMatch(/Both Flags/);
  });

  it("showDrafts toggle does NOT hide archived decks", async () => {
    mockEntries = [
      entry("active-published", "Active Published", "source"),
      entry("active-draft", "Active Draft", "source", "public", {
        draft: true,
      }),
      entry("retired-and-draft", "Retired And Draft", "source", "public", {
        draft: true,
        archived: true,
      }),
    ];
    await renderAdmin();
    // Toggle to "Hide drafts".
    act(() => {
      fireEvent.click(screen.getByTestId("admin-draft-filter-hide"));
    });
    // Active draft should be hidden. Archived-and-draft must STILL be
    // visible because the showDrafts filter only applies to Active.
    expect(screen.queryByText("Active Draft")).toBeNull();
    expect(screen.getByText("Retired And Draft")).toBeDefined();
  });

  it("renders helper copy that explains archived behavior", async () => {
    mockEntries = [
      entry("retired-one", "Retired One", "source", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();
    const archived = screen.getByTestId("admin-archived-section");
    // The heading + helper copy live inside the section.
    expect(archived.textContent).toMatch(/Archived/);
    // Cue users that the public surface 404s these decks.
    expect(archived.textContent).toMatch(/not found|404|return/i);
  });

  it("archived KV decks expose Restore + Delete in the lifecycle menu (#244)", async () => {
    // Issue #244 introduces the lifecycle action menu. Archived KV
    // decks see Restore (neutral recovery) + Delete (destructive,
    // typed-slug guarded). Archive is not offered — the deck is
    // already archived. The real backends for both ship later
    // (PR #245 for KV).
    mockEntries = [
      entry("retired-kv", "Retired KV", "kv", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-retired-kv"));
    expect(
      screen.getByTestId("lifecycle-menu-restore-retired-kv"),
    ).toBeDefined();
    expect(
      screen.getByTestId("lifecycle-menu-delete-retired-kv"),
    ).toBeDefined();
    expect(
      screen.queryByTestId("lifecycle-menu-archive-retired-kv"),
    ).toBeNull();
  });

  it("archived source decks expose Restore (not Delete) in the lifecycle menu (#244)", async () => {
    // Source decks do not yet have a runtime Delete backend
    // (PR #247-249 ship the GitHub PR flow). The Restore action
    // still appears via the UI shell — its real backend is staged
    // for a later slice and the stub surfaces an inline error if the
    // user confirms.
    mockEntries = [
      entry("retired-source", "Retired Source", "source", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();
    fireEvent.click(
      screen.getByTestId("lifecycle-menu-trigger-retired-source"),
    );
    expect(
      screen.getByTestId("lifecycle-menu-restore-retired-source"),
    ).toBeDefined();
    expect(
      screen.queryByTestId("lifecycle-menu-delete-retired-source"),
    ).toBeNull();
  });

  it("active source decks expose Archive (not Delete) in the lifecycle menu (#244)", async () => {
    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    expect(screen.getByTestId("lifecycle-menu-archive-hello")).toBeDefined();
    expect(screen.queryByTestId("lifecycle-menu-delete-hello")).toBeNull();
  });

  it("active KV decks expose Archive + Delete in the lifecycle menu (#244)", async () => {
    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    await renderAdmin();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    expect(screen.getByTestId("lifecycle-menu-archive-kv-deck")).toBeDefined();
    expect(screen.getByTestId("lifecycle-menu-delete-kv-deck")).toBeDefined();
  });

  it("Archive confirmation in this slice surfaces a 'not yet wired' inline error (no real backend)", async () => {
    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    await renderAdmin();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-kv-deck"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("archive-error").textContent).toMatch(
        /not wired|follow-up/i,
      ),
    );
  });

  it("Restore confirmation in this slice surfaces a 'not yet wired' inline error (no real backend)", async () => {
    mockEntries = [
      entry("retired-kv", "Retired KV", "kv", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-retired-kv"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-restore-retired-kv"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("restore-error").textContent).toMatch(
        /not wired|follow-up/i,
      ),
    );
  });
});
