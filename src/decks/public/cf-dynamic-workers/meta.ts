/**
 * cf-dynamic-workers deck — metadata only.
 *
 * Lifted out of `index.tsx` so the registry can eagerly load the deck's
 * `DeckMeta` (for the public index card grid + admin list) without
 * pulling in any of the deck's slides / components / assets. Slides are
 * loaded lazily via `loadDeckBySlug(slug)` only when someone actually
 * visits `/decks/<slug>`.
 */
import type { DeckMeta } from "@/framework/viewer/types";

export const meta: DeckMeta = {
  slug: "cf-dynamic-workers",
  title: "Cloudflare Dynamic Workers",
  description:
    "An animated, live-interactive walk-through of Cloudflare Dynamic Workers — spawning V8 isolates on demand from a parent Worker.",
  date: "2026-05-07",
  author: "Miguel Caetano Dias",
  tags: ["dynamic-workers", "live-demo"],
  runtimeMinutes: 12,
};
