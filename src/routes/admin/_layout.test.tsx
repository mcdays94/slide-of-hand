/**
 * Tests for the admin shell layout — `/admin/*` chrome (post-#147
 * GitHub-OAuth and post-3a/3b agent-tools work).
 *
 * The layout needs to:
 *   1. Render a Settings button in the header on every admin route.
 *   2. Open a `<SettingsModal>` when clicked.
 *   3. Mount under `<PresenterModeProvider enabled={true}>` so the
 *      modal's admin-only rows (GitHub Connect) actually render —
 *      that gating runs inside `<SettingsModal>` via `usePresenterMode()`.
 *
 * `<SettingsModal>` itself is mocked here so this test exercises only
 * the wiring between the layout button and the modal's open/close
 * props. The modal's internal behaviour is covered separately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Stub the SettingsModal so we can assert it gets mounted with the
// right props without dragging the whole modal (and its
// useSettings/useGitHubOAuth dependencies) into this test.
const settingsModalMock = vi.hoisted(() => vi.fn());
vi.mock("@/framework/viewer/SettingsModal", () => ({
  SettingsModal: (props: { open: boolean; onClose: () => void }) => {
    settingsModalMock(props);
    return props.open ? (
      <div data-testid="settings-modal-stub" role="dialog">
        stub modal
        <button onClick={props.onClose} data-testid="settings-modal-stub-close">
          close
        </button>
      </div>
    ) : null;
  },
}));

// Capture the value the layout passes to PresenterModeProvider so we
// can assert the admin shell is `enabled={true}`.
const presenterModeProviderMock = vi.hoisted(() =>
  vi.fn((props: { enabled: boolean; children: React.ReactNode }) => (
    <>{props.children}</>
  )),
);
vi.mock("@/framework/presenter/mode", () => ({
  PresenterModeProvider: presenterModeProviderMock,
  usePresenterMode: () => true,
}));

import AdminLayout from "./_layout";

beforeEach(() => {
  settingsModalMock.mockClear();
  presenterModeProviderMock.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderLayout(initialPath = "/admin") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />}>
          <Route index element={<div data-testid="admin-index-content">index</div>} />
          <Route
            path="decks/:slug"
            element={<div data-testid="admin-deck-content">deck</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminLayout — Settings entry point", () => {
  it("renders a Settings button in the header", () => {
    renderLayout();
    const button = screen.getByTestId("admin-header-settings");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Open settings");
    expect(button.textContent?.toLowerCase()).toContain("settings");
  });

  it("does NOT render the modal in the DOM by default (open=false)", () => {
    renderLayout();
    expect(screen.queryByTestId("settings-modal-stub")).toBeNull();
    // The mock was called once with open=false at mount time.
    expect(settingsModalMock).toHaveBeenCalled();
    expect(settingsModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("opens the modal when the button is clicked", () => {
    renderLayout();
    fireEvent.click(screen.getByTestId("admin-header-settings"));
    expect(screen.getByTestId("settings-modal-stub")).toBeTruthy();
    expect(settingsModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true }),
    );
  });

  it("closes the modal via onClose (stubbed by the modal's close button)", () => {
    renderLayout();
    fireEvent.click(screen.getByTestId("admin-header-settings"));
    expect(screen.getByTestId("settings-modal-stub")).toBeTruthy();
    fireEvent.click(screen.getByTestId("settings-modal-stub-close"));
    expect(screen.queryByTestId("settings-modal-stub")).toBeNull();
    // The last render passes open=false.
    expect(settingsModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("wraps the shell in <PresenterModeProvider enabled={true}>", () => {
    renderLayout();
    expect(presenterModeProviderMock).toHaveBeenCalled();
    const firstCall = presenterModeProviderMock.mock.calls[0][0];
    expect(firstCall.enabled).toBe(true);
  });

  it("Settings button is reachable on the admin index route (/admin)", () => {
    renderLayout("/admin");
    expect(screen.getByTestId("admin-header-settings")).toBeTruthy();
    expect(screen.getByTestId("admin-index-content")).toBeTruthy();
  });

  it("Settings button is reachable on nested admin routes (/admin/decks/<slug>)", () => {
    renderLayout("/admin/decks/hello");
    expect(screen.getByTestId("admin-header-settings")).toBeTruthy();
    expect(screen.getByTestId("admin-deck-content")).toBeTruthy();
  });

  it("renders the public-site link alongside the Settings button", () => {
    renderLayout();
    const publicLink = screen.getByRole("link", { name: /public site/i });
    expect(publicLink.getAttribute("href")).toBe("/");
  });

  it("renders the admin breadcrumb link to /admin", () => {
    renderLayout("/admin/decks/hello");
    const crumb = screen.getByRole("link", { name: /slide of hand · admin/i });
    expect(crumb.getAttribute("href")).toBe("/admin");
  });
});
