/**
 * Tests for `useSettings()` + `<SettingsProvider>`.
 *
 * Covers:
 *   - Provider initialises from `localStorage`.
 *   - `setSetting` updates state AND persists to localStorage.
 *   - `reset` returns to defaults AND wipes the persisted blob.
 *   - Cross-tab sync: a `storage` event rerenders the provider.
 *   - `useSettings()` outside a provider returns the defaults shape.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  writeSettings,
} from "@/lib/settings";
import { SettingsProvider, useSettings } from "./useSettings";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

function Probe() {
  const { settings, setSetting, reset } = useSettings();
  return (
    <div>
      <span data-testid="show-indicators">
        {String(settings.showSlideIndicators)}
      </span>
      <button
        type="button"
        data-testid="toggle"
        onClick={() => setSetting("showSlideIndicators", !settings.showSlideIndicators)}
      >
        toggle
      </button>
      <button type="button" data-testid="reset" onClick={reset}>
        reset
      </button>
    </div>
  );
}

describe("<SettingsProvider> + useSettings()", () => {
  it("initialises from localStorage on first render", () => {
    writeSettings({ showSlideIndicators: false });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("show-indicators").textContent).toBe("false");
  });

  it("falls back to defaults when localStorage is empty", () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("show-indicators").textContent).toBe(
      String(DEFAULT_SETTINGS.showSlideIndicators),
    );
  });

  it("setSetting updates state and persists to localStorage", () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    const btn = screen.getByTestId("toggle");
    act(() => {
      btn.click();
    });
    expect(screen.getByTestId("show-indicators").textContent).toBe("false");
    const persisted = window.localStorage.getItem(STORAGE_KEY);
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted!)).toEqual({
      showSlideIndicators: false,
      presenterNextSlideShowsFinalPhase: false,
    });
  });

  it("reset returns to defaults and clears storage", () => {
    writeSettings({ showSlideIndicators: false });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("show-indicators").textContent).toBe("false");
    act(() => {
      screen.getByTestId("reset").click();
    });
    expect(screen.getByTestId("show-indicators").textContent).toBe(
      String(DEFAULT_SETTINGS.showSlideIndicators),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("propagates storage events from another tab", () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("show-indicators").textContent).toBe("true");

    // Simulate another tab writing the settings blob.
    act(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ showSlideIndicators: false }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify({ showSlideIndicators: false }),
        }),
      );
    });

    expect(screen.getByTestId("show-indicators").textContent).toBe("false");
  });

  it("ignores storage events for unrelated keys", () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "some-other-key",
          newValue: "{}",
        }),
      );
    });
    expect(screen.getByTestId("show-indicators").textContent).toBe("true");
  });

  it("accepts an initialSettings override (bypasses storage read)", () => {
    writeSettings({ showSlideIndicators: false });
    render(
      <SettingsProvider initialSettings={{ showSlideIndicators: true, presenterNextSlideShowsFinalPhase: false }}>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("show-indicators").textContent).toBe("true");
  });
});

describe("useSettings() outside a provider", () => {
  it("returns DEFAULT_SETTINGS and no-op setters", () => {
    render(<Probe />);
    expect(screen.getByTestId("show-indicators").textContent).toBe(
      String(DEFAULT_SETTINGS.showSlideIndicators),
    );
    // Calling the no-op setter shouldn't throw or mutate storage.
    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(screen.getByTestId("show-indicators").textContent).toBe(
      String(DEFAULT_SETTINGS.showSlideIndicators),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
