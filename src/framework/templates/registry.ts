/**
 * Template registry — `import.meta.glob`-driven auto-discovery.
 *
 * Every `src/templates/<id>/index.tsx` that default-exports a `SlideTemplate`
 * is picked up. There is no central registration list; drop a folder in and
 * the registry sees it on next reload.
 *
 * Build-time integrity:
 *   - `template.id` MUST match the folder name. We assert this loudly so a
 *     stale rename can't silently break a `DataSlide`'s template lookup.
 *
 * Eager mode:
 *   - We use `{ eager: true }` (matches the deck registry). Vite bundles
 *     every template into the main chunk at build time. This is fine: the
 *     v1 set is small (3 now, ~10 by Slice 10) and every public deck uses
 *     them anyway. If the catalog ever grows past ~30 templates we can
 *     switch to lazy mode + a Suspense boundary in the renderer.
 *
 * Mirrors the pattern in `src/lib/decks-registry.ts`.
 */

import type { SlideTemplate } from "@/lib/template-types";
import type { SlotKind } from "@/lib/slot-types";

// `SlideTemplate<Record<string, SlotKind>>` is the registry-erased shape —
// individual templates are typed more narrowly at their declaration site, but
// once stored in the registry the per-template slot keys are unknown.
type AnyTemplate = SlideTemplate<Record<string, SlotKind>>;

type GlobModule = { default: AnyTemplate };
type GlobResult = Record<string, GlobModule>;

const PATH_RE = /\/templates\/([^/]+)\/index\.tsx?$/;

export interface TemplateRegistry {
  /** Map keyed by `template.id` for O(1) lookup. */
  templates: Map<string, AnyTemplate>;
  /** Resolve a template by id; returns `null` for unknown ids. */
  getById(id: string): AnyTemplate | null;
  /** Stable, alphabetically-sorted list of all templates. */
  list(): AnyTemplate[];
}

/**
 * Pure transformation from a glob result into a `TemplateRegistry`.
 *
 * Exported so tests can pass synthetic glob results without spinning up Vite.
 */
export function buildTemplateRegistry(
  modules: GlobResult,
): TemplateRegistry {
  const map = new Map<string, AnyTemplate>();

  for (const [path, mod] of Object.entries(modules)) {
    const match = PATH_RE.exec(path);
    if (!match) continue;
    const folder = match[1];
    const template = mod.default;

    if (
      !template ||
      typeof template !== "object" ||
      typeof template.id !== "string" ||
      typeof template.render !== "function" ||
      !template.slots ||
      typeof template.slots !== "object"
    ) {
      throw new Error(
        `[template-registry] ${path} is not a SlideTemplate (expected { id, label, slots, render }).`,
      );
    }

    if (template.id !== folder) {
      throw new Error(
        `[template-registry] id mismatch in ${path}: template.id="${template.id}" but folder is "${folder}". They MUST match.`,
      );
    }

    if (map.has(template.id)) {
      throw new Error(
        `[template-registry] duplicate template id "${template.id}" — registered from ${path}.`,
      );
    }

    map.set(template.id, template);
  }

  const sorted = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));

  return {
    templates: map,
    getById(id) {
      return map.get(id) ?? null;
    },
    list() {
      // Defensive copy so callers can't mutate the cached array.
      return sorted.slice();
    },
  };
}

/**
 * Vite glob — `eager: true` so every template is bundled + available at
 * import time (the registry is consumed synchronously by the deck renderer).
 *
 * The relative path lets Vite's static analyser resolve the glob pattern.
 * We don't use `import: 'default'` because the test contract takes the full
 * `{ default: SlideTemplate }` module shape (matching the deck registry).
 */
const modules = import.meta.glob(
  "@/templates/*/index.tsx",
  { eager: true },
) as GlobResult;

export const templateRegistry: TemplateRegistry = buildTemplateRegistry(modules);
