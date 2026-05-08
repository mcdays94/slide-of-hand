/**
 * Tests for the template registry's pure transformation step.
 *
 * The real registry calls `import.meta.glob` at module-import time; rather
 * than mock that, we expose `buildTemplateRegistry()` which takes the same
 * shape and apply our assertions on it directly. Mirrors the pattern in
 * `src/lib/decks-registry.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { buildTemplateRegistry, templateRegistry } from "./registry";
import type { SlideTemplate } from "@/lib/template-types";
import type { SlotKind } from "@/lib/slot-types";

const stubTemplate = (id: string): SlideTemplate<Record<string, SlotKind>> => ({
  id,
  label: id,
  description: `the ${id} template`,
  defaultLayout: "default",
  slots: {
    title: { kind: "text", label: "Title", required: true },
  },
  render: () => null,
});

describe("buildTemplateRegistry", () => {
  it("discovers templates from the templates/* path pattern", () => {
    const registry = buildTemplateRegistry({
      "/src/templates/cover/index.tsx": { default: stubTemplate("cover") },
      "/src/templates/default/index.tsx": { default: stubTemplate("default") },
    });
    expect(registry.list()).toHaveLength(2);
    expect(registry.list().map((t) => t.id).sort()).toEqual([
      "cover",
      "default",
    ]);
  });

  it("getById returns the template for a known id", () => {
    const registry = buildTemplateRegistry({
      "/src/templates/cover/index.tsx": { default: stubTemplate("cover") },
    });
    const cover = registry.getById("cover");
    expect(cover).not.toBeNull();
    expect(cover?.id).toBe("cover");
  });

  it("getById returns null for an unknown id", () => {
    const registry = buildTemplateRegistry({
      "/src/templates/cover/index.tsx": { default: stubTemplate("cover") },
    });
    expect(registry.getById("does-not-exist")).toBeNull();
  });

  it("exposes a Map keyed by template id", () => {
    const registry = buildTemplateRegistry({
      "/src/templates/cover/index.tsx": { default: stubTemplate("cover") },
    });
    expect(registry.templates).toBeInstanceOf(Map);
    expect(registry.templates.get("cover")?.id).toBe("cover");
  });

  it("throws when meta.id does not match the folder name", () => {
    expect(() =>
      buildTemplateRegistry({
        "/src/templates/foo/index.tsx": { default: stubTemplate("bar") },
      }),
    ).toThrow(/id mismatch|does not match/i);
  });

  it("throws when default export is not a SlideTemplate", () => {
    expect(() =>
      buildTemplateRegistry({
        "/src/templates/foo/index.tsx": {
          default: {} as SlideTemplate<Record<string, SlotKind>>,
        },
      }),
    ).toThrow(/not a SlideTemplate|invalid template|missing/i);
  });

  it("ignores paths that don't match the registry pattern", () => {
    const registry = buildTemplateRegistry({
      "/src/templates/cover/helper.tsx": { default: stubTemplate("cover") },
      "/src/templates/cover/styles.css": {
        default: stubTemplate("cover"),
      },
    });
    expect(registry.list()).toHaveLength(0);
  });

  it("the live templateRegistry discovers all 3 seed templates", () => {
    const ids = templateRegistry.list().map((t) => t.id).sort();
    expect(ids).toContain("cover");
    expect(ids).toContain("default");
    expect(ids).toContain("two-column");
  });

  it("the live templateRegistry resolves cover by id", () => {
    const cover = templateRegistry.getById("cover");
    expect(cover).not.toBeNull();
    expect(cover?.id).toBe("cover");
    expect(cover?.defaultLayout).toBe("cover");
  });

  it("the live templateRegistry returns null for unknown ids", () => {
    expect(templateRegistry.getById("definitely-not-a-template")).toBeNull();
  });

  it("list() returns templates sorted by id for stable ordering", () => {
    const registry = buildTemplateRegistry({
      "/src/templates/two-column/index.tsx": {
        default: stubTemplate("two-column"),
      },
      "/src/templates/cover/index.tsx": { default: stubTemplate("cover") },
      "/src/templates/default/index.tsx": {
        default: stubTemplate("default"),
      },
    });
    expect(registry.list().map((t) => t.id)).toEqual([
      "cover",
      "default",
      "two-column",
    ]);
  });
});
