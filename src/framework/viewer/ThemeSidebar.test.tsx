/**
 * Surface-level tests for `<ThemeSidebar>`. We don't try to cover every
 * permutation of the colour pickers — happy-dom doesn't paint anyway. The
 * tests confirm the structural contract:
 *
 *   - 4 colour pickers + 4 hex text inputs render
 *   - dirty indicator appears when the draft diverges from baseline
 *   - Save POSTs to /api/admin/themes/<slug>
 *   - Reset DELETEs to /api/admin/themes/<slug>
 *   - Close invokes the onClose prop
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ThemeSidebar } from "./ThemeSidebar";
import { SOURCE_DEFAULTS } from "@/lib/theme-tokens";
import type { UseDeckThemeResult } from "./useDeckTheme";

function makeTheme(
  partial: Partial<UseDeckThemeResult> = {},
): UseDeckThemeResult {
  return {
    tokens: null,
    updatedAt: null,
    isLoading: false,
    applyDraft: vi.fn(),
    clearDraft: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...partial,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ThemeSidebar>", () => {
  it("renders four colour pickers and four hex text inputs", () => {
    render(
      <ThemeSidebar
        open
        slug="hello"
        theme={makeTheme()}
        onClose={vi.fn()}
      />,
    );
    const pickers = screen.getAllByLabelText(/colour picker$/i);
    expect(pickers).toHaveLength(4);
    const hexInputs = screen.getAllByLabelText(/hex value$/i);
    expect(hexInputs).toHaveLength(4);
  });

  it("does not render when open is false", () => {
    render(
      <ThemeSidebar
        open={false}
        slug="hello"
        theme={makeTheme()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("theme-sidebar")).toBeNull();
  });

  it("invokes onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ThemeSidebar
        open
        slug="hello"
        theme={makeTheme()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("theme-sidebar-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the dirty indicator when the draft diverges from baseline", () => {
    render(
      <ThemeSidebar
        open
        slug="hello"
        theme={makeTheme()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("theme-sidebar-dirty-indicator"),
    ).toBeNull();

    const orangePicker = screen.getByLabelText(/Brand orange colour picker/i);
    fireEvent.change(orangePicker, { target: { value: "#19E306" } });

    expect(
      screen.queryByTestId("theme-sidebar-dirty-indicator"),
    ).not.toBeNull();
  });

  it("Save POSTs to /api/admin/themes/<slug> with the draft tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const refetch = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeSidebar
        open
        slug="hello"
        theme={makeTheme({ refetch })}
        onClose={vi.fn()}
      />,
    );

    const orangePicker = screen.getByLabelText(/Brand orange colour picker/i);
    fireEvent.change(orangePicker, { target: { value: "#19E306" } });

    fireEvent.click(screen.getByTestId("theme-sidebar-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/themes/hello");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.tokens["cf-orange"].toLowerCase()).toBe("#19e306");
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("Reset DELETEs and re-fetches when an override is persisted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const refetch = vi.fn().mockResolvedValue(undefined);
    const clearDraft = vi.fn();

    render(
      <ThemeSidebar
        open
        slug="hello"
        theme={makeTheme({
          tokens: { ...SOURCE_DEFAULTS, "cf-orange": "#19E306" },
          updatedAt: "2026-05-06T00:00:00Z",
          refetch,
          clearDraft,
        })}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("theme-sidebar-reset"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/themes/hello");
    expect(init.method).toBe("DELETE");
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(clearDraft).toHaveBeenCalled();
  });

  it("disables the Reset button when no override is persisted", () => {
    render(
      <ThemeSidebar
        open
        slug="hello"
        theme={makeTheme({ tokens: null })}
        onClose={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId("theme-sidebar-reset") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
