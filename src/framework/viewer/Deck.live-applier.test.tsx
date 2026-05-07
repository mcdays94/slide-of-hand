/**
 * Unit tests for the diff-based live-DOM applier helpers in `<Deck>` (#54).
 *
 * These tests exercise the pure helpers (`applyOverride`,
 * `revertOverride`, `sameOverrideKey`) directly rather than spinning
 * up a full `<Deck>` render. The full Deck has too many async fetch
 * hooks (manifest, theme, overrides, analytics) to make a focused
 * integration test small or fast — but the diff logic is a pure
 * function over a slide root + an override, so we drive it via JSDOM
 * with hand-built DOM nodes that mirror the structure `<Slide>`
 * produces.
 *
 * Coverage:
 *   - apply: swaps `from` → `to` for the matched element
 *   - revert: swaps `to` → `from` (the #54 missing piece)
 *   - apply → revert is a round-trip (the element is left in its
 *     original class set)
 *   - multi-swap overrides apply / revert each pair independently
 *   - missing element: both apply and revert no-op (no exception)
 *   - sameOverrideKey: identifies entries by (slideId, selector)
 *
 * The test for "diff drops an override → revert lands" is implicit in
 * the fact that the Deck effect calls `revertOverride` whenever an
 * entry is in prev but not in curr. The helper test verifies the
 * revert itself works correctly; the integration of "list change →
 * helper called" is covered by the visual probe.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  applyOverride,
  revertOverride,
  sameOverrideKey,
} from "./Deck";
import type { ElementOverride } from "./useElementOverrides";

/**
 * Build a slide root in the JSDOM test environment. Each call appends
 * a fresh `<div data-slide-index>` to `document.body`; afterEach
 * tears them down so tests don't leak DOM.
 */
function makeSlideRoot(html: string): Element {
  const root = document.createElement("div");
  root.setAttribute("data-slide-index", "0");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Deck diff-based applier helpers (#54)", () => {
  it("applyOverride swaps `from` → `to` on the matched element", () => {
    const root = makeSlideRoot('<h1 class="text-cf-text">Hello</h1>');
    const ov: ElementOverride = {
      slideId: "title",
      selector: "h1:nth-child(1)",
      fingerprint: { tag: "h1", text: "Hello" },
      classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
    };
    applyOverride(root, ov);
    const h1 = root.querySelector("h1")!;
    expect(h1.classList.contains("text-cf-orange")).toBe(true);
    expect(h1.classList.contains("text-cf-text")).toBe(false);
  });

  it("revertOverride swaps `to` → `from` on the matched element (#54 core)", () => {
    // Element is in the post-apply state — `text-cf-orange` swapped
    // in. Revert should restore `text-cf-text`.
    const root = makeSlideRoot('<h1 class="text-cf-orange">Hello</h1>');
    const ov: ElementOverride = {
      slideId: "title",
      selector: "h1:nth-child(1)",
      fingerprint: { tag: "h1", text: "Hello" },
      classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
    };
    revertOverride(root, ov);
    const h1 = root.querySelector("h1")!;
    expect(h1.classList.contains("text-cf-text")).toBe(true);
    expect(h1.classList.contains("text-cf-orange")).toBe(false);
  });

  it("apply → revert restores the element to its pre-apply class set", () => {
    const root = makeSlideRoot(
      '<h1 class="text-cf-text font-medium tracking-tight">Hello</h1>',
    );
    const ov: ElementOverride = {
      slideId: "title",
      selector: "h1:nth-child(1)",
      fingerprint: { tag: "h1", text: "Hello" },
      classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
    };
    const h1 = root.querySelector("h1")!;
    const originalClasses = Array.from(h1.classList).sort();
    applyOverride(root, ov);
    expect(Array.from(h1.classList).sort()).not.toEqual(originalClasses);
    revertOverride(root, ov);
    expect(Array.from(h1.classList).sort()).toEqual(originalClasses);
  });

  it("multi-swap overrides apply / revert each pair independently", () => {
    const root = makeSlideRoot(
      '<section class="bg-cf-bg-100 text-cf-text text-2xl">Multi</section>',
    );
    const ov: ElementOverride = {
      slideId: "third",
      selector: "section:nth-child(1)",
      fingerprint: { tag: "section", text: "Multi" },
      classOverrides: [
        { from: "bg-cf-bg-100", to: "bg-cf-bg-200" },
        { from: "text-cf-text", to: "text-cf-orange" },
        { from: "text-2xl", to: "text-4xl" },
      ],
    };
    const section = root.querySelector("section")!;
    applyOverride(root, ov);
    expect(section.classList.contains("bg-cf-bg-200")).toBe(true);
    expect(section.classList.contains("text-cf-orange")).toBe(true);
    expect(section.classList.contains("text-4xl")).toBe(true);
    expect(section.classList.contains("bg-cf-bg-100")).toBe(false);

    revertOverride(root, ov);
    expect(section.classList.contains("bg-cf-bg-100")).toBe(true);
    expect(section.classList.contains("text-cf-text")).toBe(true);
    expect(section.classList.contains("text-2xl")).toBe(true);
    expect(section.classList.contains("bg-cf-bg-200")).toBe(false);
  });

  it("apply against a missing element no-ops without throwing", () => {
    const root = makeSlideRoot('<h1 class="text-cf-text">Hello</h1>');
    const ov: ElementOverride = {
      slideId: "title",
      selector: "p:nth-child(1)", // no <p> in the root
      fingerprint: { tag: "p", text: "" },
      classOverrides: [{ from: "text-cf-text-muted", to: "text-cf-blue" }],
    };
    expect(() => applyOverride(root, ov)).not.toThrow();
  });

  it("revert against a missing element no-ops without throwing", () => {
    const root = makeSlideRoot('<h1 class="text-cf-text">Hello</h1>');
    const ov: ElementOverride = {
      slideId: "title",
      selector: "p:nth-child(1)",
      fingerprint: { tag: "p", text: "" },
      classOverrides: [{ from: "text-cf-text-muted", to: "text-cf-blue" }],
    };
    expect(() => revertOverride(root, ov)).not.toThrow();
  });

  it("revert is defensive when `to` was already removed externally", () => {
    // Some other code mutated the element after apply: removed
    // `to` and didn't restore `from`. Revert restores `from`
    // additively so the element doesn't end up missing both.
    const root = makeSlideRoot('<h1 class="font-medium">Hello</h1>');
    const ov: ElementOverride = {
      slideId: "title",
      selector: "h1:nth-child(1)",
      fingerprint: { tag: "h1", text: "Hello" },
      classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
    };
    revertOverride(root, ov);
    const h1 = root.querySelector("h1")!;
    expect(h1.classList.contains("text-cf-text")).toBe(true);
  });

  it("sameOverrideKey identifies entries by (slideId, selector)", () => {
    const a: ElementOverride = {
      slideId: "title",
      selector: "h1:nth-child(1)",
      fingerprint: { tag: "h1", text: "Hello" },
      classOverrides: [{ from: "text-cf-text", to: "text-cf-orange" }],
    };
    // Same key, different fingerprint + class swap — still considered
    // the same entry by key (the diff applier uses key only).
    const aWithDifferentSwap: ElementOverride = {
      ...a,
      fingerprint: { tag: "h1", text: "World" },
      classOverrides: [{ from: "text-cf-text", to: "text-cf-blue" }],
    };
    const b: ElementOverride = {
      ...a,
      slideId: "second", // different slide
    };
    const c: ElementOverride = {
      ...a,
      selector: "h2:nth-child(1)", // different selector
    };
    expect(sameOverrideKey(a, aWithDifferentSwap)).toBe(true);
    expect(sameOverrideKey(a, b)).toBe(false);
    expect(sameOverrideKey(a, c)).toBe(false);
  });
});
