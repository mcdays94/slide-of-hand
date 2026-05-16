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

// Mutable map of pending source actions the mocked hook returns. The
// mock reads it on every call so tests can swap the value before
// render. Defaults to empty so existing tests that pre-date issue #246
// continue to assert "no pending pill anywhere" without ceremony.
let mockPendingActions: Record<
  string,
  import("@/lib/pending-source-actions").PendingSourceAction
> = {};
const mockClearPending = vi.fn(async () => {});
const mockRefetchPending = vi.fn(async () => {});
const mockUpsertPending = vi.fn(
  async (action: import("@/lib/pending-source-actions").PendingSourceAction) => {
    mockPendingActions = { ...mockPendingActions, [action.slug]: action };
  },
);
// Issue #250 — reconcile mock. Default behaviour mirrors the real
// hook: on a `reconciled: true` response, the local map drops the
// entry. Tests that exercise the reconcile flow swap the
// implementation per-case.
const mockReconcile = vi.fn(
  async (
    _slug: string,
    _sourceState: "active" | "archived" | "deleted",
  ): Promise<{ reconciled: boolean }> => ({ reconciled: false }),
);

vi.mock("@/lib/use-pending-source-actions", () => ({
  usePendingSourceActions: () => ({
    actions: mockPendingActions,
    isLoading: false,
    clearPending: mockClearPending,
    refetch: mockRefetchPending,
    upsertPending: mockUpsertPending,
    reconcile: mockReconcile,
  }),
}));

// Mutable GitHub OAuth connection state (issue #251). The hook is
// re-read every render so a test can mutate `mockGitHubState` before
// the next interaction to simulate post-OAuth state transitions.
//
// Default state is "disconnected" because that's the most common path
// (a fresh admin without OAuth setup) AND it's the path the gate must
// guard. Tests covering the legacy "not yet wired" stub error must
// explicitly set state="connected" to get past the gate.
let mockGitHubState: "checking" | "connected" | "disconnected" =
  "disconnected";
const mockGitHubRefetch = vi.fn();
const mockGitHubDisconnect = vi.fn();

vi.mock("@/lib/use-github-oauth", () => ({
  useGitHubOAuth: () => ({
    state: mockGitHubState,
    username: mockGitHubState === "connected" ? "alice-gh" : null,
    scopes: [],
    connectedAt: null,
    refetch: mockGitHubRefetch,
    disconnect: mockGitHubDisconnect,
    startUrl: () => "/api/admin/auth/github/start?returnTo=%2Fadmin",
  }),
}));

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
  mockPendingActions = {};
  mockClearPending.mockClear();
  mockRefetchPending.mockClear();
  mockUpsertPending.mockClear();
  mockUpsertPending.mockImplementation(async (action) => {
    mockPendingActions = { ...mockPendingActions, [action.slug]: action };
  });
  mockReconcile.mockClear();
  mockReconcile.mockImplementation(async () => ({ reconciled: false }));
  // Default GitHub OAuth state is "disconnected" so the new source
  // lifecycle gate (#251) intercepts by default. Tests covering the
  // legacy "not yet wired" stub error explicitly flip to "connected".
  mockGitHubState = "disconnected";
  mockGitHubRefetch.mockClear();
  mockGitHubDisconnect.mockClear();
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

  it("build-time (source) active decks DO include a Delete menu item now (gated by typed-slug + GitHub gate, #251)", async () => {
    // Pre-#251 contract was "Source decks have no Delete affordance".
    // Issue #251 lifts that block — source Delete is now exposed but
    // gated by the typed-slug confirm AND the GitHub connect gate.
    mockEntries = [entry("hello", "Hello", "source")];
    const AdminIndex = await loadAdminIndex();
    render(
      <MemoryRouter>
        <AdminIndex />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    expect(screen.getByTestId("lifecycle-menu-delete-hello")).toBeDefined();
  });

  it("renders Delete for BOTH source and KV rows in a mixed list (#251)", async () => {
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
    expect(screen.getByTestId("lifecycle-menu-delete-hello")).toBeDefined();
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

  it("archived source decks expose Restore AND Delete in the lifecycle menu (#251 lifts the prior Delete block)", async () => {
    // Issue #244 originally hid Delete on source decks because
    // there was no backend. Issue #251 introduces a GitHub-PR-backed
    // source-action flow (gated by the connect gate when GitHub is
    // not connected) and exposes Delete on source rows.
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
      screen.getByTestId("lifecycle-menu-delete-retired-source"),
    ).toBeDefined();
  });

  it("active source decks expose Archive AND Delete in the lifecycle menu (#251)", async () => {
    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    expect(screen.getByTestId("lifecycle-menu-archive-hello")).toBeDefined();
    expect(screen.getByTestId("lifecycle-menu-delete-hello")).toBeDefined();
  });

  it("active KV decks expose Archive + Delete in the lifecycle menu (#244)", async () => {
    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    await renderAdmin();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    expect(screen.getByTestId("lifecycle-menu-archive-kv-deck")).toBeDefined();
    expect(screen.getByTestId("lifecycle-menu-delete-kv-deck")).toBeDefined();
  });

  // Issue #245 — KV archive / restore are now wired to real Worker
  // endpoints. Source-backed decks continue to surface the friendly
  // "not yet wired" inline error (their backends ship later — see
  // PRD #242 follow-up slices). The KV ↔ source split lives inside
  // AdminIndex's handlers so the menu shape is identical across both.

  it("KV active Archive: fires POST /api/admin/decks/<slug>/archive and moves card to Archived section", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    await renderAdmin();

    // Pre-flight: card lives in the Active section, no Archived
    // section exists yet.
    expect(screen.getByTestId("admin-active-section").textContent).toMatch(
      /KV Deck/,
    );
    expect(screen.queryByTestId("admin-archived-section")).toBeNull();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-kv-deck"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/decks/kv-deck/archive");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");

    // Local UI update: the card moves to the Archived section without
    // a reload. The Active section no longer contains the deck title.
    await waitFor(() => {
      const archived = screen.queryByTestId("admin-archived-section");
      expect(archived?.textContent).toMatch(/KV Deck/);
      const active = screen.getByTestId("admin-active-section");
      expect(active.textContent).not.toMatch(/KV Deck/);
    });
  });

  it("KV archived Restore: fires POST /api/admin/decks/<slug>/restore and moves card to Active section", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [
      entry("retired-kv", "Retired KV", "kv", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();

    expect(screen.getByTestId("admin-archived-section").textContent).toMatch(
      /Retired KV/,
    );

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-retired-kv"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-restore-retired-kv"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/decks/retired-kv/restore");
    expect((init as RequestInit).method).toBe("POST");

    // After the restore resolves the card lives in Active and the
    // Archived section unmounts (it was the only archived entry).
    await waitFor(() => {
      expect(screen.queryByTestId("admin-archived-section")).toBeNull();
      expect(screen.getByTestId("admin-active-section").textContent).toMatch(
        /Retired KV/,
      );
    });
  });

  it("KV active Archive: surfaces a server error inline without moving the card", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "kv unavailable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-kv-deck"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("archive-error").textContent).toMatch(
        /kv unavailable/,
      ),
    );
    // Card stays in Active; the dialog stays open so the user can retry.
    expect(screen.getByTestId("admin-active-section").textContent).toMatch(
      /KV Deck/,
    );
    expect(screen.queryByTestId("admin-archived-section")).toBeNull();
  });

  it("source-backed Archive (GitHub connected): calls POST /api/admin/source-decks/<slug>/archive and does NOT hit the KV archive endpoint (#247)", async () => {
    // Issue #247 — when GitHub is connected, source-backed Archive
    // now invokes the dedicated source-deck-lifecycle endpoint.
    // The endpoint runs the gated GitHub-PR flow server-side and
    // persists a pending source-action record; the admin UI then
    // refetches the pending list to project the expected state.
    mockGitHubState = "connected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        ok: true,
        pending: {
          slug: "hello",
          action: "archive",
          expectedState: "archived",
          status: "queued",
          jobId: "job-123",
          createdAt: "2026-05-16T12:00:00.000Z",
          updatedAt: "2026-05-16T12:00:00.000Z",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-hello"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/source-decks/hello/archive");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
    // Crucially the KV archive endpoint was NOT hit.
    expect(fetchMock.mock.calls.some(([u]) =>
      String(u).startsWith("/api/admin/decks/"),
    )).toBe(false);
    // And the GitHub gate did NOT open — the user is already connected.
    expect(screen.queryByTestId("github-connect-gate")).toBeNull();
    // The hook's refetch was invoked so the pending pill appears
    // without a full reload.
    await waitFor(() => expect(mockRefetchPending).toHaveBeenCalled());
    expect(mockUpsertPending).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "hello", status: "queued" }),
    );
  });

  it("source-backed Archive queued response closes the modal and projects the card as Queued archive", async () => {
    mockGitHubState = "connected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        ok: true,
        pending: {
          slug: "hello",
          action: "archive",
          expectedState: "archived",
          status: "queued",
          jobId: "job-123",
          createdAt: "2026-05-16T12:00:00.000Z",
          updatedAt: "2026-05-16T12:00:00.000Z",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-hello"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.queryByTestId("confirm-dialog")).toBeNull(),
    );
    const archived = screen.getByTestId("admin-archived-section");
    expect(archived.textContent).toMatch(/Hello/);
    expect(archived.textContent).toMatch(/Queued archive/i);
    expect(screen.queryByTestId("pending-pr-link-hello")).toBeNull();
  });

  it("source-backed Archive (GitHub connected): surfaces a server error inline without closing the dialog (#247)", async () => {
    mockGitHubState = "connected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "GitHub not connected — reconnect and retry." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-hello"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("archive-error").textContent).toMatch(
        /GitHub not connected/i,
      ),
    );
    // The dialog stays open so the user can retry / cancel.
    expect(screen.getByTestId("confirm-dialog")).toBeDefined();
    // refetch was NOT called on failure — there's no new pending
    // record to project.
    expect(mockRefetchPending).not.toHaveBeenCalled();
  });

  it("source-backed Restore (GitHub connected): calls POST /api/admin/source-decks/<slug>/restore and does NOT hit the KV restore endpoint (#248)", async () => {
    // Issue #248 — when GitHub is connected, source-backed Restore
    // invokes the dedicated source-deck-lifecycle restore endpoint.
    // The endpoint runs the gated GitHub-PR flow server-side and
    // persists a pending restore record; the admin UI then refetches
    // the pending list to project the deck back into Active with a
    // Pending merge/deploy pill.
    mockGitHubState = "connected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        prUrl: "https://github.com/mcdays94/slide-of-hand/pull/248",
        prNumber: 248,
        branch: "restore/retired-source-1700000000000",
        action: "restore",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [
      entry("retired-source", "Retired Source", "source", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();

    fireEvent.click(
      screen.getByTestId("lifecycle-menu-trigger-retired-source"),
    );
    fireEvent.click(
      screen.getByTestId("lifecycle-menu-restore-retired-source"),
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/source-decks/retired-source/restore");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
    // Crucially the KV restore endpoint was NOT hit.
    expect(fetchMock.mock.calls.some(([u]) =>
      String(u).startsWith("/api/admin/decks/"),
    )).toBe(false);
    // And the GitHub gate did NOT open — the user is already connected.
    expect(screen.queryByTestId("github-connect-gate")).toBeNull();
    // The hook's refetch was invoked so the pending pill appears
    // without a full reload.
    await waitFor(() => expect(mockRefetchPending).toHaveBeenCalled());
  });

  it("source-backed Restore (GitHub connected): surfaces a server error inline without closing the dialog (#248)", async () => {
    mockGitHubState = "connected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Archive folder src/decks/archive/retired-source/ does not exist on `main`.",
        phase: "archive_missing",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [
      entry("retired-source", "Retired Source", "source", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();

    fireEvent.click(
      screen.getByTestId("lifecycle-menu-trigger-retired-source"),
    );
    fireEvent.click(
      screen.getByTestId("lifecycle-menu-restore-retired-source"),
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("restore-error").textContent).toMatch(
        /does not exist/i,
      ),
    );
    // The dialog stays open so the user can retry / cancel.
    expect(screen.getByTestId("confirm-dialog")).toBeDefined();
    // refetch was NOT called on failure — there's no new pending
    // record to project.
    expect(mockRefetchPending).not.toHaveBeenCalled();
  });

  it("KV archived Delete: uses the typed-slug dialog from the Archived section and removes the card", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [
      entry("retired-kv", "Retired KV", "kv", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-retired-kv"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-delete-retired-kv"));
    // Typed-slug guard from #244 still gates the destructive action.
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "retired-kv" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/decks/retired-kv");
    expect((init as RequestInit).method).toBe("DELETE");
  });
});

// ─── Pending source actions (issue #246 / PRD #242) ──────────────────
// Source-backed decks with a pending GitHub PR action surface a
// Pending pill + PR link + Clear pending button on their card, and
// the pending record's `expectedState` drives placement: pending
// archive / delete → Archived; pending restore → Active. KV-backed
// decks ignore the projection (their lifecycle is immediate from
// PR #245).
describe("AdminIndex — pending source actions (#246)", () => {
  const PR_URL = "https://github.com/mcdays94/slide-of-hand/pull/123";
  function pendingFor(
    slug: string,
    action: "archive" | "restore" | "delete",
  ): import("@/lib/pending-source-actions").PendingSourceAction {
    const expectedState =
      action === "archive"
        ? "archived"
        : action === "restore"
          ? "active"
          : "deleted";
    return {
      slug,
      action,
      prUrl: PR_URL,
      expectedState,
      createdAt: "2026-05-15T11:23:45.000Z",
    };
  }

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

  it("projects pending archive: source deck moves from Active to Archived with a Pending archive pill", async () => {
    mockEntries = [entry("alpha", "Alpha", "source")];
    mockPendingActions = { alpha: pendingFor("alpha", "archive") };
    await renderAdmin();
    const archived = screen.getByTestId("admin-archived-section");
    expect(archived.textContent).toMatch(/Alpha/);
    expect(archived.textContent).toMatch(/Pending archive/i);
    // PR link is rendered with the prUrl.
    const link = screen.getByTestId("pending-pr-link-alpha") as HTMLAnchorElement;
    expect(link.href).toBe(PR_URL);
    expect(link.target).toBe("_blank");
    expect(link.rel).toMatch(/noopener/);
    // Active section, if it renders, must NOT contain Alpha.
    const active = screen.getByTestId("admin-active-section");
    expect(active.textContent).not.toMatch(/Alpha/);
  });

  it("projects pending restore: archived source deck moves from Archived to Active with a Pending restore pill", async () => {
    mockEntries = [
      entry("beta", "Beta", "source", "public", { archived: true }),
    ];
    mockPendingActions = { beta: pendingFor("beta", "restore") };
    await renderAdmin();
    const active = screen.getByTestId("admin-active-section");
    expect(active.textContent).toMatch(/Beta/);
    expect(active.textContent).toMatch(/Pending restore/i);
    // Archived section unmounts entirely when there are no other
    // archived rows.
    expect(screen.queryByTestId("admin-archived-section")).toBeNull();
  });

  it("projects pending delete: source deck stays Archived with a Pending delete pill", async () => {
    mockEntries = [
      entry("gamma", "Gamma", "source", "public", { archived: true }),
    ];
    mockPendingActions = { gamma: pendingFor("gamma", "delete") };
    await renderAdmin();
    const archived = screen.getByTestId("admin-archived-section");
    expect(archived.textContent).toMatch(/Gamma/);
    expect(archived.textContent).toMatch(/Pending delete/i);
  });

  it("projects pending delete from an Active source deck: card moves to Archived with Pending delete copy", async () => {
    // Edge case: the source deck is still Active on disk but a
    // pending delete is open. The card relocates to Archived
    // immediately so the author sees the expected outcome.
    mockEntries = [entry("delta", "Delta", "source")];
    mockPendingActions = { delta: pendingFor("delta", "delete") };
    await renderAdmin();
    const archived = screen.getByTestId("admin-archived-section");
    expect(archived.textContent).toMatch(/Delta/);
    expect(archived.textContent).toMatch(/Pending delete/i);
    const active = screen.getByTestId("admin-active-section");
    expect(active.textContent).not.toMatch(/Delta/);
  });

  it("renders a Clear pending button alongside the pill", async () => {
    mockEntries = [entry("alpha", "Alpha", "source")];
    mockPendingActions = { alpha: pendingFor("alpha", "archive") };
    await renderAdmin();
    expect(screen.getByTestId("pending-clear-alpha")).toBeDefined();
  });

  it("Clear pending invokes the clearPending handler with the slug", async () => {
    mockEntries = [entry("alpha", "Alpha", "source")];
    mockPendingActions = { alpha: pendingFor("alpha", "archive") };
    await renderAdmin();
    fireEvent.click(screen.getByTestId("pending-clear-alpha"));
    await waitFor(() =>
      expect(mockClearPending).toHaveBeenCalledWith("alpha"),
    );
  });

  it("Clear pending surfaces a server error inline next to the pill", async () => {
    mockClearPending.mockImplementationOnce(async () => {
      throw new Error("kv unavailable");
    });
    mockEntries = [entry("alpha", "Alpha", "source")];
    mockPendingActions = { alpha: pendingFor("alpha", "archive") };
    await renderAdmin();
    fireEvent.click(screen.getByTestId("pending-clear-alpha"));
    await waitFor(() =>
      expect(
        screen.getByTestId("pending-clear-error-alpha").textContent,
      ).toMatch(/kv unavailable/),
    );
  });

  it("KV-backed decks ignore pending source action records (no projection, no pill)", async () => {
    // Even if a pending record somehow ends up in KV against a
    // KV-backed deck slug, the admin must NOT project it — the KV
    // deck lifecycle is immediate (PR #245) and projection would
    // misrepresent reality.
    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    mockPendingActions = { "kv-deck": pendingFor("kv-deck", "archive") };
    await renderAdmin();
    // KV-deck stays in Active section despite the pending archive.
    expect(screen.getByTestId("admin-active-section").textContent).toMatch(
      /KV Deck/,
    );
    expect(screen.queryByTestId("admin-archived-section")).toBeNull();
    // No pending pill anywhere.
    expect(screen.queryByTestId("pending-pill-kv-deck")).toBeNull();
  });

  it("source-backed deck with no pending action is unchanged (no pill, normal placement)", async () => {
    mockEntries = [entry("alpha", "Alpha", "source")];
    mockPendingActions = {};
    await renderAdmin();
    expect(screen.queryByTestId("pending-pill-alpha")).toBeNull();
    expect(screen.getByTestId("admin-active-section").textContent).toMatch(
      /Alpha/,
    );
  });

  it("pending pill exposes a data-pending-action attribute carrying the action type", async () => {
    mockEntries = [entry("alpha", "Alpha", "source")];
    mockPendingActions = { alpha: pendingFor("alpha", "delete") };
    await renderAdmin();
    const pill = screen.getByTestId("pending-action-alpha");
    expect(pill.getAttribute("data-pending-action")).toBe("delete");
  });
});

// ─── GitHub connect gate for source lifecycle actions (#251) ─────────
// Source-backed deck lifecycle actions (Archive / Restore / Delete)
// open GitHub draft PRs. If the user is not GitHub-connected, the
// admin must show an app-native gate explaining the dependency. KV-
// backed lifecycle actions DO NOT pass through the gate.
describe("AdminIndex — GitHub connect gate for source actions (#251)", () => {
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

  it("source-backed Archive without GitHub connected: opens the gate and does NOT call the lifecycle backend", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-hello"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );
    // Nothing should have hit the network.
    expect(fetchMock).not.toHaveBeenCalled();
    // And the confirmation dialog should close cleanly (framer-motion's
    // AnimatePresence exits the panel over ~150ms; waitFor lets the
    // exit complete before we assert).
    await waitFor(() =>
      expect(screen.queryByTestId("confirm-dialog")).toBeNull(),
    );
  });

  it("source-backed Restore without GitHub connected: opens the gate and does NOT call the lifecycle backend", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [
      entry("retired-source", "Retired Source", "source", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();

    fireEvent.click(
      screen.getByTestId("lifecycle-menu-trigger-retired-source"),
    );
    fireEvent.click(
      screen.getByTestId("lifecycle-menu-restore-retired-source"),
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("source-backed Delete without GitHub connected: opens the gate AFTER typed-slug confirmation", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Source decks now expose Delete via the menu (gated by the
    // typed-slug guard, then by the GitHub gate). Use an active
    // source deck so the menu surfaces Delete.
    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-delete-hello"));
    // Type the slug so the destructive confirm enables.
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gate contains explanatory copy and a Connect GitHub CTA pointing at the OAuth start URL", async () => {
    mockGitHubState = "disconnected";
    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-hello"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    const gate = await waitFor(() =>
      screen.getByTestId("github-connect-gate"),
    );
    // Explanatory copy mentions draft PRs (the reason GitHub is needed).
    expect(gate.textContent).toMatch(/draft PR/i);
    // Action label + deck title appear in the body so the user
    // remembers what they were trying to do.
    expect(gate.textContent).toMatch(/archive/i);
    expect(gate.textContent).toMatch(/Hello/);
    // Connect CTA carries the OAuth start URL.
    const connect = screen.getByTestId(
      "github-connect-gate-connect",
    ) as HTMLAnchorElement;
    expect(connect.tagName).toBe("A");
    expect(connect.getAttribute("href")).toContain(
      "/api/admin/auth/github/start",
    );
  });

  it("KV-backed Archive does NOT open the gate (and continues to hit the KV endpoint)", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-kv-deck"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/admin/decks/kv-deck/archive",
    );
    // Gate must NOT open for KV lifecycle actions.
    expect(screen.queryByTestId("github-connect-gate")).toBeNull();
  });

  it("KV-backed Restore does NOT open the gate", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [
      entry("retired-kv", "Retired KV", "kv", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-retired-kv"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-restore-retired-kv"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/admin/decks/retired-kv/restore",
    );
    expect(screen.queryByTestId("github-connect-gate")).toBeNull();
  });

  it("KV-backed Delete does NOT open the gate", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-deck"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-delete-kv-deck"));
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "kv-deck" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/decks/kv-deck");
    expect(screen.queryByTestId("github-connect-gate")).toBeNull();
  });

  it("Cancel on the gate closes it (and does not call the backend)", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-hello"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("github-connect-gate-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("github-connect-gate")).toBeNull(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Retry path for Archive: after status flips to connected, Retry invokes the source-archive endpoint and closes the gate on success (#247)", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        prUrl: "https://github.com/mcdays94/slide-of-hand/pull/247",
        prNumber: 247,
        branch: "archive/hello-1700000000000",
        action: "archive",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    const { rerender } = await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-hello"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );

    // Simulate the user completing OAuth in another tab: flip the
    // mocked state and force a re-render so the gate's Retry button
    // surfaces.
    mockGitHubState = "connected";
    const AdminIndex = await loadAdminIndex();
    rerender(
      <SettingsProvider>
        <MemoryRouter>
          <AdminIndex />
        </MemoryRouter>
      </SettingsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate-retry")).toBeDefined(),
    );

    fireEvent.click(screen.getByTestId("github-connect-gate-retry"));

    // Retry hits the dedicated source-archive endpoint.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/source-decks/hello/archive");
    // On success the gate closes — the pending projection takes over
    // the card's visual state via the refetched pending list.
    await waitFor(() =>
      expect(screen.queryByTestId("github-connect-gate")).toBeNull(),
    );
    expect(mockRefetchPending).toHaveBeenCalled();
  });

  it("Retry path for Restore: after status flips to connected, Retry invokes the source-restore endpoint and closes the gate on success (#248)", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        prUrl: "https://github.com/mcdays94/slide-of-hand/pull/248",
        prNumber: 248,
        branch: "restore/retired-source-1700000000000",
        action: "restore",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [
      entry("retired-source", "Retired Source", "source", "public", {
        archived: true,
      }),
    ];
    const { rerender } = await renderAdmin();

    fireEvent.click(
      screen.getByTestId("lifecycle-menu-trigger-retired-source"),
    );
    fireEvent.click(
      screen.getByTestId("lifecycle-menu-restore-retired-source"),
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );

    // Simulate the user completing OAuth in another tab.
    mockGitHubState = "connected";
    const AdminIndex = await loadAdminIndex();
    rerender(
      <SettingsProvider>
        <MemoryRouter>
          <AdminIndex />
        </MemoryRouter>
      </SettingsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate-retry")).toBeDefined(),
    );

    fireEvent.click(screen.getByTestId("github-connect-gate-retry"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/source-decks/retired-source/restore");
    await waitFor(() =>
      expect(screen.queryByTestId("github-connect-gate")).toBeNull(),
    );
    expect(mockRefetchPending).toHaveBeenCalled();
  });

  it("Retry path for Restore: surfaces server error inside the gate on failure (#248)", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Archive folder src/decks/archive/retired-source/ does not exist on `main`.",
        phase: "archive_missing",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [
      entry("retired-source", "Retired Source", "source", "public", {
        archived: true,
      }),
    ];
    const { rerender } = await renderAdmin();

    fireEvent.click(
      screen.getByTestId("lifecycle-menu-trigger-retired-source"),
    );
    fireEvent.click(
      screen.getByTestId("lifecycle-menu-restore-retired-source"),
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );

    mockGitHubState = "connected";
    const AdminIndex = await loadAdminIndex();
    rerender(
      <SettingsProvider>
        <MemoryRouter>
          <AdminIndex />
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.click(screen.getByTestId("github-connect-gate-retry"));
    await waitFor(() =>
      expect(
        screen.getByTestId("github-connect-gate-error").textContent,
      ).toMatch(/does not exist/i),
    );
    expect(screen.getByTestId("github-connect-gate")).toBeDefined();
  });

  it("Retry path for Archive: surfaces server error inside the gate on failure (#247)", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Source folder src/decks/public/hello/ does not exist on `main`." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    const { rerender } = await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-hello"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );

    mockGitHubState = "connected";
    const AdminIndex = await loadAdminIndex();
    rerender(
      <SettingsProvider>
        <MemoryRouter>
          <AdminIndex />
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.click(screen.getByTestId("github-connect-gate-retry"));
    await waitFor(() =>
      expect(
        screen.getByTestId("github-connect-gate-error").textContent,
      ).toMatch(/does not exist/i),
    );
    // Gate stays open on failure.
    expect(screen.getByTestId("github-connect-gate")).toBeDefined();
  });

  it("does NOT call window.confirm anywhere in the source-gate flow", async () => {
    mockGitHubState = "disconnected";
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    vi.stubGlobal("fetch", vi.fn());

    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-archive-hello"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("github-connect-gate-cancel"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("active source decks now expose Delete in the lifecycle menu (gated by typed-slug + GitHub gate)", async () => {
    // Issue #251 lifts the previous block on Delete for source decks.
    // The destructive action is now gated by two layers: typed-slug
    // confirmation, then the GitHub connect gate.
    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    expect(screen.getByTestId("lifecycle-menu-delete-hello")).toBeDefined();
  });
});

// ─── Source delete wired end-to-end (#249) ───────────────────────────
// When GitHub is connected, the source-delete flow no longer surfaces
// the "not yet wired" stub error. It calls
// POST /api/admin/source-decks/<slug>/delete after typed-slug confirm
// and refetches pending records on success.
describe("AdminIndex — source-backed Delete (#249)", () => {
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

  it("connected source-backed active Delete calls the source-delete endpoint after typed-slug confirmation", async () => {
    mockGitHubState = "connected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        prUrl: "https://github.com/mcdays94/slide-of-hand/pull/249",
        prNumber: 249,
        branch: "delete/hello-1700000000000",
        action: "delete",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-delete-hello"));
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/source-decks/hello/delete");
    expect((init as { method: string }).method).toBe("POST");
    // Gate must NOT open — user is already connected.
    expect(screen.queryByTestId("github-connect-gate")).toBeNull();
  });

  it("connected source-backed archived Delete calls the source-delete endpoint after typed-slug confirmation", async () => {
    mockGitHubState = "connected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        prUrl: "https://github.com/mcdays94/slide-of-hand/pull/249",
        prNumber: 249,
        branch: "delete/retired-source-1700000000000",
        action: "delete",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [
      entry("retired-source", "Retired Source", "source", "public", {
        archived: true,
      }),
    ];
    await renderAdmin();

    fireEvent.click(
      screen.getByTestId("lifecycle-menu-trigger-retired-source"),
    );
    fireEvent.click(
      screen.getByTestId("lifecycle-menu-delete-retired-source"),
    );
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "retired-source" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/source-decks/retired-source/delete");
    expect(screen.queryByTestId("github-connect-gate")).toBeNull();
  });

  it("on success, refetches the pending-action list so the projection moves the card to Archived with a Pending delete pill", async () => {
    mockGitHubState = "connected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        prUrl: "https://github.com/mcdays94/slide-of-hand/pull/249",
        prNumber: 249,
        branch: "delete/hello-1700000000000",
        action: "delete",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-delete-hello"));
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(mockRefetchPending).toHaveBeenCalled());
  });

  it("failure surfaces the server's inline error inside the typed-slug dialog", async () => {
    mockGitHubState = "connected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error:
          "Neither src/decks/public/hello/ nor src/decks/archive/hello/ exists on `main`.",
        phase: "source_missing",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-delete-hello"));
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-error").textContent).toMatch(
        /Neither.*public.*archive.*exists/i,
      ),
    );
  });

  it("Retry path for Delete via the gate: after status flips to connected, Retry invokes the source-delete endpoint and closes the gate on success", async () => {
    mockGitHubState = "disconnected";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        prUrl: "https://github.com/mcdays94/slide-of-hand/pull/249",
        prNumber: 249,
        branch: "delete/hello-1700000000000",
        action: "delete",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("hello", "Hello", "source")];
    const { rerender } = await renderAdmin();

    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-hello"));
    fireEvent.click(screen.getByTestId("lifecycle-menu-delete-hello"));
    fireEvent.change(screen.getByTestId("typed-slug-input"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate")).toBeDefined(),
    );

    // Simulate the user completing OAuth in another tab.
    mockGitHubState = "connected";
    const AdminIndex = await loadAdminIndex();
    rerender(
      <SettingsProvider>
        <MemoryRouter>
          <AdminIndex />
        </MemoryRouter>
      </SettingsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("github-connect-gate-retry")).toBeDefined(),
    );

    fireEvent.click(screen.getByTestId("github-connect-gate-retry"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/source-decks/hello/delete");
    await waitFor(() =>
      expect(screen.queryByTestId("github-connect-gate")).toBeNull(),
    );
    expect(mockRefetchPending).toHaveBeenCalled();
  });
});

// ─── Automatic reconciliation (issue #250) ────────────────────────
// Once the deployed source state matches a pending action's
// expectedState, the admin must fire `/reconcile` so the worker
// clears the marker (and, for delete, the source-delete side data).
// Stale pending records — where the source state still does NOT
// match — must stay visible.
describe("AdminIndex — pending reconciliation (#250)", () => {
  const PR_URL = "https://github.com/mcdays94/slide-of-hand/pull/123";
  function pendingFor(
    slug: string,
    action: "archive" | "restore" | "delete",
  ): import("@/lib/pending-source-actions").PendingSourceAction {
    const expectedState =
      action === "archive"
        ? "archived"
        : action === "restore"
          ? "active"
          : "deleted";
    return {
      slug,
      action,
      prUrl: PR_URL,
      expectedState,
      createdAt: "2026-05-15T11:23:45.000Z",
    };
  }

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

  it("reconciles pending archive when the source deck is already archived", async () => {
    // Source state: deck is archived on disk. Pending marker
    // expects archived. The effect should fire reconcile with
    // sourceState=archived.
    mockEntries = [
      entry("alpha", "Alpha", "source", "public", { archived: true }),
    ];
    mockPendingActions = { alpha: pendingFor("alpha", "archive") };
    await renderAdmin();
    await waitFor(() =>
      expect(mockReconcile).toHaveBeenCalledWith("alpha", "archived"),
    );
  });

  it("reconciles pending restore when the source deck is active", async () => {
    mockEntries = [entry("beta", "Beta", "source")];
    mockPendingActions = { beta: pendingFor("beta", "restore") };
    await renderAdmin();
    await waitFor(() =>
      expect(mockReconcile).toHaveBeenCalledWith("beta", "active"),
    );
  });

  it("reconciles pending delete when the source deck has disappeared", async () => {
    // The deck is absent from the entry list — source-deleted.
    mockEntries = [entry("survivor", "Survivor", "source")];
    mockPendingActions = { gamma: pendingFor("gamma", "delete") };
    await renderAdmin();
    await waitFor(() =>
      expect(mockReconcile).toHaveBeenCalledWith("gamma", "deleted"),
    );
  });

  it("does NOT reconcile a stale pending archive (source still active)", async () => {
    // PR is still open: the source hasn't caught up yet. Marker
    // expects archived but source is active. Effect must not fire.
    mockEntries = [entry("alpha", "Alpha", "source")];
    mockPendingActions = { alpha: pendingFor("alpha", "archive") };
    await renderAdmin();
    // Give the effect a chance to run before asserting non-call.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("does NOT reconcile a stale pending restore (source still archived)", async () => {
    mockEntries = [
      entry("beta", "Beta", "source", "public", { archived: true }),
    ];
    mockPendingActions = { beta: pendingFor("beta", "restore") };
    await renderAdmin();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("does NOT reconcile a stale pending delete (source still present)", async () => {
    mockEntries = [
      entry("gamma", "Gamma", "source", "public", { archived: true }),
    ];
    mockPendingActions = { gamma: pendingFor("gamma", "delete") };
    await renderAdmin();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("does NOT fire reconcile for KV-backed decks (lifecycle is immediate, no source PR)", async () => {
    mockEntries = [entry("kv-deck", "KV Deck", "kv")];
    mockPendingActions = { "kv-deck": pendingFor("kv-deck", "archive") };
    await renderAdmin();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("does not duplicate reconcile calls across re-renders for the same slug", async () => {
    // The reconcile fires a single time even when the effect deps
    // change (e.g. unrelated re-render). The in-flight guard tracks
    // the slug until the promise resolves.
    type Resolver = (v: { reconciled: boolean }) => void;
    const resolverRef: { current: Resolver | null } = { current: null };
    mockReconcile.mockImplementationOnce(
      () =>
        new Promise<{ reconciled: boolean }>((res) => {
          resolverRef.current = res;
        }),
    );
    mockEntries = [
      entry("alpha", "Alpha", "source", "public", { archived: true }),
    ];
    mockPendingActions = { alpha: pendingFor("alpha", "archive") };
    const AdminIndex = await loadAdminIndex();
    const view = render(
      <SettingsProvider>
        <MemoryRouter>
          <AdminIndex />
        </MemoryRouter>
      </SettingsProvider>,
    );
    await waitFor(() =>
      expect(mockReconcile).toHaveBeenCalledTimes(1),
    );
    // Force a re-render: mutate the mock entries to add an unrelated
    // row, then re-render the same tree. The mocked hook returns the
    // current `mockEntries`, so the AdminIndex effect re-runs — and
    // the guard must suppress the duplicate reconcile call for the
    // already-in-flight slug.
    mockEntries = [
      entry("alpha", "Alpha", "source", "public", { archived: true }),
      entry("filler", "Filler", "source"),
    ];
    view.rerender(
      <SettingsProvider>
        <MemoryRouter>
          <AdminIndex />
        </MemoryRouter>
      </SettingsProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
      expect(mockReconcile).toHaveBeenCalledTimes(1);
    // Resolve the in-flight promise so React state updates settle
    // before test teardown.
    resolverRef.current?.({ reconciled: true });
  });
});

// ─── Visibility quick-toggle (issue #214) ────────────────────────────
//
// The admin index renders an interactive PUBLIC ↔ PRIVATE pill on
// KV-backed deck cards. Source-backed cards do NOT render the
// interactive pill (their public/private semantics come from source
// folder placement; the static private badge still shows where
// appropriate). The handler:
//
//   1. Fetches the full DataDeck record via
//      `GET /api/admin/decks/<slug>` (Access-gated; in dev injects
//      the placeholder header).
//   2. Mutates `meta.visibility` to the next value.
//   3. POSTs the full record back to the same path (existing upsert).
//   4. Optimistically updates local visibility so the pill flips
//      immediately; on failure, reverts.
describe("AdminIndex — KV visibility quick toggle (#214)", () => {
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

  /**
   * Build a stub fetch that walks the toggle flow:
   *   GET → returns the seeded DataDeck record;
   *   POST → returns 200 with the updated deck.
   */
  function makeToggleFetch(
    slug: string,
    initialVisibility: "public" | "private",
    {
      getOk = true,
      postOk = true,
      postError,
    }: {
      getOk?: boolean;
      postOk?: boolean;
      postError?: string;
    } = {},
  ) {
    const initialDeck = {
      meta: {
        slug,
        title: slug,
        date: "2026-05-01",
        visibility: initialVisibility,
      },
      slides: [
        {
          id: "intro",
          title: "Intro",
          layout: "cover",
          template: "cf-cover-classic",
          values: [],
        },
      ],
    };
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === `/api/admin/decks/${slug}` && method === "GET") {
        if (!getOk) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "kv read failed" }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => initialDeck,
        } as unknown as Response;
      }
      if (url === `/api/admin/decks/${slug}` && method === "POST") {
        if (!postOk) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: postError ?? "kv write failed" }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => initialDeck,
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: "unexpected url" }),
      } as unknown as Response;
    });
  }

  it("renders an enabled visibility toggle for KV-backed PUBLIC decks", async () => {
    mockEntries = [entry("kv-public", "KV Public", "kv", "public")];
    await renderAdmin();
    const toggle = screen.getByTestId("deck-visibility-toggle-kv-public");
    expect(toggle.getAttribute("data-visibility")).toBe("public");
    expect(toggle.textContent).toMatch(/public/i);
  });

  it("renders an enabled visibility toggle for KV-backed PRIVATE decks", async () => {
    mockEntries = [entry("kv-private", "KV Private", "kv", "private")];
    await renderAdmin();
    const toggle = screen.getByTestId("deck-visibility-toggle-kv-private");
    expect(toggle.getAttribute("data-visibility")).toBe("private");
    expect(toggle.textContent).toMatch(/private/i);
  });

  it("source-backed decks do NOT render the interactive visibility toggle", async () => {
    mockEntries = [entry("source-deck", "Source Deck", "source", "public")];
    await renderAdmin();
    expect(
      screen.queryByTestId("deck-visibility-toggle-source-deck"),
    ).toBeNull();
  });

  it("toggling public → private fetches full record, POSTs flipped record, and the pill flips to PRIVATE", async () => {
    const fetchMock = makeToggleFetch("kv-public", "public");
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-public", "KV Public", "kv", "public")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("deck-visibility-toggle-kv-public"));

    await waitFor(() => {
      // First call: GET to fetch the full record.
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(getUrl).toBe("/api/admin/decks/kv-public");
    expect((getInit as RequestInit | undefined)?.method ?? "GET").toBe("GET");

    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(postUrl).toBe("/api/admin/decks/kv-public");
    expect((postInit as RequestInit).method).toBe("POST");
    const body = JSON.parse(String((postInit as RequestInit).body));
    expect(body.meta.visibility).toBe("private");
    expect(body.meta.slug).toBe("kv-public");
    const headers = (postInit as RequestInit).headers as Record<string, string>;
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");
    expect(headers["content-type"]).toMatch(/json/);

    // Pill flips locally.
    await waitFor(() => {
      const toggle = screen.getByTestId("deck-visibility-toggle-kv-public");
      expect(toggle.getAttribute("data-visibility")).toBe("private");
      expect(toggle.textContent).toMatch(/private/i);
    });
  });

  it("toggling private → public similarly flips to PUBLIC", async () => {
    const fetchMock = makeToggleFetch("kv-private", "private");
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-private", "KV Private", "kv", "private")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("deck-visibility-toggle-kv-private"));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const [, postInit] = fetchMock.mock.calls[1];
    const body = JSON.parse(String((postInit as RequestInit).body));
    expect(body.meta.visibility).toBe("public");

    await waitFor(() => {
      const toggle = screen.getByTestId("deck-visibility-toggle-kv-private");
      expect(toggle.getAttribute("data-visibility")).toBe("public");
    });
  });

  it("POST failure reverts the optimistic visibility state and surfaces an inline error", async () => {
    const fetchMock = makeToggleFetch("kv-public", "public", {
      postOk: false,
      postError: "kv unavailable",
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-public", "KV Public", "kv", "public")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("deck-visibility-toggle-kv-public"));

    await waitFor(() =>
      expect(
        screen.getByTestId("visibility-toggle-error-kv-public").textContent,
      ).toMatch(/kv unavailable/),
    );
    // Optimistic flip has been reverted — the toggle reads PUBLIC again.
    const toggle = screen.getByTestId("deck-visibility-toggle-kv-public");
    expect(toggle.getAttribute("data-visibility")).toBe("public");
  });

  it("GET failure surfaces an inline error and does NOT issue a POST", async () => {
    const fetchMock = makeToggleFetch("kv-public", "public", {
      getOk: false,
    });
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-public", "KV Public", "kv", "public")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("deck-visibility-toggle-kv-public"));

    await waitFor(() =>
      expect(
        screen.getByTestId("visibility-toggle-error-kv-public"),
      ).toBeDefined(),
    );
    // Only the GET was attempted; no POST.
    const posts = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(posts.length).toBe(0);
  });

  it("the toggle is rendered on the admin surface and never invokes window.confirm", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    const fetchMock = makeToggleFetch("kv-public", "public");
    vi.stubGlobal("fetch", fetchMock);

    mockEntries = [entry("kv-public", "KV Public", "kv", "public")];
    await renderAdmin();

    fireEvent.click(screen.getByTestId("deck-visibility-toggle-kv-public"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("archived KV decks still render the visibility toggle (toggle is orthogonal to archive lifecycle)", async () => {
    // Archived decks are filtered from the public surface by the
    // archived flag — visibility toggle still works for ergonomics
    // (flipping a future-restored deck's visibility ahead of time).
    mockEntries = [
      entry("retired-kv", "Retired KV", "kv", "public", { archived: true }),
    ];
    await renderAdmin();
    expect(
      screen.getByTestId("deck-visibility-toggle-retired-kv"),
    ).toBeDefined();
  });

  it("does NOT regress the archive/delete lifecycle menu — both still open on the same card", async () => {
    mockEntries = [entry("kv-public", "KV Public", "kv", "public")];
    await renderAdmin();
    // Toggle is present.
    expect(
      screen.getByTestId("deck-visibility-toggle-kv-public"),
    ).toBeDefined();
    // Lifecycle menu still opens to Archive + Delete.
    fireEvent.click(screen.getByTestId("lifecycle-menu-trigger-kv-public"));
    expect(
      screen.getByTestId("lifecycle-menu-archive-kv-public"),
    ).toBeDefined();
    expect(
      screen.getByTestId("lifecycle-menu-delete-kv-public"),
    ).toBeDefined();
  });
});
