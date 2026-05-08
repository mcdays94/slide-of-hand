/**
 * Component tests for `<EditMode>`.
 *
 * The component composes `useDeckEditor` (network-driven) with the
 * slot editors. We stub `fetch` to control the loaded deck and assert
 * against the rendered split-view + interactions.
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
import { MemoryRouter } from "react-router-dom";
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

function renderEditMode() {
  return render(
    <MemoryRouter initialEntries={["/admin/decks/hello?edit=1"]}>
      <EditMode slug="hello" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setHostname("localhost");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleDeck(),
    }),
  );
});

afterEach(() => {
  setHostname(ORIGINAL_HOSTNAME);
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("<EditMode> — layout", () => {
  it("renders the split-view (preview + editor) once loaded", async () => {
    renderEditMode();
    await waitFor(() =>
      expect(screen.queryByText("Loading deck…")).toBeNull(),
    );
    expect(screen.getByTestId("edit-preview")).toBeDefined();
    expect(screen.getByTestId("edit-editor")).toBeDefined();
  });

  it("shows the deck title in the toolbar", async () => {
    renderEditMode();
    await waitFor(() => screen.getByText("Hello deck"));
    expect(screen.getByText("Hello deck")).toBeDefined();
  });

  it("shows a 1 of 1 slide indicator for a one-slide deck", async () => {
    renderEditMode();
    await waitFor(() => screen.getByTestId("slide-indicator"));
    expect(screen.getByTestId("slide-indicator").textContent).toBe("1 of 1");
  });

  it("renders the slot editors for the current slide", async () => {
    renderEditMode();
    await waitFor(() => screen.getByTestId("slot-input-title"));
    expect(screen.getByTestId("slot-input-title")).toBeDefined();
    expect(screen.getByTestId("slot-textarea-body")).toBeDefined();
  });
});

describe("<EditMode> — editing", () => {
  it("typing in a text slot updates the draft + dirty indicator", async () => {
    renderEditMode();
    const input = (await waitFor(() =>
      screen.getByTestId("slot-input-title"),
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    expect(input.value).toBe("Renamed");
    expect(screen.getByTestId("dirty-indicator")).toBeDefined();
  });

  it("Save button is disabled when not dirty", async () => {
    renderEditMode();
    const save = (await waitFor(() =>
      screen.getByTestId("edit-save"),
    )) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("Save button posts the draft and reflects 'Saved'", async () => {
    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleDeck(),
      })
      // POST
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleDeck(),
      })
      // refetch GET
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleDeck(),
      });
    vi.stubGlobal("fetch", fetchMock);

    renderEditMode();
    const input = (await waitFor(() =>
      screen.getByTestId("slot-input-title"),
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });

    const save = screen.getByTestId("edit-save") as HTMLButtonElement;
    fireEvent.click(save);

    await waitFor(() =>
      expect(screen.getByTestId("save-status").textContent).toBe("Saved"),
    );

    // POST went out with the renamed draft.
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.slides[0].slots.title.value).toBe("Renamed");
  });

  it("Reset reverts the draft", async () => {
    renderEditMode();
    const input = (await waitFor(() =>
      screen.getByTestId("slot-input-title"),
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "X" } });
    expect(input.value).toBe("X");
    const reset = screen.getByTestId("edit-reset") as HTMLButtonElement;
    fireEvent.click(reset);
    await waitFor(() => expect(input.value).toBe("Intro"));
    expect(screen.queryByTestId("dirty-indicator")).toBeNull();
  });
});

describe("<EditMode> — adding slides", () => {
  it("adding a slide via the picker increases the slide count", async () => {
    renderEditMode();
    await waitFor(() => screen.getByTestId("add-slide-template"));
    const select = screen.getByTestId(
      "add-slide-template",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "two-column" } });

    await waitFor(() =>
      expect(screen.getByTestId("slide-indicator").textContent).toBe("2 of 2"),
    );
  });

  it("adding a slide auto-selects it (the new slide is current)", async () => {
    renderEditMode();
    await waitFor(() => screen.getByTestId("add-slide-template"));
    const select = screen.getByTestId(
      "add-slide-template",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "two-column" } });

    // two-column has title, left, right slots — so we expect three editors.
    await waitFor(() => screen.getByTestId("slot-input-title"));
    expect(screen.getByTestId("slot-textarea-left")).toBeDefined();
    expect(screen.getByTestId("slot-textarea-right")).toBeDefined();
  });
});

describe("<EditMode> — deck metadata panel", () => {
  it("renders a Settings trigger button in the toolbar", async () => {
    renderEditMode();
    await waitFor(() => screen.getByTestId("edit-meta-toggle"));
    expect(screen.getByTestId("edit-meta-toggle")).toBeDefined();
  });

  it("the metadata panel is hidden by default", async () => {
    renderEditMode();
    await waitFor(() => screen.getByTestId("edit-meta-toggle"));
    expect(screen.queryByTestId("deck-meta-panel")).toBeNull();
  });

  it("clicking Settings opens the metadata panel", async () => {
    renderEditMode();
    const trigger = (await waitFor(() =>
      screen.getByTestId("edit-meta-toggle"),
    )) as HTMLButtonElement;
    fireEvent.click(trigger);
    await waitFor(() => screen.getByTestId("deck-meta-panel"));
    expect(screen.getByTestId("deck-meta-panel")).toBeDefined();
  });

  it("editing the title in the panel updates the draft + dirty indicator", async () => {
    renderEditMode();
    fireEvent.click(
      (await waitFor(() =>
        screen.getByTestId("edit-meta-toggle"),
      )) as HTMLButtonElement,
    );
    const titleInput = (await waitFor(() =>
      screen.getByTestId("deck-meta-title"),
    )) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Renamed Deck" } });
    expect(titleInput.value).toBe("Renamed Deck");
    expect(screen.getByTestId("dirty-indicator")).toBeDefined();
  });

  it("flipping visibility to public marks the deck dirty and updates the draft", async () => {
    renderEditMode();
    fireEvent.click(
      (await waitFor(() =>
        screen.getByTestId("edit-meta-toggle"),
      )) as HTMLButtonElement,
    );
    const pub = (await waitFor(() =>
      screen.getByTestId("deck-meta-visibility-public"),
    )) as HTMLInputElement;
    fireEvent.click(pub);
    expect(pub.checked).toBe(true);
    expect(screen.getByTestId("dirty-indicator")).toBeDefined();
  });

  it("clicking Close on the panel hides it (panel disappears)", async () => {
    renderEditMode();
    fireEvent.click(
      (await waitFor(() =>
        screen.getByTestId("edit-meta-toggle"),
      )) as HTMLButtonElement,
    );
    await waitFor(() => screen.getByTestId("deck-meta-panel"));
    fireEvent.click(screen.getByTestId("deck-meta-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("deck-meta-panel")).toBeNull(),
    );
  });
});

describe("<EditMode> — validation banner", () => {
  it("clicking Save with an invalid draft surfaces a validation banner and skips POST", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleDeck(),
      });
    vi.stubGlobal("fetch", fetchMock);

    renderEditMode();
    // Open the metadata panel and blank out the title — that's an
    // invalid `meta.title` per validateDataDeck.
    fireEvent.click(
      (await waitFor(() =>
        screen.getByTestId("edit-meta-toggle"),
      )) as HTMLButtonElement,
    );
    const titleInput = (await waitFor(() =>
      screen.getByTestId("deck-meta-title"),
    )) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "" } });

    fireEvent.click(screen.getByTestId("edit-save"));

    await waitFor(() => screen.getByTestId("validation-banner"));
    const errors = screen.getAllByTestId("validation-error");
    expect(errors.length).toBeGreaterThan(0);
    // No POST issued.
    const postCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCalls).toHaveLength(0);
  });

  it("Reset clears the validation banner", async () => {
    renderEditMode();
    fireEvent.click(
      (await waitFor(() =>
        screen.getByTestId("edit-meta-toggle"),
      )) as HTMLButtonElement,
    );
    const titleInput = (await waitFor(() =>
      screen.getByTestId("deck-meta-title"),
    )) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("edit-save"));
    await waitFor(() => screen.getByTestId("validation-banner"));

    fireEvent.click(screen.getByTestId("edit-reset"));
    await waitFor(() =>
      expect(screen.queryByTestId("validation-banner")).toBeNull(),
    );
  });
});

describe("<EditMode> — error states", () => {
  it("shows a 404 fallback when the deck doesn't exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      }),
    );
    render(
      <MemoryRouter initialEntries={["/admin/decks/nope?edit=1"]}>
        <EditMode slug="nope" />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText(/No deck called/));
    expect(screen.getByText(/No deck called/)).toBeDefined();
  });
});
