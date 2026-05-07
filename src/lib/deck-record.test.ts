/**
 * Tests for the deck-record module — `DataDeck` and `DataSlide` types
 * plus the `validateDataDeck` validator. Validates the *shape* only:
 * does not know template definitions (those checks live in
 * `validateSlotsAgainstTemplate`).
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  validateDataDeck,
  type DataDeck,
  type DataSlide,
} from "./deck-record";
import type { Layout } from "@/framework/viewer/types";

const validDeck: DataDeck = {
  meta: {
    slug: "hello",
    title: "Hello world",
    date: "2026-05-01",
    visibility: "public",
  },
  slides: [],
};

describe("validateDataDeck — happy paths", () => {
  it("accepts a minimal deck with empty slides", () => {
    const out = validateDataDeck(validDeck);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.meta.slug).toBe("hello");
  });

  it("accepts a deck with optional meta fields populated", () => {
    const out = validateDataDeck({
      meta: {
        slug: "hello",
        title: "Hi",
        description: "An intro deck",
        date: "2026-05-01",
        author: "Miguel",
        event: "DTX",
        cover: "/cover.png",
        runtimeMinutes: 20,
        visibility: "private",
      },
      slides: [],
    });
    expect(out.ok).toBe(true);
  });

  it("accepts a deck with one fully-formed slide", () => {
    const out = validateDataDeck({
      meta: {
        slug: "hello",
        title: "Hi",
        date: "2026-05-01",
        visibility: "public",
      },
      slides: [
        {
          id: "cover",
          template: "title-and-body",
          layout: "cover",
          slots: {
            title: { kind: "text", value: "Hello" },
            body: { kind: "richtext", value: "<p>x</p>" },
          },
          notes: "Intro",
          hidden: false,
        },
      ],
    });
    expect(out.ok).toBe(true);
  });

  it("accepts a slide with no slots", () => {
    const out = validateDataDeck({
      ...validDeck,
      slides: [
        { id: "cover", template: "blank", slots: {} },
      ],
    });
    expect(out.ok).toBe(true);
  });

  it("accepts visibility = private", () => {
    const out = validateDataDeck({
      ...validDeck,
      meta: { ...validDeck.meta, visibility: "private" },
    });
    expect(out.ok).toBe(true);
  });
});

describe("validateDataDeck — meta validation", () => {
  it("rejects null body", () => {
    const out = validateDataDeck(null);
    expect(out.ok).toBe(false);
  });

  it("rejects array body", () => {
    const out = validateDataDeck([]);
    expect(out.ok).toBe(false);
  });

  it("rejects missing meta", () => {
    const out = validateDataDeck({ slides: [] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.some((e) => e.includes("meta"))).toBe(true);
  });

  it.each([
    ["missing slug", { ...validDeck.meta, slug: undefined }],
    ["empty slug", { ...validDeck.meta, slug: "" }],
    ["non-string slug", { ...validDeck.meta, slug: 123 }],
    ["uppercase slug", { ...validDeck.meta, slug: "Hello" }],
    ["slug with dots", { ...validDeck.meta, slug: "../etc" }],
    ["missing title", { ...validDeck.meta, title: undefined }],
    ["non-string title", { ...validDeck.meta, title: 1 }],
    ["empty title", { ...validDeck.meta, title: "" }],
    ["missing date", { ...validDeck.meta, date: undefined }],
    ["malformed date", { ...validDeck.meta, date: "5/1/2026" }],
    ["missing visibility", { ...validDeck.meta, visibility: undefined }],
    ["invalid visibility", { ...validDeck.meta, visibility: "secret" }],
    ["non-number runtimeMinutes", {
      ...validDeck.meta,
      runtimeMinutes: "20",
    }],
    ["negative runtimeMinutes", { ...validDeck.meta, runtimeMinutes: -1 }],
    ["non-string author", { ...validDeck.meta, author: 1 }],
    ["non-string description", { ...validDeck.meta, description: 1 }],
    ["non-string cover", { ...validDeck.meta, cover: 5 }],
    ["non-string event", { ...validDeck.meta, event: false }],
  ])("rejects meta with %s", (_, badMeta) => {
    const out = validateDataDeck({ meta: badMeta, slides: [] });
    expect(out.ok).toBe(false);
  });
});

describe("validateDataDeck — slides validation", () => {
  it("rejects missing slides", () => {
    const out = validateDataDeck({ meta: validDeck.meta });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.some((e) => e.includes("slides"))).toBe(true);
  });

  it("rejects non-array slides", () => {
    const out = validateDataDeck({ ...validDeck, slides: "x" });
    expect(out.ok).toBe(false);
  });

  it.each([
    ["null slide", null],
    ["array slide", []],
    ["string slide", "slide"],
    ["missing id", { template: "t", slots: {} }],
    ["empty id", { id: "", template: "t", slots: {} }],
    ["non-string id", { id: 1, template: "t", slots: {} }],
    ["uppercase id", { id: "Cover", template: "t", slots: {} }],
    ["missing template", { id: "cover", slots: {} }],
    ["empty template", { id: "cover", template: "", slots: {} }],
    ["non-string template", { id: "cover", template: 1, slots: {} }],
    ["missing slots", { id: "cover", template: "t" }],
    ["non-object slots", { id: "cover", template: "t", slots: "x" }],
    [
      "invalid layout",
      {
        id: "cover",
        template: "t",
        slots: {},
        layout: "weird",
      },
    ],
    [
      "non-string notes",
      { id: "cover", template: "t", slots: {}, notes: 1 },
    ],
    [
      "non-boolean hidden",
      { id: "cover", template: "t", slots: {}, hidden: "yes" },
    ],
  ])("rejects slide with %s", (_, badSlide) => {
    const out = validateDataDeck({
      ...validDeck,
      slides: [badSlide],
    });
    expect(out.ok).toBe(false);
  });

  it("rejects when a slot value is malformed", () => {
    const out = validateDataDeck({
      ...validDeck,
      slides: [
        {
          id: "cover",
          template: "t",
          slots: {
            title: { kind: "text" }, // missing .value
          },
        },
      ],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.some((e) => e.includes("title"))).toBe(true);
  });

  it("rejects duplicate slide ids", () => {
    const out = validateDataDeck({
      ...validDeck,
      slides: [
        { id: "cover", template: "t", slots: {} },
        { id: "cover", template: "t", slots: {} },
      ],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("collects multiple errors across slides", () => {
    const out = validateDataDeck({
      ...validDeck,
      slides: [
        { id: "", template: "t", slots: {} },
        { id: "cover", template: "", slots: {} },
      ],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("type signatures", () => {
  it("DataSlide accepts each layout literal", () => {
    const slide: DataSlide = {
      id: "x",
      template: "t",
      layout: "cover",
      slots: {},
    };
    expectTypeOf(slide.layout).toEqualTypeOf<Layout | undefined>();
  });

  it("DataDeck.meta.visibility is the public/private union", () => {
    expectTypeOf<DataDeck["meta"]["visibility"]>().toEqualTypeOf<
      "public" | "private"
    >();
  });
});
