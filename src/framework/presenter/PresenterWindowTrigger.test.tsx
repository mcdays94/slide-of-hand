/**
 * Tests for `<PresenterWindowTrigger>`'s P-key listener.
 *
 * Regression for #56: a synthetic `KeyboardEvent` dispatched on `window`
 * (`target === Window`) used to throw `target?.closest is not a function`
 * because `Window` lacks `.closest()`. The handler must guard with
 * `target instanceof Element` before calling `.closest()`.
 *
 * Real keyboard events always have an Element target, so the guard
 * doesn't change runtime behaviour for users; it only silences the
 * pageerror noise that automated probes (or any in-app code that
 * accidentally dispatches on `window`) would otherwise produce.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PresenterWindowTrigger } from "./PresenterWindowTrigger";

describe("PresenterWindowTrigger — synthetic keypress hardening", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // Provide a deck root so the trigger picks up a slug and installs the
    // P-key listener (the effect early-returns when slug is empty).
    const root = document.createElement("div");
    root.setAttribute("data-deck-slug", "hello");
    document.body.appendChild(root);
  });
  afterEach(() => cleanup());

  it("does not throw when a synthetic non-P keydown is dispatched on window (target = Window)", () => {
    // Stub window.open so a stray match wouldn't side-effect.
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    render(<PresenterWindowTrigger />);

    // Let the slug-resolution effect run.
    act(() => {});

    // This is the failing case from #56: synthetic KeyboardEvent
    // dispatched on window has `target === Window`, which has no
    // `.closest()` method. Pre-fix this throws synchronously inside the
    // listener and surfaces as a `pageerror`; post-fix it's silently
    // ignored.
    expect(() => {
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "q", bubbles: true }),
        );
      });
    }).not.toThrow();

    // Also cover other irrelevant keys for parity with the production
    // probe (#56 reproduction dispatched several keys on window).
    expect(() => {
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
      });
    }).not.toThrow();

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("does not throw when synthetic P keydown is dispatched on window (target = Window)", () => {
    // Pre-fix this also throws because the guard runs BEFORE the key
    // check. Post-fix the listener early-returns silently and the P-key
    // shortcut simply doesn't fire — which matches the real-user path
    // (real P keypresses target an Element, not Window).
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    render(<PresenterWindowTrigger />);
    act(() => {});

    expect(() => {
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "p", bubbles: true }),
        );
      });
    }).not.toThrow();

    // Window-targeted synthetic events must not trigger the
    // window.open() side effect — they're treated as foreign.
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("still triggers window.open when P is pressed with a real Element target", () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    render(<PresenterWindowTrigger />);
    act(() => {});

    // Dispatch on document.body (an Element) — this is the canonical
    // synthetic-event path per AGENTS.md and matches what real users hit.
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", bubbles: true }),
      );
    });

    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = String(openSpy.mock.calls[0][0]);
    expect(url).toContain("presenter=1");
    const targetName = String(openSpy.mock.calls[0][1]);
    expect(targetName).toContain("hello");
    openSpy.mockRestore();
  });
});
