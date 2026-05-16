/**
 * Tests for `<SourceFooter>` — the bottom-of-slide source list that
 * pairs with `<Cite>` markers. Issue #234.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { SourceFooter } from "./SourceFooter";
import type { Source } from "./types";

afterEach(() => cleanup());

describe("<SourceFooter>", () => {
  it("renders the `Sources` label so the band is recognisable", () => {
    const sources: Source[] = [
      { n: 1, label: "Acme · Annual Report 2025", href: "https://example.com/r" },
    ];
    const { getByText } = render(<SourceFooter sources={sources} />);
    // Case-insensitive — the visual style is uppercase via CSS, but
    // the DOM text is "Sources".
    expect(getByText(/sources/i)).toBeTruthy();
  });

  it("renders one entry per source with its `[N]` token and label", () => {
    const sources: Source[] = [
      { n: 1, label: "Acme 2025", href: "https://example.com/a" },
      { n: 2, label: "Beta Report", href: "https://example.com/b" },
    ];
    const { getByText } = render(<SourceFooter sources={sources} />);
    expect(getByText("[1]")).toBeTruthy();
    expect(getByText("[2]")).toBeTruthy();
    expect(getByText("Acme 2025")).toBeTruthy();
    expect(getByText("Beta Report")).toBeTruthy();
  });

  it("renders each source with an href as an external link", () => {
    const sources: Source[] = [
      { n: 1, label: "Linked", href: "https://example.com/report" },
    ];
    const { container } = render(<SourceFooter sources={sources} />);
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://example.com/report");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toMatch(/noreferrer/);
    expect(link?.getAttribute("rel")).toMatch(/noopener/);
    expect(link?.getAttribute("data-no-advance")).not.toBeNull();
    expect(link?.textContent).toBe("Linked");
  });

  it("renders source entries without an href as plain text (no `<a>`)", () => {
    // Some sources are book references, internal docs, or "talk
    // (Foo 2024)" attributions where no URL is available. The
    // component must accept these without forcing a fake href.
    const sources: Source[] = [
      { n: 1, label: "Internal RFC, 2025" }, // no href
    ];
    const { container, getByText } = render(<SourceFooter sources={sources} />);
    expect(getByText("Internal RFC, 2025")).toBeTruthy();
    // No anchor element on this entry.
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders an empty footer cleanly when given no sources", () => {
    // Defensive: zero sources shouldn't crash. The "Sources" label
    // still renders, which is harmless and keeps the footer band
    // layout consistent.
    const { getByText } = render(<SourceFooter sources={[]} />);
    expect(getByText(/sources/i)).toBeTruthy();
  });

  it("forwards an additional className when provided", () => {
    const sources: Source[] = [{ n: 1, label: "X" }];
    const { container } = render(
      <SourceFooter sources={sources} className="extra-class" />,
    );
    // The wrapper is the first child of the test container's root.
    const root = container.firstElementChild;
    expect(root?.className).toMatch(/extra-class/);
  });
});
