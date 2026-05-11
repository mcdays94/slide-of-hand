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
import { PresenterModeProvider } from "@/framework/presenter/mode";

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
      aiAssistantModel: "kimi-k2.6",
      showAssistantReasoning: false,
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
      aiAssistantModel: "kimi-k2.6",
      showAssistantReasoning: false,
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

  // ─── AI assistant model picker (issue #131 item A) ─────────────────
  //
  // Three friendly keys, presenter-mode-only (the picker only makes
  // sense for the in-Studio AI agent, which only lives behind the
  // admin route). Mirrors the existing `<GitHubConnectRow>` gating
  // pattern.
  describe("aiAssistantModel picker (issue #131 item A)", () => {
    it("renders the picker when presenter mode is enabled", () => {
      render(
        <PresenterModeProvider enabled={true}>
          <SettingsProvider>
            <SettingsModal open={true} onClose={() => {}} />
          </SettingsProvider>
        </PresenterModeProvider>,
      );
      // The picker uses the segmented-row primitive with the
      // testIdPrefix "settings-modal-ai-assistant-model" so each
      // option becomes `…-{key}`.
      expect(
        screen.getByTestId("settings-modal-ai-assistant-model-kimi-k2.6"),
      ).toBeTruthy();
      expect(
        screen.getByTestId("settings-modal-ai-assistant-model-llama-4-scout"),
      ).toBeTruthy();
      expect(
        screen.getByTestId("settings-modal-ai-assistant-model-gpt-oss-120b"),
      ).toBeTruthy();
    });

    it("does NOT render the picker when presenter mode is disabled (public viewer)", () => {
      // No `<PresenterModeProvider>` → default is `false` → picker
      // is hidden. The picker is an admin-only concept (it
      // configures the in-Studio agent), so leaking it into the
      // public viewer's settings modal would be confusing.
      render(
        <SettingsProvider>
          <SettingsModal open={true} onClose={() => {}} />
        </SettingsProvider>,
      );
      expect(
        screen.queryByTestId("settings-modal-ai-assistant-model-kimi-k2.6"),
      ).toBeNull();
    });

    it("defaults to the kimi-k2.6 option (aria-checked=true)", () => {
      render(
        <PresenterModeProvider enabled={true}>
          <SettingsProvider>
            <SettingsModal open={true} onClose={() => {}} />
          </SettingsProvider>
        </PresenterModeProvider>,
      );
      const kimi = screen.getByTestId(
        "settings-modal-ai-assistant-model-kimi-k2.6",
      );
      expect(kimi.getAttribute("aria-checked")).toBe("true");
      // The other two are inactive.
      const llama = screen.getByTestId(
        "settings-modal-ai-assistant-model-llama-4-scout",
      );
      expect(llama.getAttribute("aria-checked")).toBe("false");
      const gpt = screen.getByTestId(
        "settings-modal-ai-assistant-model-gpt-oss-120b",
      );
      expect(gpt.getAttribute("aria-checked")).toBe("false");
    });

    it("clicking an option flips the active state and persists the choice", () => {
      render(
        <PresenterModeProvider enabled={true}>
          <SettingsProvider>
            <SettingsModal open={true} onClose={() => {}} />
          </SettingsProvider>
        </PresenterModeProvider>,
      );
      const gpt = screen.getByTestId(
        "settings-modal-ai-assistant-model-gpt-oss-120b",
      );
      act(() => {
        gpt.click();
      });
      expect(gpt.getAttribute("aria-checked")).toBe("true");
      const kimi = screen.getByTestId(
        "settings-modal-ai-assistant-model-kimi-k2.6",
      );
      expect(kimi.getAttribute("aria-checked")).toBe("false");

      const persisted = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY)!,
      ) as { aiAssistantModel: string };
      expect(persisted.aiAssistantModel).toBe("gpt-oss-120b");
    });

    it("stacks the row vertically when there are 3+ options (label on top, buttons full-width below)", () => {
      // The 3-option AI model picker is the use case that surfaced
      // this layout bug on 2026-05-11. With horizontal layout, the
      // long button labels (LLAMA 4 SCOUT, GPT-OSS 120B) squeezed
      // the description column to ~8 chars per line. Stacking
      // vertically gives both the description AND the buttons full
      // width.
      render(
        <PresenterModeProvider enabled={true}>
          <SettingsProvider>
            <SettingsModal open={true} onClose={() => {}} />
          </SettingsProvider>
        </PresenterModeProvider>,
      );
      // The button group is the direct radio-group sibling of the
      // label container. Find it via the button's parent.
      const kimi = screen.getByTestId(
        "settings-modal-ai-assistant-model-kimi-k2.6",
      );
      const radioGroup = kimi.closest('[role="group"]');
      expect(radioGroup).not.toBeNull();
      // In stacked mode, the radio-group is `self-stretch` (full
      // width below the label) and the parent row is `flex-col`.
      expect(radioGroup!.className).toMatch(/self-stretch/);
      const row = radioGroup!.parentElement!;
      expect(row.className).toMatch(/flex-col/);
      // Each button is flex-1 to share the row equally.
      expect(kimi.className).toMatch(/flex-1/);
    });

    it("keeps the 2-option `notesDefaultMode` row horizontal (no regression)", () => {
      // The 2-option notes-mode picker should KEEP its horizontal
      // layout — only 3+ option rows should stack.
      render(
        <PresenterModeProvider enabled={true}>
          <SettingsProvider>
            <SettingsModal open={true} onClose={() => {}} />
          </SettingsProvider>
        </PresenterModeProvider>,
      );
      const rich = screen.getByTestId(
        "settings-modal-notes-default-mode-rich",
      );
      const radioGroup = rich.closest('[role="group"]');
      expect(radioGroup).not.toBeNull();
      // Horizontal layout: NOT self-stretch.
      expect(radioGroup!.className).not.toMatch(/self-stretch/);
      const row = radioGroup!.parentElement!;
      expect(row.className).not.toMatch(/flex-col/);
      // Buttons should NOT be flex-1 in horizontal mode (they sit
      // at their content size).
      expect(rich.className).not.toMatch(/flex-1/);
    });
  });

  // showAssistantReasoning — power-user opt-in for rendering the
  // model's chain-of-thought above each assistant turn in the chat
  // panel. Same presenter-mode gating as the model picker since both
  // configure the in-Studio agent.
  describe("showAssistantReasoning toggle", () => {
    it("renders the toggle when presenter mode is enabled", () => {
      render(
        <PresenterModeProvider enabled={true}>
          <SettingsProvider>
            <SettingsModal open={true} onClose={() => {}} />
          </SettingsProvider>
        </PresenterModeProvider>,
      );
      expect(
        screen.getByTestId(
          "settings-modal-toggle-show-assistant-reasoning",
        ),
      ).toBeTruthy();
    });

    it("does NOT render the toggle when presenter mode is disabled (public viewer)", () => {
      // Same rationale as the model picker — the setting only
      // affects the in-Studio agent UI, which is admin-only.
      render(
        <SettingsProvider>
          <SettingsModal open={true} onClose={() => {}} />
        </SettingsProvider>,
      );
      expect(
        screen.queryByTestId(
          "settings-modal-toggle-show-assistant-reasoning",
        ),
      ).toBeNull();
    });

    it("defaults to off (aria-checked=false)", () => {
      render(
        <PresenterModeProvider enabled={true}>
          <SettingsProvider>
            <SettingsModal open={true} onClose={() => {}} />
          </SettingsProvider>
        </PresenterModeProvider>,
      );
      const toggle = screen.getByTestId(
        "settings-modal-toggle-show-assistant-reasoning",
      );
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });

    it("clicking the toggle flips its state and persists the choice", () => {
      render(
        <PresenterModeProvider enabled={true}>
          <SettingsProvider>
            <SettingsModal open={true} onClose={() => {}} />
          </SettingsProvider>
        </PresenterModeProvider>,
      );
      const toggle = screen.getByTestId(
        "settings-modal-toggle-show-assistant-reasoning",
      );
      act(() => {
        toggle.click();
      });
      expect(toggle.getAttribute("aria-checked")).toBe("true");

      const persisted = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY)!,
      ) as { showAssistantReasoning: boolean };
      expect(persisted.showAssistantReasoning).toBe(true);
    });
  });
});
