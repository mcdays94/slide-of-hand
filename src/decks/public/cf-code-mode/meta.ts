/**
 * cf-code-mode deck — metadata only.
 *
 * Lifted out of `index.tsx` so the registry can eagerly load the deck's
 * `DeckMeta` (for the public index card grid + admin list) without
 * pulling in any of the deck's slides / components / assets. Slides are
 * loaded lazily via `loadDeckBySlug(slug)` only when someone actually
 * visits `/decks/<slug>`.
 */
import type { DeckMeta } from "@/framework/viewer/types";

export const meta: DeckMeta = {
  slug: "cf-code-mode",
  title: "Cloudflare Code Mode & Dynamic Workers",
  description:
    "DTX Manchester 2026 booth deck. Interactive slides with live MCP-vs-Code-Mode comparison powered by Workers AI.",
  date: "2026-05-06",
  author: "Miguel Caetano Dias",
  event: "DTX Manchester 2026",
  tags: ["code-mode", "mcp", "ai"],
  runtimeMinutes: 20,
};
