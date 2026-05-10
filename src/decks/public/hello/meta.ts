/**
 * Hello deck — metadata only.
 *
 * Lifted out of `index.tsx` so the registry can eagerly load the deck's
 * `DeckMeta` (for the public index card grid + admin list) without
 * pulling in any of the deck's slides / components / assets. Slides are
 * loaded lazily via `loadDeckBySlug(slug)` only when someone actually
 * visits `/decks/<slug>`.
 */
import type { DeckMeta } from "@/framework/viewer/types";

export const meta: DeckMeta = {
  slug: "hello",
  title: "Hello, Slide of Hand",
  description:
    "A short demo of the Slide of Hand framework — phase reveals, layouts, presenter affordances.",
  date: "2026-05-01",
  author: "Miguel Caetano Dias",
  runtimeMinutes: 2,
  tags: ["demo", "framework"],
};
