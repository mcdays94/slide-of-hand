/**
 * Demo archived deck (issue #243 / PRD #242).
 *
 * Lives under `src/decks/archive/<slug>/` so the registry auto-tags it
 * with `meta.archived = true`. The folder location IS the source of
 * truth for "archived"; the explicit flag below is informational and
 * defence-in-depth (the registry would inject it regardless).
 *
 * Behavior:
 *   - Hidden from the public homepage `/`.
 *   - `/decks/legacy-demo` returns 404 to the public.
 *   - Visible in the admin Archived section at `/admin`.
 *   - Read-only preview at `/admin/decks/legacy-demo` with a banner.
 *
 * Future slices of PRD #242 add Archive / Restore / Delete actions;
 * this slice is the read model only.
 */
import type { DeckMeta } from "@/framework/viewer/types";

export const meta: DeckMeta = {
  slug: "legacy-demo",
  title: "Legacy demo (archived)",
  description:
    "An example archived deck. Public links return not found; admins can preview read-only.",
  date: "2024-01-01",
  archived: true,
};
