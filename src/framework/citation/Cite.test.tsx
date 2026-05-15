/**
 * Tests for `<Cite>` — the inline citation marker primitive.
 *
 * The framework primitive mirrors the deck-local copies that already
 * ship in `cf-dynamic-workers` and `cf-zt-ai`, but lives at a stable
 * import path (`@/framework/citation`) so AI-generated decks can rely
 * on it. See issue #234.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Cite } from "./Cite";

afterEach(() => cleanup());

describe("<Cite>", () => {
  it("renders a visible bracketed number marker `[N]`", () => {
    const { getByText } = render(<Cite n={1} />);
    // The marker is the literal text the audience reads next to a
    // claim. We assert on the rendered text rather than the inner
    // structure so swaps between `<sup>`/`<span>` don't break the
    // contract.
    expect(getByText("[1]")).toBeTruthy();
  });

  it("renders a `<sup>` wrapper so the marker reads as a superscript", () => {
    // The visual contract is a superscript-ish marker. The DOM nesting
    // is the load-bearing piece — CSS classes can change without
    // breaking screen readers, but losing `<sup>` would.
    const { container } = render(<Cite n={2} />);
    const sup = container.querySelector("sup");
    expect(sup).not.toBeNull();
    expect(sup?.textContent).toBe("[2]");
  });

  it("renders an accessible external link when `href` is set", () => {
    const { container } = render(
      <Cite n={3} href="https://example.com/report.pdf" />,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://example.com/report.pdf");
    // External-link hygiene: `target="_blank"` opens in a new tab,
    // `rel="noreferrer noopener"` strips referrer + window.opener so
    // the source page can't reach back into our app.
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toMatch(/noreferrer/);
    expect(link?.getAttribute("rel")).toMatch(/noopener/);
  });

  it("renders a non-link marker (no `<a>`) when `href` is omitted", () => {
    // When the slide author doesn't pass an href, the marker is
    // purely visual — the URL lives only in `<SourceFooter>` below.
    // No anchor element means screen readers don't announce it as a
    // link, and click-to-advance doesn't have to special-case it.
    const { container } = render(<Cite n={4} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("span")).not.toBeNull();
  });

  it("applies `data-no-advance` on the link variant so clicks don't trigger slide advance", () => {
    // Click-to-advance is wired on the slide surface. Without
    // `data-no-advance`, clicking the citation link would advance
    // the deck instead of opening the source. See
    // `Deck.tsx`'s click handler for the matching selector.
    const { container } = render(<Cite n={5} href="https://example.com" />);
    expect(
      container.querySelector("a")?.getAttribute("data-no-advance"),
    ).not.toBeNull();
  });
});
