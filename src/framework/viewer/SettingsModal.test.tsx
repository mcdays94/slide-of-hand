/**
 * Tests for `<SettingsModal>` (issue #32).
 *
 * Covers:
 *   - Renders when `open=true`, doesn't render when `open=false`.
 *   - Click on the X (Esc) button calls `onClose`.
 *   - Click on the backdrop calls `onClose`.
 *   - Click inside the panel does NOT call `onClose`.
 *   - Toggle flips `showSlideIndicators` and persists to localStorage.
 *   - Backdrop carries `data-no-advance` and the toggle carries
 *     `data-interactive`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { STORAGE_KEY } from "@/lib/settings";
import { SettingsModal } from "./SettingsModal";
import { SettingsProvider } from "./useSettings";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("<SettingsModal>", () => {
  it("renders nothing when open=false", () => {
    render(
      <SettingsProvider>
        <SettingsModal open={false} onClose={() => {}} />
      </SettingsProvider>,
    );
    expect(screen.queryByTestId("settings-modal")).toBeNull();
  });

  it("renders the panel when open=true", () => {
    render(
      <SettingsProvider>
        <SettingsModal open={true} onClose={() => {}} />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
    expect(screen.getByTestId("settings-modal-panel")).toBeTruthy();
    // The single v1 setting row exists.
    expect(
      screen.getByTestId("settings-modal-toggle-show-indicators"),
    ).toBeTruthy();
  });

  it("backdrop carries data-no-advance", () => {
    render(
      <SettingsProvider>
        <SettingsModal open={true} onClose={() => {}} />
      </SettingsProvider>,
    );
    const backdrop = screen.getByTestId("settings-modal");
    expect(backdrop.hasAttribute("data-no-advance")).toBe(true);
  });

  it("toggle carries data-interactive", () => {
    render(
      <SettingsProvider>
        <SettingsModal open={true} onClose={() => {}} />
      </SettingsProvider>,
    );
    const toggle = screen.getByTestId("settings-modal-toggle-show-indicators");
    expect(toggle.hasAttribute("data-interactive")).toBe(true);
  });

  it("Esc keydown calls onClose (own listener, focus-independent)", () => {
    const onClose = vi.fn();
    render(
      <SettingsProvider>
        <SettingsModal open={true} onClose={onClose} />
      </SettingsProvider>,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc keydown is ignored when modal is closed", () => {
    const onClose = vi.fn();
    render(
      <SettingsProvider>
        <SettingsModal open={false} onClose={onClose} />
      </SettingsProvider>,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <SettingsProvider>
        <SettingsModal open={true} onClose={onClose} />
      </SettingsProvider>,
    );
    act(() => {
      screen.getByTestId("settings-modal-close").click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop calls onClose", () => {
    const onClose = vi.fn();
    render(
      <SettingsProvider>
        <SettingsModal open={true} onClose={onClose} />
      </SettingsProvider>,
    );
    const backdrop = screen.getByTestId("settings-modal");
    act(() => {
      backdrop.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the panel does NOT call onClose", () => {
    const onClose = vi.fn();
    render(
      <SettingsProvider>
        <SettingsModal open={true} onClose={onClose} />
      </SettingsProvider>,
    );
    const panel = screen.getByTestId("settings-modal-panel");
    act(() => {
      panel.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("toggle defaults to ON (aria-checked=true)", () => {
    render(
      <SettingsProvider>
        <SettingsModal open={true} onClose={() => {}} />
      </SettingsProvider>,
    );
    const toggle = screen.getByTestId("settings-modal-toggle-show-indicators");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("clicking the toggle flips showSlideIndicators and persists", () => {
    render(
      <SettingsProvider>
        <SettingsModal open={true} onClose={() => {}} />
      </SettingsProvider>,
    );
    const toggle = screen.getByTestId("settings-modal-toggle-show-indicators");
    act(() => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    const persisted = window.localStorage.getItem(STORAGE_KEY);
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted!)).toEqual({
      showSlideIndicators: false,
      presenterNextSlideShowsFinalPhase: false,
      notesDefaultMode: "rich",
      deckCardHoverAnimation: { enabled: true, slideCount: 3 },
    });

    // Toggling again flips it back ON.
    act(() => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
      showSlideIndicators: true,
      presenterNextSlideShowsFinalPhase: false,
      notesDefaultMode: "rich",
      deckCardHoverAnimation: { enabled: true, slideCount: 3 },
    });
  });

  describe("deckCardHoverAnimation rows (issue #128)", () => {
    it("renders the hover-animation toggle row", () => {
      render(
        <SettingsProvider>
          <SettingsModal open={true} onClose={() => {}} />
        </SettingsProvider>,
      );
      expect(
        screen.getByTestId("settings-modal-toggle-deck-card-hover"),
      ).toBeTruthy();
    });

    it("the hover-animation toggle defaults to ON", () => {
      render(
        <SettingsProvider>
          <SettingsModal open={true} onClose={() => {}} />
        </SettingsProvider>,
      );
      expect(
        screen
          .getByTestId("settings-modal-toggle-deck-card-hover")
          .getAttribute("aria-checked"),
      ).toBe("true");
    });

    it("renders a slideCount control when enabled is true", () => {
      render(
        <SettingsProvider>
          <SettingsModal open={true} onClose={() => {}} />
        </SettingsProvider>,
      );
      // Default state: enabled=true → numeric/segmented row visible.
      expect(
        screen.getByTestId("settings-modal-deck-card-hover-slide-count"),
      ).toBeTruthy();
    });

    it("hides the slideCount control when enabled is toggled off", () => {
      render(
        <SettingsProvider>
          <SettingsModal open={true} onClose={() => {}} />
        </SettingsProvider>,
      );
      const toggle = screen.getByTestId(
        "settings-modal-toggle-deck-card-hover",
      );
      act(() => {
        toggle.click();
      });
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      expect(
        screen.queryByTestId("settings-modal-deck-card-hover-slide-count"),
      ).toBeNull();
    });

    it("clicking a slideCount option persists the choice", () => {
      render(
        <SettingsProvider>
          <SettingsModal open={true} onClose={() => {}} />
        </SettingsProvider>,
      );
      const opt5 = screen.getByTestId(
        "settings-modal-deck-card-hover-slide-count-5",
      );
      act(() => {
        opt5.click();
      });
      const persisted = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY)!,
      ) as { deckCardHoverAnimation: { enabled: boolean; slideCount: number } };
      expect(persisted.deckCardHoverAnimation.slideCount).toBe(5);
    });

    it("toggling the hover toggle persists enabled=false", () => {
      render(
        <SettingsProvider>
          <SettingsModal open={true} onClose={() => {}} />
        </SettingsProvider>,
      );
      const toggle = screen.getByTestId(
        "settings-modal-toggle-deck-card-hover",
      );
      act(() => {
        toggle.click();
      });
      const persisted = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY)!,
      ) as { deckCardHoverAnimation: { enabled: boolean; slideCount: number } };
      expect(persisted.deckCardHoverAnimation.enabled).toBe(false);
    });

    it("renders all 8 slideCount options", () => {
      render(
        <SettingsProvider>
          <SettingsModal open={true} onClose={() => {}} />
        </SettingsProvider>,
      );
      for (let n = 1; n <= 8; n++) {
        expect(
          screen.getByTestId(
            `settings-modal-deck-card-hover-slide-count-${n}`,
          ),
        ).toBeTruthy();
      }
    });
  });
});
