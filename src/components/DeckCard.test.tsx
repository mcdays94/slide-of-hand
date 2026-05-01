/**
 * Tests for `<DeckCard>`.
 *
 * The card is the unit element of the public index. It accepts a `DeckMeta`
 * and renders a link to `/decks/<slug>` plus the visible meta (date, event,
 * runtime, title, description, tags, cover). Optional fields must be hidden
 * when absent — no empty wrappers, no stale labels.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DeckCard } from "./DeckCard";
import type { DeckMeta } from "@/framework/viewer/types";

afterEach(() => cleanup());

const baseMeta: DeckMeta = {
  slug: "alpha",
  title: "Alpha",
  description: "An alpha deck.",
  date: "2026-04-01",
};

function renderCard(meta: DeckMeta) {
  return render(
    <MemoryRouter>
      <DeckCard meta={meta} />
    </MemoryRouter>,
  );
}

describe("DeckCard", () => {
  it("renders the title and description", () => {
    renderCard(baseMeta);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("An alpha deck.")).toBeTruthy();
  });

  it("links to /decks/<slug>", () => {
    renderCard(baseMeta);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/decks/alpha");
  });

  it("renders the date in the kicker", () => {
    renderCard(baseMeta);
    expect(screen.getByText(/2026-04-01/)).toBeTruthy();
  });

  it("renders event when present", () => {
    renderCard({ ...baseMeta, event: "DTX Manchester 2026" });
    expect(screen.getByText(/DTX Manchester 2026/)).toBeTruthy();
  });

  it("omits event row when absent", () => {
    renderCard(baseMeta);
    expect(screen.queryByText(/DTX/)).toBeNull();
  });

  it("renders runtime in minutes when present", () => {
    renderCard({ ...baseMeta, runtimeMinutes: 25 });
    // The kicker uses a CSS uppercase transform; underlying text is "25 min".
    expect(screen.getByText(/25 min/i)).toBeTruthy();
  });

  it("omits runtime when absent", () => {
    renderCard(baseMeta);
    expect(screen.queryByText(/min/i)).toBeNull();
  });

  it("renders up to 3 tag chips when tags present", () => {
    renderCard({ ...baseMeta, tags: ["one", "two", "three", "four"] });
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("two")).toBeTruthy();
    expect(screen.getByText("three")).toBeTruthy();
    expect(screen.queryByText("four")).toBeNull();
  });

  it("omits tag row when absent or empty", () => {
    renderCard({ ...baseMeta, tags: [] });
    // No tag chip row should render. Easiest assertion: no element with the
    // tag-chip data-attribute.
    expect(document.querySelector("[data-deck-tag]")).toBeNull();
  });

  it("renders cover image when present", () => {
    renderCard({ ...baseMeta, cover: "/decks/alpha/cover.png" });
    // The cover image is decorative (`alt=""`) so we query the DOM directly
    // rather than via getByRole — presentational images are not exposed.
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/decks/alpha/cover.png");
  });

  it("omits cover image when absent", () => {
    renderCard(baseMeta);
    expect(document.querySelector("img")).toBeNull();
  });
});
