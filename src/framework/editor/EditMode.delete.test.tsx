/**
 * Issue #130: Delete-deck affordance in the EditMode toolbar.
 *
 * Adds a "Delete deck" button next to Save / Reset / Close. Clicking it
 * opens the shared `<ConfirmDialog>`; confirming hits
 * `DELETE /api/admin/decks/<slug>` (already wired in `worker/decks.ts`)
 * and on success navigates back to `/admin`.
 *
 * The button is always present in EditMode — by definition, you only
 * enter EditMode for KV-backed decks (build-time decks bypass this
 * branch in `src/routes/admin/decks.$slug.tsx`), so there's no extra
 * gating to do here.
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
import { EditMode } from "./EditMode";
import type { DataDeck } from "@/lib/deck-record";

const ORIGINAL_HOSTNAME = window.location.hostname;
function setHostname(value: string) {
  Object.defineProperty(window.location, "hostname", {
    value,
    configurable: true,
  });
}

function sampleDeck(): DataDeck {
  return {
    meta: {
      slug: "hello",
      title: "Hello deck",
      date: "2026-05-01",
      visibility: "private",
    },
    slides: [
      {
        id: "intro",
        template: "default",
        slots: {
          title: { kind: "text", value: "Intro" },
          body: { kind: "richtext", value: "Body text" },
        },
      },
    ],
  };
}

function PathWitness() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname + location.search}</div>;
}

/**
 * Render EditMode with a configurable fetch handler — first call(s)
 * resolve the deck load + any save round-trips through `defaultLoad`,
 * the test can additionally provide `onDelete` for the DELETE.
 *
 * The simplest approach: a sequential mock. The initial GET fires on
 * mount; the DELETE fires when the user confirms. We point both at the
 * same vi.fn but inspect by method.
 */
function makeFetchMock(deleteResponse: Partial<Response> | Error) {
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      if (deleteResponse instanceof Error) throw deleteResponse;
      return deleteResponse as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => sampleDeck(),
    } as unknown as Response;
  });
}

function renderEditMode() {
  return render(
    <MemoryRouter initialEntries={["/admin/decks/hello?edit=1"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <PathWitness />
              <EditMode slug="hello" />
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

describe("<EditMode> — delete deck (#130)", () => {
  it("renders a Delete deck button in the toolbar", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ ok: true, status: 204 } as Response),
    );
    renderEditMode();
    await waitFor(() => screen.getByTestId("edit-delete"));
    expect(screen.getByTestId("edit-delete")).toBeDefined();
  });

  it("clicking Delete deck opens the confirm dialog with the deck title", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ ok: true, status: 204 } as Response),
    );
    renderEditMode();
    await waitFor(() => screen.getByTestId("edit-delete"));

    fireEvent.click(screen.getByTestId("edit-delete"));
    expect(screen.getByTestId("confirm-dialog")).toBeDefined();
    expect(screen.getByTestId("confirm-dialog").textContent).toMatch(
      /Hello deck/,
    );
  });

  it("Cancel closes the dialog without firing a DELETE", async () => {
    const fetchMock = makeFetchMock({ ok: true, status: 204 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderEditMode();
    await waitFor(() => screen.getByTestId("edit-delete"));

    fireEvent.click(screen.getByTestId("edit-delete"));
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("confirm-dialog")).toBeNull(),
    );

    const deleteCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it("Confirm fires DELETE /api/admin/decks/<slug> with auth headers and navigates to /admin", async () => {
    const fetchMock = makeFetchMock({ ok: true, status: 204 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderEditMode();
    await waitFor(() => screen.getByTestId("edit-delete"));

    fireEvent.click(screen.getByTestId("edit-delete"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
    });

    const deleteCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
    )!;
    const [url, init] = deleteCall;
    expect(url).toBe("/api/admin/decks/hello");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["cf-access-authenticated-user-email"]).toBe("dev@local");

    // Successful delete → navigate back to /admin.
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/admin"),
    );
  });

  it("surfaces a server error inline without navigating", async () => {
    const fetchMock = makeFetchMock({
      ok: false,
      status: 500,
      json: async () => ({ error: "kv unavailable" }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderEditMode();
    await waitFor(() => screen.getByTestId("edit-delete"));

    fireEvent.click(screen.getByTestId("edit-delete"));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-error").textContent).toMatch(
        /kv unavailable/,
      ),
    );

    // Still on the edit page — no navigation.
    expect(screen.getByTestId("path").textContent).toBe(
      "/admin/decks/hello?edit=1",
    );
  });
});
