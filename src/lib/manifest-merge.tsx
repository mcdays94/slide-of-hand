/**
 * Manifest → SlideDef[] merge step.
 *
 * Pulled out of `manifest.ts` so the Worker (which imports the
 * validation helpers) doesn't pull in React or react-markdown. Only the
 * SPA imports this file.
 */

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { SlideDef } from "@/framework/viewer/types";
import type { Manifest, SlideOverride } from "./manifest";

/**
 * Render a markdown override string as a ReactNode for the speaker-notes
 * pane. Default react-markdown config only — no `rehype-raw`, so authors
 * cannot smuggle arbitrary HTML into notes.
 */
export function mergeNotes(
  sourceNotes: ReactNode,
  overrideMd: string | undefined,
): ReactNode {
  if (overrideMd === undefined) return sourceNotes;
  // Empty-string override is intentional: the author cleared the notes.
  return <ReactMarkdown>{overrideMd}</ReactMarkdown>;
}

/**
 * Layer a manifest onto the source slide list.
 *
 * Behaviour:
 *  - `manifest === null` → return the source array unchanged (same
 *    reference, so memoisation downstream stays cheap).
 *  - For each id in `manifest.order`: look up the source slide. If
 *    found, apply overrides and push to the result. If not found,
 *    `console.warn` once and skip (fail-soft against deleted slides).
 *  - Append source slides that the manifest's `order` doesn't reference
 *    (fail-soft against newly-added slides).
 *
 * Pure beyond a `console.warn` for drift — useful for authors debugging
 * stale manifests but not load-bearing.
 */
export function mergeSlides(
  sourceSlides: SlideDef[],
  manifest: Manifest | null,
): SlideDef[] {
  if (!manifest) return sourceSlides;

  const sourceById = new Map<string, SlideDef>();
  for (const slide of sourceSlides) {
    sourceById.set(slide.id, slide);
  }

  const result: SlideDef[] = [];
  const seen = new Set<string>();

  for (const id of manifest.order) {
    const source = sourceById.get(id);
    if (!source) {
      // Stale manifest reference — the slide was deleted from source.
      // Skip it; <Deck> doesn't need to know.
      // eslint-disable-next-line no-console
      console.warn(
        `[manifest] manifest references unknown slide "${id}" — skipping.`,
      );
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const override = manifest.overrides[id];
    result.push(applyOverride(source, override));
  }

  // Fail-soft: any source slide the manifest doesn't reference gets
  // appended at the end. Keeps freshly-added slides visible even when
  // the saved manifest predates them.
  for (const slide of sourceSlides) {
    if (seen.has(slide.id)) continue;
    seen.add(slide.id);
    result.push(slide);
  }

  return result;
}

function applyOverride(
  source: SlideDef,
  override: SlideOverride | undefined,
): SlideDef {
  if (!override) return source;
  return {
    ...source,
    ...(override.title !== undefined ? { title: override.title } : null),
    ...(override.hidden !== undefined ? { hidden: override.hidden } : null),
    notes: mergeNotes(source.notes, override.notes),
  };
}
