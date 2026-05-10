/**
 * cf247-dtx-manchester deck — metadata only.
 *
 * Lifted out of `index.tsx` so the registry can eagerly load the deck's
 * `DeckMeta` (for the public index card grid + admin list) without
 * pulling in any of the deck's slides / components / Three.js bundle.
 * Slides are loaded lazily via `loadDeckBySlug(slug)` only when someone
 * actually visits `/decks/cf247-dtx-manchester`.
 *
 * Source repo: gitlab.cfdata.org/mdias/cf247-dtx-manchester
 */
import type { DeckMeta } from "@/framework/viewer/types";

export const meta: DeckMeta = {
  slug: "cf247-dtx-manchester",
  title: "Shifting Gears with Car Finance 247",
  description:
    "DTX Manchester 2026 fireside-chat opener — five animated slides setting up the conversation between Cloudflare and Car Finance 247, followed by a static event backdrop.",
  date: "2026-04-29",
  author: "Miguel Caetano Dias",
  event: "DTX Manchester 2026",
  tags: ["fireside", "customer-story"],
  runtimeMinutes: 5,
};
