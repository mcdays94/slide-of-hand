/**
 * Tests for the curated Tailwind token catalog. These tests don't try
 * to validate that each class actually resolves through Tailwind 4 at
 * build time — that's the build's job. They DO enforce the shape +
 * curation invariants from #44 AC.
 */
import { describe, it, expect } from "vitest";
import {
  TAILWIND_TOKENS,
  type TokenCategory,
  type TokenGroup,
} from "./tailwind-tokens";

const ALL_CATEGORIES: TokenCategory[] = [
  "color",
  "background",
  "typography",
  "spacing",
  "border",
  "sizing",
];

const totalTokens = (groups: TokenGroup[]): number =>
  groups.reduce((acc, g) => acc + g.classNames.length, 0);

describe("TAILWIND_TOKENS catalog shape", () => {
  it("contains exactly 6 token groups (one per category)", () => {
    expect(TAILWIND_TOKENS).toHaveLength(6);
  });

  it("covers all 6 documented categories", () => {
    const present = new Set(TAILWIND_TOKENS.map((g) => g.category));
    for (const c of ALL_CATEGORIES) {
      expect(present.has(c)).toBe(true);
    }
  });

  it("does not duplicate any category", () => {
    const cats = TAILWIND_TOKENS.map((g) => g.category);
    expect(new Set(cats).size).toBe(cats.length);
  });

  it("has between 30 and 50 total tokens (curated, not exhaustive)", () => {
    const total = totalTokens(TAILWIND_TOKENS);
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(50);
  });
});

describe("TokenGroup shape", () => {
  it.each(TAILWIND_TOKENS)("group %# ($category) has a non-empty label", (group) => {
    expect(group.label.trim().length).toBeGreaterThan(0);
  });

  it.each(TAILWIND_TOKENS)(
    "group %# ($category) has a non-empty description",
    (group) => {
      expect(group.description.trim().length).toBeGreaterThan(0);
    },
  );

  it.each(TAILWIND_TOKENS)(
    "group %# ($category) has a non-empty classNames array",
    (group) => {
      expect(group.classNames.length).toBeGreaterThan(0);
    },
  );

  it.each(TAILWIND_TOKENS)(
    "group %# ($category) has no duplicate classNames within itself",
    (group) => {
      expect(new Set(group.classNames).size).toBe(group.classNames.length);
    },
  );
});

describe("Class name validity", () => {
  it("every className is a non-empty string", () => {
    for (const group of TAILWIND_TOKENS) {
      for (const cn of group.classNames) {
        expect(typeof cn).toBe("string");
        expect(cn.length).toBeGreaterThan(0);
      }
    }
  });

  it("every className is a SINGLE class (no internal whitespace)", () => {
    for (const group of TAILWIND_TOKENS) {
      for (const cn of group.classNames) {
        expect(cn).not.toMatch(/\s/);
      }
    }
  });

  it("does not duplicate class names across groups", () => {
    const all: string[] = [];
    for (const group of TAILWIND_TOKENS) all.push(...group.classNames);
    expect(new Set(all).size).toBe(all.length);
  });

  it("avoids brand anti-patterns (no white/black tokens, no bold)", () => {
    for (const group of TAILWIND_TOKENS) {
      for (const cn of group.classNames) {
        expect(cn).not.toMatch(/^(text|bg|border)-(white|black)$/);
        expect(cn).not.toBe("font-bold");
      }
    }
  });
});

describe("SoH design system spot-checks", () => {
  // Helper: flatten the catalog so individual tokens can be looked up.
  const allClassNames = TAILWIND_TOKENS.flatMap((g) => g.classNames);

  it("includes the SoH text colors", () => {
    expect(allClassNames).toContain("text-cf-orange");
    expect(allClassNames).toContain("text-cf-text");
    expect(allClassNames).toContain("text-cf-text-muted");
    expect(allClassNames).toContain("text-cf-text-subtle");
  });

  it("includes the SoH surface colors", () => {
    expect(allClassNames).toContain("bg-cf-bg-100");
    expect(allClassNames).toContain("bg-cf-bg-200");
    expect(allClassNames).toContain("bg-cf-bg-300");
  });

  it("includes the SoH border tokens (solid + dashed for hover affordance)", () => {
    expect(allClassNames).toContain("border-cf-border");
    expect(allClassNames).toContain("border-dashed");
  });

  it("includes both SoH font families (mono kicker + medium body)", () => {
    expect(allClassNames).toContain("font-mono");
    expect(allClassNames).toContain("font-medium");
  });

  it("scopes typography classes to the type scale used in decks", () => {
    const typographyGroup = TAILWIND_TOKENS.find(
      (g) => g.category === "typography",
    );
    expect(typographyGroup).toBeDefined();
    // At least one large heading-class size should appear, since
    // headings are the most-likely target for an in-talk override.
    const hasLarge = typographyGroup!.classNames.some((cn) =>
      /^text-[2-9]xl$/.test(cn),
    );
    expect(hasLarge).toBe(true);
  });
});
