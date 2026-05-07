/**
 * Pure-validation tests for the slot-types module. No DOM, no React, no
 * Worker — these are isolated checks on the tagged-union shape so both
 * the slot editors (frontend) and the Worker (POST validation) can rely
 * on them.
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  SLOT_KINDS,
  isSlotValue,
  validateSlotValue,
  type SlotKind,
  type SlotValue,
} from "./slot-types";

describe("SLOT_KINDS", () => {
  it("exposes the six v1 kinds", () => {
    expect(SLOT_KINDS).toEqual([
      "text",
      "richtext",
      "image",
      "code",
      "list",
      "stat",
    ]);
  });

  it("SlotKind matches the const tuple", () => {
    // Type-level lock so adding/removing a kind requires updating both.
    expectTypeOf<SlotKind>().toEqualTypeOf<
      "text" | "richtext" | "image" | "code" | "list" | "stat"
    >();
  });
});

describe("isSlotValue — accepts well-formed values", () => {
  it("accepts text", () => {
    expect(isSlotValue({ kind: "text", value: "hello" })).toBe(true);
  });
  it("accepts richtext", () => {
    expect(isSlotValue({ kind: "richtext", value: "<p>hi</p>" })).toBe(true);
  });
  it("accepts image with src + alt", () => {
    expect(
      isSlotValue({ kind: "image", src: "/cover.png", alt: "cover" }),
    ).toBe(true);
  });
  it("accepts code with lang + value", () => {
    expect(
      isSlotValue({ kind: "code", lang: "ts", value: "const x = 1" }),
    ).toBe(true);
  });
  it("accepts list with string items", () => {
    expect(isSlotValue({ kind: "list", items: ["a", "b"] })).toBe(true);
  });
  it("accepts list with empty items array", () => {
    expect(isSlotValue({ kind: "list", items: [] })).toBe(true);
  });
  it("accepts stat without caption", () => {
    expect(isSlotValue({ kind: "stat", value: "42%" })).toBe(true);
  });
  it("accepts stat with caption", () => {
    expect(
      isSlotValue({ kind: "stat", value: "42%", caption: "uplift" }),
    ).toBe(true);
  });
});

describe("isSlotValue — rejects malformed", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "text"],
    ["number", 42],
    ["array", []],
    ["empty object", {}],
    ["unknown kind", { kind: "video", url: "/foo.mp4" }],
    ["text missing value", { kind: "text" }],
    ["text non-string value", { kind: "text", value: 1 }],
    ["image missing alt", { kind: "image", src: "/x.png" }],
    ["image missing src", { kind: "image", alt: "x" }],
    ["image non-string src", { kind: "image", src: 1, alt: "x" }],
    ["code missing lang", { kind: "code", value: "x" }],
    ["code missing value", { kind: "code", lang: "ts" }],
    ["list missing items", { kind: "list" }],
    ["list non-array items", { kind: "list", items: "a,b" }],
    ["list non-string item", { kind: "list", items: ["a", 2] }],
    ["stat missing value", { kind: "stat" }],
    ["stat non-string caption", { kind: "stat", value: "x", caption: 1 }],
  ])("rejects %s", (_, input) => {
    expect(isSlotValue(input)).toBe(false);
  });
});

describe("revealAt — optional but type-checked when present", () => {
  it("accepts omitted revealAt", () => {
    expect(isSlotValue({ kind: "text", value: "x" })).toBe(true);
  });
  it("accepts revealAt = 0", () => {
    expect(isSlotValue({ kind: "text", value: "x", revealAt: 0 })).toBe(true);
  });
  it("accepts a positive integer revealAt", () => {
    expect(isSlotValue({ kind: "text", value: "x", revealAt: 3 })).toBe(true);
  });
  it("rejects negative revealAt", () => {
    expect(isSlotValue({ kind: "text", value: "x", revealAt: -1 })).toBe(false);
  });
  it("rejects non-integer revealAt", () => {
    expect(isSlotValue({ kind: "text", value: "x", revealAt: 1.5 })).toBe(
      false,
    );
  });
  it("rejects string revealAt", () => {
    expect(isSlotValue({ kind: "text", value: "x", revealAt: "1" })).toBe(
      false,
    );
  });
  it("rejects NaN revealAt", () => {
    expect(isSlotValue({ kind: "text", value: "x", revealAt: NaN })).toBe(
      false,
    );
  });
  it("rejects Infinity revealAt", () => {
    expect(
      isSlotValue({ kind: "text", value: "x", revealAt: Infinity }),
    ).toBe(false);
  });
});

describe("validateSlotValue — returns typed result", () => {
  it("returns ok:true with the typed value on success", () => {
    const out = validateSlotValue({ kind: "text", value: "hi" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.kind).toBe("text");
    if (out.value.kind === "text") {
      // Type narrowing should give us .value
      expect(out.value.value).toBe("hi");
    }
  });

  it("returns ok:false with an error string for unknown kind", () => {
    const out = validateSlotValue({ kind: "video", value: "x" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(typeof out.error).toBe("string");
    expect(out.error.length).toBeGreaterThan(0);
  });

  it("returns ok:false for missing required field", () => {
    const out = validateSlotValue({ kind: "image", src: "/x.png" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/alt/);
  });

  it("returns ok:false for malformed revealAt", () => {
    const out = validateSlotValue({
      kind: "text",
      value: "x",
      revealAt: -3,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/revealAt/);
  });
});

describe("SlotValue tagged-union narrowing", () => {
  it("switch on .kind narrows to the per-kind shape", () => {
    const probe = (sv: SlotValue): string => {
      switch (sv.kind) {
        case "text":
        case "richtext":
          return sv.value;
        case "image":
          return `${sv.src}|${sv.alt}`;
        case "code":
          return `${sv.lang}:${sv.value}`;
        case "list":
          return sv.items.join(",");
        case "stat":
          return sv.caption ? `${sv.value} (${sv.caption})` : sv.value;
      }
    };
    expect(probe({ kind: "text", value: "t" })).toBe("t");
    expect(probe({ kind: "image", src: "/i.png", alt: "i" })).toBe(
      "/i.png|i",
    );
    expect(probe({ kind: "list", items: ["a", "b"] })).toBe("a,b");
    expect(probe({ kind: "stat", value: "9", caption: "c" })).toBe("9 (c)");
  });
});
