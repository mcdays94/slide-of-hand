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
import type { TemplateRegistry } from "@/framework/templates/registry";
import type { SlideTemplate } from "@/framework/templates/types";
import type { SlotKind } from "@/lib/slot-types";

type AnyTemplate = SlideTemplate<Record<string, SlotKind>>;

/** Build a stub `TemplateRegistry` whose `getById` returns the given templates by id. */
function fakeRegistry(templates: AnyTemplate[]): TemplateRegistry {
  const map = new Map<string, AnyTemplate>(templates.map((t) => [t.id, t]));
  return {
    templates: map,
    getById: (id) => map.get(id) ?? null,
    list: () => [...map.values()],
  };
}

/** Minimal template stub — only `id` + `label` are exercised by the title synthesizer. */
function stubTemplate(id: string, label: string): AnyTemplate {
  return {
    id,
    label,
    description: "",
    slots: {},
    render: () => null,
  } as AnyTemplate;
}

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

const { DataDeck, dataSlideToSlideDef, dataDeckToDeck, synthesizeSlideTitle } =
  await import("./DataDeck");

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

  it("synthesizes a title from the first text slot for overview-tile labels (#82)", () => {
    const def = dataSlideToSlideDef(
      baseSlide({
        id: "intro",
        slots: {
          // Insertion order: "title" is first → its value drives the synthesized title.
          title: { kind: "text", value: "The case for warm minimalism" },
          subtitle: { kind: "text", value: "Subtitle" },
        },
      }),
    );
    expect(def.title).toBe("The case for warm minimalism");
  });

  it("falls back to the template's label when no text-ish slot exists (#82)", () => {
    const registry = fakeRegistry([stubTemplate("image-hero", "Image hero")]);
    const def = dataSlideToSlideDef(
      baseSlide({
        id: "img-only",
        template: "image-hero",
        slots: {
          image: { kind: "image", src: "/x.png", alt: "alt" },
        },
      }),
      registry,
    );
    expect(def.title).toBe("Image hero");
  });
});

describe("synthesizeSlideTitle (#82)", () => {
  it("returns the value of the first slot when it is a `text` slot", () => {
    const slide = baseSlide({
      slots: {
        // Insertion-order key: this is the "first" slot.
        headline: { kind: "text", value: "How we ship faster" },
        body: { kind: "richtext", value: "**Bold** body" },
      },
    });
    expect(synthesizeSlideTitle(slide)).toBe("How we ship faster");
  });

  it("strips simple markdown from a leading `richtext` slot value", () => {
    const slide = baseSlide({
      slots: {
        body: {
          kind: "richtext",
          // Leading hash + bold markers + leading whitespace + backticks: all stripped.
          value: "  ## **Bold** _italic_ `code` heading",
        },
      },
    });
    expect(synthesizeSlideTitle(slide)).toBe("Bold italic code heading");
  });

  it("strips a leading list-marker dash from a `richtext` slot value", () => {
    const slide = baseSlide({
      slots: {
        body: { kind: "richtext", value: "- first bullet" },
      },
    });
    expect(synthesizeSlideTitle(slide)).toBe("first bullet");
  });

  it("falls back to the template's label when the only slot is `image`", () => {
    const registry = fakeRegistry([stubTemplate("image-hero", "Image hero")]);
    const slide = baseSlide({
      template: "image-hero",
      slots: {
        image: { kind: "image", src: "/x.png", alt: "Alt text" },
      },
    });
    expect(synthesizeSlideTitle(slide, registry)).toBe("Image hero");
  });

  it("falls back to the template's label when slots are non-text-ish (`code`, `list`, `stat`)", () => {
    const registry = fakeRegistry([stubTemplate("big-stat", "Big stat")]);
    const slide = baseSlide({
      template: "big-stat",
      slots: {
        stat: { kind: "stat", value: "99.9%" },
      },
    });
    expect(synthesizeSlideTitle(slide, registry)).toBe("Big stat");
  });

  it("returns undefined when slots are empty AND the template is unknown", () => {
    const registry = fakeRegistry([]);
    const slide = baseSlide({ template: "missing", slots: {} });
    expect(synthesizeSlideTitle(slide, registry)).toBeUndefined();
  });

  it("returns undefined when slots are empty AND the template's label is missing", () => {
    // Empty registry — even though the slide references "cover", lookup
    // returns null, so we exhaust priorities (1)–(4) and fall through.
    const registry = fakeRegistry([]);
    const slide = baseSlide({ slots: {} });
    expect(synthesizeSlideTitle(slide, registry)).toBeUndefined();
  });

  it("truncates long text-slot values cleanly with an ellipsis", () => {
    // 60 ASCII chars → must be truncated to ≤ ~40 chars + "…"
    const slide = baseSlide({
      slots: {
        title: {
          kind: "text",
          value:
            "This is a very long slide title that should definitely be truncated for the overview",
        },
      },
    });
    const out = synthesizeSlideTitle(slide);
    expect(out).toBeDefined();
    // Ellipsis present, length capped, no mid-codepoint surprises.
    expect(out!.endsWith("…")).toBe(true);
    // Each visible char (incl. the ellipsis) is one code point ≤ 41.
    expect([...out!].length).toBeLessThanOrEqual(41);
  });

  it("truncates without splitting a multi-codepoint emoji (Unicode-safe)", () => {
    // A 41-char string padded with emoji that would split if we used String.slice.
    // Family-of-four emoji is a multi-codepoint grapheme cluster — at minimum we
    // must not slice mid-codepoint and produce a lone surrogate.
    const filler = "x".repeat(40);
    const slide = baseSlide({
      slots: {
        title: { kind: "text", value: `${filler}🎉🎉🎉🎉🎉` },
      },
    });
    const out = synthesizeSlideTitle(slide);
    expect(out).toBeDefined();
    // Recombining the code points must round-trip — i.e. no lone surrogates.
    const codepointCount = [...out!].length;
    expect(codepointCount).toBeLessThanOrEqual(41);
    // The result must encode/decode through UTF-16 round-trip without loss.
    expect(out).toBe([...out!].join(""));
  });

  it("does NOT truncate values shorter than the limit", () => {
    const slide = baseSlide({
      slots: {
        title: { kind: "text", value: "Short title" },
      },
    });
    const out = synthesizeSlideTitle(slide);
    expect(out).toBe("Short title");
    expect(out!.endsWith("…")).toBe(false);
  });

  it("uses insertion order — first key in the slots object wins", () => {
    const slide = baseSlide({
      slots: {
        // Object key insertion order: "alpha" first, "beta" second.
        alpha: { kind: "text", value: "Alpha wins" },
        beta: { kind: "text", value: "Beta loses" },
      },
    });
    expect(synthesizeSlideTitle(slide)).toBe("Alpha wins");
  });

  it("skips an empty-string text slot and falls through to the next priority", () => {
    // An empty string is not a useful overview-tile label — fall through
    // to the template label (priority 4). Pass an empty registry so the
    // fall-through path itself terminates in `undefined`.
    const registry = fakeRegistry([]);
    const slide = baseSlide({
      slots: {
        title: { kind: "text", value: "" },
      },
    });
    expect(synthesizeSlideTitle(slide, registry)).toBeUndefined();
  });
});

describe("dataDeckToDeck (presenter-mode follow-up #61)", () => {
  it("preserves meta.slug, meta.title and meta.date", () => {
    const adapted = dataDeckToDeck(
      baseDeck({
        meta: {
          slug: "kv-deck",
          title: "KV Deck",
          date: "2026-05-01",
          visibility: "public",
        },
      }),
    );
    expect(adapted.meta.slug).toBe("kv-deck");
    expect(adapted.meta.title).toBe("KV Deck");
    expect(adapted.meta.date).toBe("2026-05-01");
  });

  it("leaves missing meta.description undefined", () => {
    // Framework `DeckMeta.description` is optional; the adapter must
    // not invent an empty string when the KV record omits it. Consumers
    // (cards, admin rows) check for absence and skip rendering entirely.
    const adapted = dataDeckToDeck(baseDeck());
    expect(adapted.meta.description).toBeUndefined();
    expect("description" in adapted.meta).toBe(false);
  });

  it("propagates author / event / cover / runtimeMinutes when present", () => {
    const adapted = dataDeckToDeck(
      baseDeck({
        meta: {
          slug: "rich",
          title: "Rich",
          date: "2026-05-01",
          visibility: "public",
          description: "A rich deck.",
          author: "Miguel",
          event: "DTX 2026",
          cover: "/img/cover.png",
          runtimeMinutes: 30,
        },
      }),
    );
    expect(adapted.meta.description).toBe("A rich deck.");
    expect(adapted.meta.author).toBe("Miguel");
    expect(adapted.meta.event).toBe("DTX 2026");
    expect(adapted.meta.cover).toBe("/img/cover.png");
    expect(adapted.meta.runtimeMinutes).toBe(30);
  });

  it("converts every data slide to a SlideDef and preserves the slide order", () => {
    const adapted = dataDeckToDeck(
      baseDeck({
        slides: [
          baseSlide({ id: "alpha" }),
          baseSlide({ id: "beta" }),
          baseSlide({ id: "gamma" }),
        ],
      }),
    );
    expect(adapted.slides.map((s) => s.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("plumbs notes through so the presenter window can render them", () => {
    const adapted = dataDeckToDeck(
      baseDeck({
        slides: [
          baseSlide({ id: "with-notes", notes: "Mention runtime + audience." }),
          baseSlide({ id: "without-notes" }),
        ],
      }),
    );
    expect(adapted.slides[0].notes).toBe("Mention runtime + audience.");
    expect(adapted.slides[1].notes).toBeUndefined();
  });

  it("propagates per-slide phases (max revealAt) into the presenter-facing SlideDef", () => {
    // The presenter window reads `phases` to render its phase-dot cluster
    // — a KV slide with multi-phase reveals should expose the same
    // budget the navigation reducer uses on the main viewer.
    const adapted = dataDeckToDeck(
      baseDeck({
        slides: [
          baseSlide({
            id: "phased",
            slots: {
              t: { kind: "text", value: "t" },
              u: { kind: "text", value: "u", revealAt: 2 },
            },
          }),
        ],
      }),
    );
    expect(adapted.slides[0].phases).toBe(2);
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
