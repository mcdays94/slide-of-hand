/**
 * Unit tests for `mergeSlides` and `mergeNotes`.
 *
 * The merge function is the one piece that must be bullet-proof: it
 * runs on every render path (public + admin) and any failure makes the
 * deck disappear. Hence the broad case coverage.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import type { Manifest } from "./manifest";
import { mergeSlides, mergeNotes } from "./manifest-merge";

function s(id: string, extras: Partial<SlideDef> = {}): SlideDef {
  return {
    id,
    title: id.toUpperCase(),
    render: () => null,
    ...extras,
  };
}

const sourceSlides: SlideDef[] = [
  s("title"),
  s("intro"),
  s("middle"),
  s("end"),
];

describe("mergeSlides", () => {
  it("returns the source slides unchanged when manifest is null", () => {
    const out = mergeSlides(sourceSlides, null);
    expect(out).toBe(sourceSlides);
  });

  it("respects the manifest order when all source ids are present", () => {
    const manifest: Manifest = {
      version: 1,
      order: ["end", "title", "middle", "intro"],
      overrides: {},
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    const out = mergeSlides(sourceSlides, manifest);
    expect(out.map((slide) => slide.id)).toEqual([
      "end",
      "title",
      "middle",
      "intro",
    ]);
  });

  it("applies the `hidden` override", () => {
    const manifest: Manifest = {
      version: 1,
      order: ["title", "intro", "middle", "end"],
      overrides: { intro: { hidden: true } },
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    const out = mergeSlides(sourceSlides, manifest);
    expect(out.find((slide) => slide.id === "intro")?.hidden).toBe(true);
  });

  it("applies the `title` override", () => {
    const manifest: Manifest = {
      version: 1,
      order: ["title", "intro", "middle", "end"],
      overrides: { intro: { title: "Renamed intro" } },
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    const out = mergeSlides(sourceSlides, manifest);
    expect(out.find((slide) => slide.id === "intro")?.title).toBe(
      "Renamed intro",
    );
    expect(out.find((slide) => slide.id === "title")?.title).toBe("TITLE");
  });

  it("renders an override `notes` string as markdown ReactNode", () => {
    const manifest: Manifest = {
      version: 1,
      order: ["title", "intro", "middle", "end"],
      overrides: { intro: { notes: "**bold** and _italic_" } },
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    const out = mergeSlides(sourceSlides, manifest);
    const html = renderToStaticMarkup(
      out.find((slide) => slide.id === "intro")?.notes as ReactElement,
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("skips manifest order entries that don't exist in source (fail-soft)", () => {
    const manifest: Manifest = {
      version: 1,
      order: ["title", "ghost", "intro", "middle", "end"],
      overrides: {},
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    const out = mergeSlides(sourceSlides, manifest);
    expect(out.map((slide) => slide.id)).toEqual([
      "title",
      "intro",
      "middle",
      "end",
    ]);
  });

  it("appends source slides not referenced by the manifest (fail-soft)", () => {
    const manifest: Manifest = {
      version: 1,
      order: ["title", "intro"],
      overrides: {},
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    const out = mergeSlides(sourceSlides, manifest);
    expect(out.map((slide) => slide.id)).toEqual([
      "title",
      "intro",
      "middle",
      "end",
    ]);
  });

  it("treats an empty overrides object as no overrides", () => {
    const manifest: Manifest = {
      version: 1,
      order: ["title", "intro", "middle", "end"],
      overrides: {},
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    const out = mergeSlides(sourceSlides, manifest);
    expect(out.map((slide) => slide.title)).toEqual([
      "TITLE",
      "INTRO",
      "MIDDLE",
      "END",
    ]);
  });

  it("preserves the source render function and other fields", () => {
    const customRender = () => null;
    const sources: SlideDef[] = [
      { id: "a", title: "A", phases: 3, render: customRender },
    ];
    const manifest: Manifest = {
      version: 1,
      order: ["a"],
      overrides: { a: { title: "Renamed A" } },
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    const [out] = mergeSlides(sources, manifest);
    expect(out.title).toBe("Renamed A");
    expect(out.phases).toBe(3);
    expect(out.render).toBe(customRender);
  });
});

describe("mergeNotes", () => {
  it("returns the source notes unchanged when override is undefined", () => {
    const sourceNotes = "literal node";
    expect(mergeNotes(sourceNotes, undefined)).toBe(sourceNotes);
  });

  it("returns a markdown ReactNode when override is a string", () => {
    const node = mergeNotes(undefined, "**hi**");
    const html = renderToStaticMarkup(node as ReactElement);
    expect(html).toContain("<strong>hi</strong>");
  });

  it("returns a markdown ReactNode for an empty string override", () => {
    // Empty-string override is meaningful — author cleared the notes.
    const node = mergeNotes("source notes", "");
    const html = renderToStaticMarkup(node as ReactElement);
    expect(html).not.toContain("source notes");
  });
});
