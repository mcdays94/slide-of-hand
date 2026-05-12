/**
 * `/api/admin/skills/cloudflare-deck-template` — Wave 4 of issue #168.
 *
 * Composes a Markdown "skill" describing how to author a Slide of Hand
 * deck. Consumed by:
 *
 *   - The in-Studio AI agent (`worker/agent.ts`) — fetched per chat
 *     turn so the system prompt has up-to-date deck-authoring rules.
 *   - External agent harnesses (Opencode / Claude Code / Codex) — curl
 *     the endpoint with a Cloudflare Access service token, drop the
 *     resulting Markdown into their skill library.
 *
 * ## Design
 *
 * The Markdown body is composed from two inputs:
 *
 *   1. **Static prose** at `docs/skills/cloudflare-deck-template/SKILL.md`.
 *      Hand-edited authoritative content (design tokens, motion conventions,
 *      anti-patterns, the deck contract). Mostly stable across releases.
 *
 *   2. **A live deck list.** Every public deck in `src/decks/public/*`,
 *      summarised by slug + title + description + author + event + tags +
 *      runtime + a GitHub source link + a live deployed URL. Lets the
 *      agent know which decks already exist as reference without burning
 *      tokens on full slide source.
 *
 * Both inputs are baked at build time into `worker/decks-snapshot.generated.json`
 * by `scripts/build-deck-snapshot.mjs`. The Worker bundle is built by
 * wrangler/esbuild (not Vite), so we cannot use `import.meta.glob` from
 * the Worker context — hence the pre-built JSON.
 *
 * ## Auth
 *
 * Admin-gated via `requireAccessAuth`. The skill leaks the slugs +
 * titles of every public deck (which are already public elsewhere) plus
 * Cloudflare's authoring conventions (intentionally public). The auth
 * gate exists for two reasons:
 *
 *   1. Defence in depth — if we ever surface non-public information in
 *      a future composer revision, the gate is already there.
 *   2. Quota — limits abuse of the endpoint by drive-by traffic. The
 *      content is admin-tier; presenting it as such matches the rest
 *      of the `/api/admin/*` surface.
 *
 * ## Caching
 *
 * `Cache-Control: private, max-age=60`. Per-browser short TTL so
 * iterating an external agent doesn't refetch every request, but the
 * content stays fresh when a new deck lands.
 */

import { requireAccessAuth } from "./access-auth";
import snapshot from "./decks-snapshot.generated.json" with { type: "json" };

/**
 * Subset of `DeckMeta` a deck contributes to the snapshot. Mirrors the
 * shape `scripts/build-deck-snapshot.mjs` writes. Keep in sync.
 *
 * Intentionally NOT importing `DeckMeta` from `src/framework/viewer/types.ts`
 * — the JSON snapshot is the wire contract here; importing the framework
 * type would tie the Worker bundle to changes in the frontend type tree
 * for no win.
 */
export interface DeckSnapshotEntry {
  slug: string;
  title: string;
  description?: string;
  date: string;
  author?: string;
  event?: string;
  cover?: string;
  tags?: string[];
  runtimeMinutes?: number;
}

/**
 * The full snapshot shape — exactly what `scripts/build-deck-snapshot.mjs`
 * emits. Exported so external callers can compose with it.
 */
export interface DeckSnapshot {
  staticBody: string;
  decks: DeckSnapshotEntry[];
  generatedAt: string;
}

/**
 * Empty Env. The composer endpoint currently needs no bindings — the
 * snapshot is baked into the Worker bundle at build time. The shape is
 * still declared (as an empty interface, NOT `Record<string, never>`)
 * so `Env` in `worker/index.ts` can union it cleanly without
 * conflicting with the actual bindings on the rest of Env. Future
 * revisions that add bindings (e.g. R2 for cached source) can land
 * them here without churning the shape elsewhere.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SkillsEnv {}

// Route lives under `/api/admin/*` so the Cloudflare Access app's
// existing `self_hosted_domains` coverage gates it at the edge. The
// Worker's `requireAccessAuth` is belt-and-braces on top.
//
// History: an earlier version of this file used `/api/skills/...`
// which was OUTSIDE the Access app's coverage. The Worker still
// accepted client-id headers via `requireAccessAuth`, but those
// headers passed through Cloudflare unvalidated (Access only strips
// client-set `cf-access-*` headers on paths it gates). Result: a
// forged `CF-Access-Client-Id: anything` got 200. Fixed 2026-05-12
// by moving under /api/admin so Access enforces.
const ENDPOINT_PATH = "/api/admin/skills/cloudflare-deck-template";
const GITHUB_SOURCE_BASE =
  "https://github.com/mcdays94/slide-of-hand/tree/main/src/decks/public";
const PUBLIC_DECK_BASE = "https://slideofhand.lusostreams.com/decks";

/**
 * Compose the full Markdown body from a snapshot. Pure function — no
 * IO, no env access. Tests exercise this directly with synthetic
 * snapshots; the handler stitches it to the request/response surface.
 *
 * Output shape:
 *
 *   <staticBody>\n
 *   \n
 *   ### <Title 1> (`<slug-1>`)\n
 *   <description if any>\n
 *   - **Date:** <date>\n
 *   - **Author:** <author>\n
 *   - **Event:** <event>\n            (if present)
 *   - **Runtime:** <N> min\n          (if present)
 *   - **Tags:** <comma-separated>\n   (if present)
 *   - **Source:** [github link]\n
 *   - **Live:** [public URL]\n
 *   \n
 *   ...repeats per deck, sorted by snapshot order (date desc)...\n
 *   \n
 *   ---\n
 *   _Snapshot generated at <generatedAt>._\n
 *
 * When the deck list is empty, an honest "No decks have been published
 * yet." note ships in place of the list — keeps the agent from
 * hallucinating decks.
 */
export function composeSkillMarkdown(snap: DeckSnapshot): string {
  const lines: string[] = [];
  // Static body first — already ends with a trailing newline from
  // the generator (which preserves the SKILL.md's tail).
  lines.push(snap.staticBody);

  if (snap.decks.length === 0) {
    lines.push(
      "",
      "_No decks have been published yet. Author the first one under `src/decks/public/<slug>/`._",
    );
  } else {
    for (const deck of snap.decks) {
      lines.push("", `### ${deck.title} (\`${deck.slug}\`)`);
      if (deck.description) {
        lines.push("", deck.description);
      }
      lines.push("");
      lines.push(`- **Date:** ${deck.date}`);
      if (deck.author) lines.push(`- **Author:** ${deck.author}`);
      if (deck.event) lines.push(`- **Event:** ${deck.event}`);
      if (typeof deck.runtimeMinutes === "number") {
        lines.push(`- **Runtime:** ${deck.runtimeMinutes} min`);
      }
      if (deck.tags && deck.tags.length > 0) {
        lines.push(`- **Tags:** ${deck.tags.join(", ")}`);
      }
      lines.push(`- **Source:** ${GITHUB_SOURCE_BASE}/${deck.slug}`);
      lines.push(`- **Live:** ${PUBLIC_DECK_BASE}/${deck.slug}`);
    }
  }

  lines.push(
    "",
    "---",
    "",
    `_Snapshot generated at ${snap.generatedAt}._`,
    "",
  );

  return lines.join("\n");
}

/**
 * Fetch handler — returns `null` for paths outside this module so the
 * main fetch chain can fall through.
 *
 * Method gate: GET only. POST / DELETE / PUT / HEAD / etc. → 405.
 * Auth gate: `requireAccessAuth` — interactive email or service-token JWT.
 * Body: composed Markdown.
 * Headers: `Content-Type: text/markdown; charset=utf-8` +
 *          `Cache-Control: private, max-age=60`.
 */
export async function handleSkills(
  request: Request,
  _env: SkillsEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ENDPOINT_PATH) return null;

  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }

  const denied = requireAccessAuth(request);
  if (denied) return denied;

  const body = composeSkillMarkdown(snapshot as DeckSnapshot);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "private, max-age=60",
    },
  });
}
