/**
 * Tests for `<DataDeck>` and the `dataSlideToSlideDef` adapter.
 *
 * `<DataDeck>` wraps `<Deck>` — converts a persisted `DataDeck` record into
 * the imperative `SlideDef[]` shape `<Deck>` already understands. We mock
 * `<Deck>` here to keep the suite light and to focus on:
 *
 *   1. The shape `<DataDeck>` passes to `<Deck>` (slug, title, slides).
 *   2. `dataSlideToSlideDef` correctly lifts id / title / layout / notes /
 *      hidden, and computes `phases = max(slot.revealAt ?? 0)`.
 *   3. The render function actually delegates to `renderDataSlide(slide,
 *      phase)` from Slice 4 (we mock the renderer too).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DataDeck as DataDeckRecord, DataSlide } from "@/lib/deck-record";

type CapturedDeckProps = {
  slug: string;
  title: string;
  slides: Array<{
    id: string;
    title?: string;
    phases?: number;
    layout?: string;
    notes?: ReactNode;
    hidden?: boolean;
    render: (props: { phase: number }) => ReactNode;
  }>;
};

let captured: CapturedDeckProps | null = null;

vi.mock("./Deck", () => ({
  Deck: (props: CapturedDeckProps) => {
    captured = props;
    return <div data-testid="deck-stub">deck stub</div>;
  },
}));

vi.mock("@/framework/templates/render", () => ({
  renderDataSlide: (slide: DataSlide, phase: number) => (
    <div data-testid="rendered-slide" data-slide-id={slide.id} data-phase={phase}>
      rendered: {slide.id} @ phase {phase}
    </div>
  ),
}));

const { DataDeck, dataSlideToSlideDef } = await import("./DataDeck");

afterEach(() => {
  captured = null;
  cleanup();
});

const baseSlide = (overrides: Partial<DataSlide> = {}): DataSlide => ({
  id: "title",
  template: "cover",
  slots: {
    title: { kind: "text", value: "Hello" },
  },
  ...overrides,
});

const baseDeck = (overrides: Partial<DataDeckRecord> = {}): DataDeckRecord => ({
  meta: {
    slug: "test-deck",
    title: "Test Deck",
    date: "2026-05-01",
    visibility: "public",
  },
  slides: [baseSlide()],
  ...overrides,
});

describe("dataSlideToSlideDef", () => {
  it("lifts id from the data slide", () => {
    const def = dataSlideToSlideDef(baseSlide({ id: "intro" }));
    expect(def.id).toBe("intro");
  });

  it("computes phases as max(slot.revealAt ?? 0) across slot values", () => {
    const def = dataSlideToSlideDef(
      baseSlide({
        slots: {
          a: { kind: "text", value: "A" }, // no revealAt → 0
          b: { kind: "text", value: "B", revealAt: 1 },
          c: { kind: "text", value: "C", revealAt: 3 },
          d: { kind: "text", value: "D", revealAt: 2 },
        },
      }),
    );
    expect(def.phases).toBe(3);
  });

  it("computes phases = 0 when no slot has a revealAt", () => {
    const def = dataSlideToSlideDef(
      baseSlide({
        slots: {
          a: { kind: "text", value: "A" },
          b: { kind: "text", value: "B" },
        },
      }),
    );
    expect(def.phases).toBe(0);
  });

  it("computes phases = 0 when slots map is empty", () => {
    const def = dataSlideToSlideDef(baseSlide({ slots: {} }));
    expect(def.phases).toBe(0);
  });

  it("lifts layout, notes, and hidden when present", () => {
    const def = dataSlideToSlideDef(
      baseSlide({
        layout: "section",
        notes: "Speaker note text.",
        hidden: true,
      }),
    );
    expect(def.layout).toBe("section");
    expect(def.notes).toBe("Speaker note text.");
    expect(def.hidden).toBe(true);
  });

  it("omits layout / notes / hidden when absent on the data slide", () => {
    const def = dataSlideToSlideDef(baseSlide());
    expect(def.layout).toBeUndefined();
    expect(def.notes).toBeUndefined();
    expect(def.hidden).toBeUndefined();
  });

  it("delegates render to renderDataSlide(slide, phase)", () => {
    const slide = baseSlide({ id: "delegated" });
    const def = dataSlideToSlideDef(slide);
    const out = render(<>{def.render({ phase: 2 })}</>);
    const node = out.getByTestId("rendered-slide");
    expect(node.getAttribute("data-slide-id")).toBe("delegated");
    expect(node.getAttribute("data-phase")).toBe("2");
  });
});

describe("<DataDeck>", () => {
  it("renders the underlying Deck", () => {
    render(<DataDeck deck={baseDeck()} />);
    expect(screen.getByTestId("deck-stub")).toBeTruthy();
  });

  it("passes deck.meta.slug and deck.meta.title through to Deck", () => {
    render(
      <DataDeck
        deck={baseDeck({
          meta: {
            slug: "kv-only",
            title: "KV Only",
            date: "2026-04-01",
            visibility: "public",
          },
        })}
      />,
    );
    expect(captured?.slug).toBe("kv-only");
    expect(captured?.title).toBe("KV Only");
  });

  it("converts every data slide to a SlideDef", () => {
    render(
      <DataDeck
        deck={baseDeck({
          slides: [
            baseSlide({ id: "a" }),
            baseSlide({ id: "b" }),
            baseSlide({ id: "c" }),
          ],
        })}
      />,
    );
    expect(captured?.slides.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("propagates per-slide phases into the SlideDef", () => {
    render(
      <DataDeck
        deck={baseDeck({
          slides: [
            baseSlide({
              id: "a",
              slots: { x: { kind: "text", value: "x", revealAt: 2 } },
            }),
            baseSlide({
              id: "b",
              slots: {
                p: { kind: "text", value: "p", revealAt: 1 },
                q: { kind: "text", value: "q", revealAt: 4 },
              },
            }),
          ],
        })}
      />,
    );
    expect(captured?.slides[0].phases).toBe(2);
    expect(captured?.slides[1].phases).toBe(4);
  });
});
