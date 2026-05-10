/**
 * cf-zt-ai deck — metadata only.
 *
 * Lifted out of `index.tsx` so the registry can eagerly load the deck's
 * `DeckMeta` (for the public index card grid + admin list) without
 * pulling in any of the deck's slides / components / assets. Slides are
 * loaded lazily via `loadDeckBySlug(slug)` only when someone actually
 * visits `/decks/<slug>`.
 */
import type { DeckMeta } from "@/framework/viewer/types";

export const meta: DeckMeta = {
  slug: "cf-zt-ai",
  title: "Cloudflare Zero Trust × AI",
  description:
    "An animated, interactive walk-through of Cloudflare's Zero Trust story for AI — discover, govern, protect, observe, empower.",
  date: "2026-05-10",
  author: "Miguel Caetano Dias",
  tags: ["zero-trust", "ai"],
  runtimeMinutes: 18,
};
