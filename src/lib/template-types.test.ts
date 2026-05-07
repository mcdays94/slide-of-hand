/**
 * Tests for the template-types module. Covers the runtime validator
 * (`validateSlotsAgainstTemplate`) and the type-level shape of
 * `SlideTemplate`.
 *
 * No React imports — the `render` function on a template returns a
 * `ReactNode`, but we don't exercise it here. (Slot editors and the
 * deck renderer in Slice 4+ do.)
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  validateSlotsAgainstTemplate,
  type SlideTemplate,
  type SlotSpec,
} from "./template-types";
import type { SlotKind, SlotValue } from "./slot-types";
import type { Layout } from "@/framework/viewer/types";

// A minimal template fixture used across most tests.
const template: SlideTemplate<{ title: "text"; body: "richtext" }> = {
  id: "title-and-body",
  label: "Title and body",
  description: "A title with a body paragraph.",
  defaultLayout: "default",
  slots: {
    title: { kind: "text", label: "Title", required: true, maxLength: 80 },
    body: { kind: "richtext", label: "Body", required: false },
  },
  render: () => null,
};

describe("validateSlotsAgainstTemplate — happy paths", () => {
  it("accepts well-formed required slot only", () => {
    const out = validateSlotsAgainstTemplate(
      { title: { kind: "text", value: "Hello" } },
      template,
    );
    expect(out.ok).toBe(true);
  });

  it("accepts required + optional slot", () => {
    const out = validateSlotsAgainstTemplate(
      {
        title: { kind: "text", value: "Hi" },
        body: { kind: "richtext", value: "<p>x</p>" },
      },
      template,
    );
    expect(out.ok).toBe(true);
  });
});

describe("validateSlotsAgainstTemplate — required slots", () => {
  it("rejects when a required slot is missing", () => {
    const out = validateSlotsAgainstTemplate({}, template);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.some((e) => e.includes("title"))).toBe(true);
  });

  it("rejects when required slot is undefined", () => {
    // `slots[name] = undefined` shows up as a present-but-empty key.
    const out = validateSlotsAgainstTemplate(
      { title: undefined as unknown as SlotValue },
      template,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.length).toBeGreaterThan(0);
  });
});

describe("validateSlotsAgainstTemplate — slot-kind match", () => {
  it("rejects when slot kind differs from template spec", () => {
    const out = validateSlotsAgainstTemplate(
      {
        title: {
          // image where text expected
          kind: "image",
          src: "/x.png",
          alt: "x",
        },
      },
      template,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.some((e) => e.includes("kind"))).toBe(true);
  });

  it("rejects when slot value itself is malformed", () => {
    const out = validateSlotsAgainstTemplate(
      // missing .value in a text slot
      { title: { kind: "text" } as unknown as SlotValue },
      template,
    );
    expect(out.ok).toBe(false);
  });
});

describe("validateSlotsAgainstTemplate — maxLength constraint", () => {
  it("rejects text exceeding maxLength", () => {
    const out = validateSlotsAgainstTemplate(
      { title: { kind: "text", value: "x".repeat(81) } },
      template,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.some((e) => e.includes("maxLength"))).toBe(true);
  });

  it("accepts text exactly at maxLength", () => {
    const out = validateSlotsAgainstTemplate(
      { title: { kind: "text", value: "x".repeat(80) } },
      template,
    );
    expect(out.ok).toBe(true);
  });

  it("only enforces maxLength on text/richtext/code/stat string fields", () => {
    const tmpl: SlideTemplate<{ pic: "image" }> = {
      id: "img",
      label: "Image",
      description: "",
      slots: {
        pic: {
          kind: "image",
          label: "Picture",
          required: true,
          // maxLength on an image slot is meaningless — should be ignored.
          maxLength: 5,
        },
      },
      render: () => null,
    };
    const out = validateSlotsAgainstTemplate(
      {
        pic: {
          kind: "image",
          src: "/very-long-path-that-exceeds-five-chars.png",
          alt: "x",
        },
      },
      tmpl,
    );
    expect(out.ok).toBe(true);
  });
});

describe("validateSlotsAgainstTemplate — unknown slots", () => {
  it("rejects extra slots not in template", () => {
    const out = validateSlotsAgainstTemplate(
      {
        title: { kind: "text", value: "Hi" },
        bogus: { kind: "text", value: "x" },
      },
      template,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.some((e) => e.includes("bogus"))).toBe(true);
  });
});

describe("validateSlotsAgainstTemplate — input validation", () => {
  it("rejects non-object slots input", () => {
    const out = validateSlotsAgainstTemplate(
      null as unknown as Record<string, SlotValue>,
      template,
    );
    expect(out.ok).toBe(false);
  });

  it("collects multiple errors", () => {
    const out = validateSlotsAgainstTemplate(
      {
        title: { kind: "image", src: "/x.png", alt: "x" }, // wrong kind
        bogus: { kind: "text", value: "x" }, // unknown slot
      },
      template,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("type signatures", () => {
  it("SlideTemplate.slots is narrowed to per-key kind", () => {
    expectTypeOf(template.slots.title.kind).toEqualTypeOf<"text">();
    expectTypeOf(template.slots.body.kind).toEqualTypeOf<"richtext">();
  });

  it("SlotSpec carries label + required + optional fields", () => {
    const spec: SlotSpec = {
      kind: "text",
      label: "Title",
      required: true,
      description: "Slide headline",
      maxLength: 80,
      placeholder: "e.g. The Future of Edge",
    };
    expect(spec.required).toBe(true);
  });

  it("Layout is re-exported from the framework", () => {
    // Compile-time check: Layout type accepts the expected literals.
    const layout: Layout = "cover";
    expect(layout).toBe("cover");
  });

  it("SlotKind matches the per-key kind via mapped type", () => {
    type Slots = { a: "text"; b: "image" };
    type Specs = SlideTemplate<Slots>["slots"];
    expectTypeOf<Specs["a"]["kind"]>().toEqualTypeOf<"text">();
    expectTypeOf<Specs["b"]["kind"]>().toEqualTypeOf<"image">();
    // Unused helper to silence noUnusedLocals on the type alias.
    const k: SlotKind = "text";
    expect(k).toBe("text");
  });
});
