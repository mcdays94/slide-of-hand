/**
 * Unit tests for the validator portion of the manifest contract.
 *
 * `mergeSlides` and `mergeNotes` are tested in `manifest-merge.test.tsx`
 * (they pull in JSX and react-markdown).
 */
import { describe, it, expect } from "vitest";
import { validateManifestBody } from "./manifest";

describe("validateManifestBody", () => {
  it("accepts a minimal valid body", () => {
    const result = validateManifestBody({
      order: ["title", "intro"],
      overrides: {},
    });
    expect(result.ok).toBe(true);
  });

  it("accepts overrides with all three optional fields", () => {
    const result = validateManifestBody({
      order: ["a", "b"],
      overrides: {
        a: { hidden: true, title: "Hi", notes: "**hi**" },
        b: { hidden: false },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object body", () => {
    expect(validateManifestBody(null).ok).toBe(false);
    expect(validateManifestBody("nope").ok).toBe(false);
    expect(validateManifestBody([]).ok).toBe(false);
  });

  it("rejects a non-array order", () => {
    const result = validateManifestBody({ order: "title", overrides: {} });
    expect(result.ok).toBe(false);
  });

  it("rejects an order array with non-string entries", () => {
    const result = validateManifestBody({
      order: ["title", 42],
      overrides: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an order array with a non-kebab-case slug", () => {
    const result = validateManifestBody({
      order: ["title", "Bad Slug"],
      overrides: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an order array containing duplicates", () => {
    const result = validateManifestBody({
      order: ["title", "title"],
      overrides: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects override entries with unknown keys", () => {
    const result = validateManifestBody({
      order: ["title"],
      overrides: { title: { foo: "bar" } },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects override hidden that's not a boolean", () => {
    const result = validateManifestBody({
      order: ["title"],
      overrides: { title: { hidden: "yes" } },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects override title that's too long", () => {
    const result = validateManifestBody({
      order: ["title"],
      overrides: { title: { title: "x".repeat(201) } },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects override notes that are too long", () => {
    const result = validateManifestBody({
      order: ["title"],
      overrides: { title: { notes: "x".repeat(10001) } },
    });
    expect(result.ok).toBe(false);
  });

  it("returns the normalized payload on success", () => {
    const result = validateManifestBody({
      order: ["title", "intro"],
      overrides: { intro: { hidden: true, title: "T" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.order).toEqual(["title", "intro"]);
      expect(result.value.overrides).toEqual({
        intro: { hidden: true, title: "T" },
      });
    }
  });

  it("rejects override entries that are not objects", () => {
    const result = validateManifestBody({
      order: ["title"],
      overrides: { title: "nope" },
    });
    expect(result.ok).toBe(false);
  });
});
