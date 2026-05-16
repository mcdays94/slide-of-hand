/**
 * AI deck generation helper (issue #168 Wave 1 / Worker A).
 *
 * Given a user prompt + a target deck slug (+ optional existing files
 * for iteration), call Workers AI through the AI Gateway, get back a
 * structured set of TSX file edits ready to write into the Artifacts
 * draft repo.
 *
 * Uses the AI SDK's `generateObject` so the model produces a JSON
 * payload validated against a Zod schema. That gives us:
 *
 *   - Guaranteed shape: `{ files: [...], commitMessage: string }`.
 *     No fragile fence-block parsing.
 *
 *   - Per-file validation: paths are constrained to live under the
 *     deck's folder (`src/decks/public/<slug>/`), so the model can't
 *     accidentally write a `package.json` or wander out of scope.
 *
 *   - A natural retry surface — generateObject's schema validation
 *     fails fast, so the orchestrator can decide whether to retry
 *     with a tighter prompt or surface the error to the user.
 *
 * The system prompt is a condensed version of the cloudflare-deck-template
 * skill (we don't fetch from `/api/admin/skills/cloudflare-deck-template`
 * — keeping the prompt local + small saves a same-Worker round trip
 * and keeps the prompt focused on JSX generation rather than the
 * full skill body).
 */

import { generateObject } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { buildAiGatewayHeaders } from "./ai-gateway";
import { z } from "zod";

/**
 * AI Gateway slug — same as the agent's main loop (`worker/agent.ts`
 * AI_GATEWAY_ID). Inlined here rather than imported from agent.ts to
 * avoid a circular dependency chain (agent.ts → agent-tools.ts →
 * sandbox-deck-creation.ts → ai-deck-gen.ts → agent.ts).
 *
 * If the gateway slug ever changes, update both this constant AND
 * `AI_GATEWAY_ID` in `worker/agent.ts`. There's a test in
 * `worker/agent.test.ts` that pins the canonical value.
 */
export const AI_GATEWAY_ID = "slide-of-hand-agent";

/**
 * Default model for deck creation. Kimi K2.6 (`@cf/moonshotai/kimi-k2.6`)
 * is the proven choice — the e2e Playwright run on 2026-05-14 took it
 * fork → clone → ai_gen → apply → commit → push to a real published
 * draft (slug `cloudflare-workers`, commit `ab1304939...`). Kimi's
 * thinking/reasoning step is what makes it work where smaller models
 * fail; the schema is non-trivial and the output needs to converge to
 * valid JSON in one pass.
 *
 * Other reasoning-class options tested or available:
 *   - `@cf/openai/gpt-oss-120b` — original default. Fails the parse
 *     when paired with `streamObject` (see `streamDeckFiles` below).
 *     May work via `generateObject` (untested as of this commit).
 *   - `@cf/google/gemma-4-26b-a4b-it` — hit the 5-min Workers AI
 *     timeout with `streamObject` (18,326 tokens output, never
 *     converged). `generateObject` may dodge that. Available via the
 *     Settings model picker as an override.
 *   - `@cf/zai-org/glm-4.7-flash` — untested. Available via wrangler
 *     catalog.
 *
 * Smaller non-reasoning models (Gemma 3 12B, etc.) DO NOT work — they
 * 408-timeout at 2 minutes with zero output tokens. The deck-files
 * schema requires real reasoning capability.
 *
 * Override via `options.modelId` if the user has selected a different
 * model in Settings. The friendly-key allow-list lives in
 * `src/lib/ai-models.ts` and `worker/agent.ts`'s
 * `AI_ASSISTANT_MODEL_IDS`.
 */
export const DEFAULT_DECK_GEN_MODEL_ID = "@cf/moonshotai/kimi-k2.6";

export interface AiDeckGenInput {
  /** Kebab-case slug for the deck. Used to scope file paths. */
  slug: string;
  /** The user's natural-language prompt describing the deck. */
  userPrompt: string;
  /**
   * Intended authoring visibility selected in the new-deck UI. Source
   * deck `DeckMeta` does NOT currently carry a `visibility` field;
   * fresh AI-generated source decks are protected by `draft: true`
   * until publish. The value is still accepted for forward-compat and
   * conversational context, but must not be emitted into `meta.ts`.
   */
  visibility?: "public" | "private";
  /**
   * Optional existing files in the working tree. Passed for
   * iteration ("modify slide 3 to ..."). Each file's content is
   * embedded in the system prompt so the model has the full current
   * state to reason against.
   */
  existingFiles?: Array<{ path: string; content: string }>;
  /**
   * Optional pinned elements (Wave 2). Each pin describes a source
   * location the user clicked in the inspector. The model is told
   * to scope its edits to the pinned ranges.
   */
  pinnedElements?: Array<{
    file: string;
    lineStart: number;
    lineEnd: number;
    htmlExcerpt: string;
  }>;
}

export interface AiDeckGenSuccess {
  ok: true;
  files: Array<{ path: string; content: string }>;
  commitMessage: string;
}

export interface AiDeckGenFailure {
  ok: false;
  /**
   * Phase the generation failed at:
   *   - `model_error`: AI Gateway / Workers AI returned an error.
   *   - `schema_violation`: response didn't match the expected shape.
   *   - `path_violation`: model produced file paths outside the deck folder.
   *   - `no_files`: model returned an empty files array (model refusal).
   */
  phase: "model_error" | "schema_violation" | "path_violation" | "no_files";
  error: string;
}

export type AiDeckGenResult = AiDeckGenSuccess | AiDeckGenFailure;

const fileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "File path relative to the repo root. MUST start with `src/decks/public/<slug>/`.",
    ),
  content: z
    .string()
    .min(1)
    .max(200_000)
    .describe("Full UTF-8 file content. Replaces the file wholesale."),
});

const deckGenSchema = z.object({
  files: z
    .array(fileSchema)
    .min(1)
    .max(50)
    .describe(
      "All files that make up the deck. Always include at least `meta.ts`, `index.tsx`, and one slide file.",
    ),
  commitMessage: z
    .string()
    .min(3)
    .max(72)
    .describe("One-line conventional-commit-style summary of this turn."),
});

type DeckGenObject = z.infer<typeof deckGenSchema>;

/**
 * Build the system prompt describing the deck contract. Compact —
 * the goal is to give the model enough scaffolding to produce valid
 * JSX without burning tokens on the full external skill body.
 */
function buildSystemPrompt(slug: string): string {
  return `You are an AI assistant generating a JSX deck for Slide of Hand,
a JSX-first deck platform on Cloudflare Workers + Static Assets.

YOU MUST output the COMPLETE set of TypeScript / TSX files that
make up the deck. Each file's \`content\` is the WHOLE file. No
diffs, no partial edits.

## Output rules

- All file paths MUST start with \`src/decks/public/${slug}/\`.
  Files anywhere else are REJECTED.
- Always include at minimum:
  1. \`src/decks/public/${slug}/meta.ts\` (exports a typed \`DeckMeta\`).
  2. \`src/decks/public/${slug}/index.tsx\` (default-exports a typed
     \`Deck\` composing the slides).
  3. \`src/decks/public/${slug}/01-<name>.tsx\` (at least one slide).
- Slide files use \`NN-<name>.tsx\` numbering for ordering (\`01-title.tsx\`,
  \`02-hook.tsx\`, \`03-...\`).
- Slide \`id\` values are kebab-case (\`title\`, \`hook\`, \`live-demo\`).
  No numeric prefix on the id.
- \`meta.slug\` MUST equal "${slug}" exactly.
- \`meta.date\` is ISO YYYY-MM-DD. Pick a near-future date.

## DeckMeta + SlideDef shape

\`\`\`ts
// meta.ts
import type { DeckMeta } from "@/framework/viewer/types";

export const meta: DeckMeta = {
  slug: "${slug}",                  // MUST match folder name
  title: "...",                     // public-facing title
  description: "...",               // one sentence
  date: "2026-06-01",               // ISO YYYY-MM-DD
  author: "...",                    // optional
  runtimeMinutes: 15,               // optional, drives pacing
  draft: true,                      // fresh AI-generated decks are drafts (#191)
};
\`\`\`

\`\`\`tsx
// 01-title.tsx
import type { SlideDef } from "@/framework/viewer/types";

export const titleSlide: SlideDef = {
  id: "title",                      // kebab-case, stable
  title: "...",                     // optional, shown in chrome
  layout: "cover",                  // "cover" | "section" | "default" | "full"
  sectionLabel: "INTRO",            // optional, mono uppercase kicker
  sectionNumber: "01",              // optional, "01" .. "NN"
  phases: 1,                        // optional. Reveals AFTER mount.
                                    // Total visible states = phases + 1.
  notes: <p>Speaker notes.</p>,     // optional, ReactNode (presenter window only)
  runtimeSeconds: 45,               // optional, drives presenter pacing
  render: ({ phase }) => (/* JSX, uses phase */),
};
\`\`\`

\`\`\`tsx
// index.tsx
import type { Deck } from "@/framework/viewer/types";
import { meta } from "./meta";
import { titleSlide } from "./01-title";
import { introSlide } from "./02-intro";

const deck: Deck = { meta, slides: [titleSlide, introSlide] };
export default deck;
\`\`\`

## Imports the framework provides

You import these directly. Don't reinvent or re-export them.

- Types: \`import type { Deck, DeckMeta, SlideDef } from "@/framework/viewer/types";\`
- Phase hook: \`import { usePhase } from "@/framework/viewer/PhaseContext";\`
- Reveal primitive: \`import { Reveal, RevealInline } from "@/framework/viewer/Reveal";\`
- Citation primitives: \`import { Cite, SourceFooter, type Source } from "@/framework/citation";\`
- Motion easings + presets: \`import { easeEntrance, easeStandard, easeButton, easeActive, staggerContainer, staggerItem } from "@/lib/motion";\`
- Framer Motion: \`import { motion } from "framer-motion";\`

## Design tokens (NEVER hex)

Use Tailwind utility classes from the design system. The tokens
below are the entire palette you need. Hex literals are FORBIDDEN
in slide JSX. So are \`bg-white\`, \`text-black\`, \`font-bold\`.

| Token | Use |
|---|---|
| \`bg-cf-bg-100\` | default slide surface (warm cream light, warm charcoal dark) |
| \`bg-cf-bg-200\` | card surfaces, subtle elevated tiles |
| \`bg-cf-bg-300\` | deeper elevation, hover bg |
| \`text-cf-text\` | default body + heading text (warm brown) |
| \`text-cf-text-muted\` | subtitles, descriptions, captions |
| \`text-cf-text-subtle\` | whisper-quiet text (mono kickers) |
| \`border-cf-border\` | default 1px border |
| \`text-cf-orange\` / \`bg-cf-orange\` | brand accent. Use SPARINGLY (1-3 per slide) |
| \`bg-cf-orange-light\` | orange surface tint (8%), for accent pills + banners |
| \`text-cf-green\` / \`text-cf-blue\` | secondary semantic accents (rare) |

For section accents use CSS vars: \`style={{ color: "var(--color-cf-compute)" }}\`
where the variable is one of: \`cf-orange\`, \`cf-compute\` (blue),
\`cf-storage\` (magenta), \`cf-ai\` (green), \`cf-media\` (purple),
\`cf-success\`, \`cf-warning\`, \`cf-error\`, \`cf-info\`.

## Typography discipline

- Display headings: \`font-medium\` (NEVER \`font-bold\`) plus tight
  negative tracking. Range: \`tracking-[-0.025em]\` (smaller H2/H3)
  to \`tracking-[-0.04em]\` (cover H1).
- Display leading: \`leading-[0.95]\` on hero, \`leading-[1.05]\` on H2.
- Sizes via the Tailwind scale: \`text-4xl\`, \`text-5xl\`, \`text-6xl\`,
  \`text-7xl\`, \`text-8xl\`. Cover H1: \`text-6xl sm:text-8xl md:text-[116px]\`.
- Mono kickers: \`font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle\`.
  Wider variant: \`tracking-[0.18em]\` on cards.
- Body text: \`text-base sm:text-[17px] leading-relaxed text-cf-text-muted\`.
- Animated numbers: ALWAYS add \`tabular-nums\` to prevent digit jitter.
- Two-tone headlines are the brand signature: split into two \`<span>\`s,
  one default, one in \`text-cf-orange\`. One or two pivot words max.

## Layouts

- \`cover\`: title / thanks slides. Large centred headline. No chrome.
- \`section\`: chapter dividers. Big number plus label plus title.
- \`default\`: standard content slides. Has header chrome.
- \`full\`: edge-to-edge (visualisations, mock browsers).

## Slide layout patterns

Container pattern for default slides:

\`\`\`tsx
<div className="mx-auto flex h-full w-full max-w-[1280px] flex-col gap-5">
  {/* header: kicker + H2 + body paragraph */}
  <div className="max-w-3xl">
    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
      Kicker
    </span>
    <h2 className="mt-3 text-4xl font-medium tracking-[-0.035em] leading-[1.05] text-cf-text">
      Headline with a <span className="text-cf-orange">pivot</span>.
    </h2>
    <p className="mt-3 text-lg leading-relaxed text-cf-text-muted">Lede.</p>
  </div>

  {/* vertically centred body band; prevents dead vertical space */}
  <div className="flex flex-1 items-center">
    {/* the stat row / diagram / card / etc. */}
  </div>
</div>
\`\`\`

NEVER use a manual \`<div className="flex-1" />\` spacer. Use
\`flex flex-1 items-center\` to vertically centre sparse content
between the header and the slide bottom. Use \`gap-*\` for spacing,
not \`mt-*\` / \`mb-*\` on siblings.

Cover slides: wrap content in \`<div className="flex h-full items-center">\`
so it centres dead-vertically.

Max widths: \`max-w-[1200px]\` (cover), \`max-w-[1280px]\` to
\`max-w-[1480px]\` (default content; pick by density).

## Phase reveals (layout-stable, inline)

Phases let the speaker reveal content beat by beat. The slide
declares \`phases: N\`; the body uses the \`phase\` prop from
\`render({ phase })\`.

Canonical pattern: inline \`motion.div\` with phase-gated opacity
and a small lift. Layout stays stable across phases:

\`\`\`tsx
import { motion } from "framer-motion";
import { easeEntrance } from "@/lib/motion";

<motion.div
  initial={false}
  animate={{
    opacity: phase >= 1 ? 1 : 0,
    y: phase >= 1 ? 0 : 8,
  }}
  transition={{
    duration: 0.55,
    ease: easeEntrance,
    delay: phase >= 1 ? 0.08 : 0,
  }}
>
  Content for phase 1.
</motion.div>
\`\`\`

Why inline gating (and NOT \`<Reveal at={N}>\`): \`<Reveal>\`
mount/unmounts its children, which shifts layout between phases.
Inline gating keeps the DOM stable; every phase has the same
nodes, just at opacity 0/1. Fall back to \`<Reveal>\` only when
the element is genuinely heavy (a 3D scene, a 500-row table) and
you reserve its space with a placeholder div.

The \`initial={false}\` skip is critical. Without it, every
motion.div re-animates on every slide change. The conditional
delay (\`delay: phase >= 1 ? 0.08 : 0\`) keeps forward beats
feeling deliberate and backward beats snappy.

For cascade reveals within a single phase, stagger delays in
0.08s steps (0.08, 0.16, 0.24). Above 3 elements per beat, split
into multiple phases instead.

## Motion (easings only from @/lib/motion)

NEVER inline a cubic-bezier array. Always import from \`@/lib/motion\`:

| Easing | Use |
|---|---|
| \`easeEntrance\` | Apple-style decel. Phase reveals, entrances. |
| \`easeStandard\` | General fades, hover transitions. |
| \`easeButton\` | Press / interactive responses, stagger items. |
| \`easeActive\` | Symmetric in-out for ongoing animations. |

Allowed inline strings (utility loops only):
- \`ease: "linear"\` (marquees, slow rotations)
- \`ease: "easeInOut"\` / \`ease: "easeOut"\` (tiny ambient pulses)

Anti-patterns:
- \`transition={{ type: "spring" }}\` (wrong physics feel)
- \`whileHover={{ scale: ... }}\` (wrong hover affordance; use dashed border)
- inline cubic-bezier arrays

Timing cheat sheet:
- Phase reveal: 0.55s, \`easeEntrance\`
- Stagger item: 0.35s, \`easeButton\`
- SVG path draw: 0.7s, \`easeEntrance\`
- Ambient rotation: 30-60s, \`linear\`, \`repeat: Infinity\`

## Diagram slot (mandatory for decks of 6+ slides)

A Slide of Hand deck without a phased animated diagram in the
middle feels flat. Every deck of 6+ slides MUST include at least
one diagram slide. Pick one of these patterns:

1. **3-node flow**: A → B → C. The most universal: request paths,
   pipelines, user → service → outcome. Has \`phases: 3-4\`. Phase
   0 = header only. Phase 1 = node A appears with halo. Phase 2 =
   arrow draws, node B appears, halo travels. Phase 3 = arrow
   draws, node C, halo. Optional phase 4 = pay-off banner.

2. **Hub-and-spoke**: one centre with N satellites. Fan-out
   patterns, API surfaces, provider lists, product families.
   \`phases: 1 + spoke_count\`. Hub reveals first, then spokes
   reveal one at a time with their connectors drawing in.

3. **Pipeline**: sequential stages on a horizontal timeline with
   a playhead that crosses each stage as phases advance.

The diagram MUST grow phase-by-phase, not appear all at once. Use
SVG \`<motion.path initial={{ pathLength: 0 }} animate={{ pathLength: visible ? 1 : 0 }}>\`
for arrows. Use SMIL \`<animateMotion mpath={...} />\` for
travelling dots that loop along each path once it's drawn. Use a
3-ring pulsing halo on the currently-active node (three
\`motion.span\` rings at delays 0, 0.8, 1.6s, each scaling
1 → 1.22, opacity 0.55 → 0).

Place the diagram in the MIDDLE of the deck, not the start or end.

## Slide archetypes (pick the right shape)

Starting patterns. Invent novel compositions when the topic calls
for it; these just save time when one of them fits.

- **A. Hero question**: phased Socratic opener. Lead question
  plus tail plus optional big number beat. 2-3 phases.
- **B. Stat triptych**: 3 stats side by side in a grid. One card
  per phase. Use for "75% / 81% / 1.2k" framings.
- **C. Giant number**: one huge number plus one-line setup.
  \`tabular-nums\`, animated count-up.
- **D. Two-column compare**: before/after, naive/correct, A/B.
  Grey card on left, orange-bordered card on right.
- **E. Three-node flow**: the canonical diagram (see above).
- **F. Pull quote**: italic blockquote with orange left border,
  attributed below. Keep quote ≤ 30 words.
- **G. Bullet checklist**: 4-7 short items, each with an icon
  disc, label, optional sub-line. One bullet revealed per phase.
- **H. Code block**: dark code surface (\`bg-[#1c1b19]\`) with
  Prism syntax highlighting. Kicker above (e.g. "Worker · index.ts").
- **I. Default headline**: just a sentence. Use when one big
  claim is the whole slide.
- **J. Hub-and-spoke**: the other diagram (see above).
- **Title cover**: kicker plus name plus speaker block plus
  optional decorative element. \`layout: "cover"\`, 0 phases.
- **Section divider**: big number ("01") plus label plus title.
  \`layout: "section"\`, 0 phases.
- **Recap**: one sentence the audience walks out repeating.
  2-3 pivot phrases in orange. \`layout: "cover"\`, 0 phases.
- **Thanks**: H1 "Thanks." (orange period) plus subtitle plus
  speaker block plus optional QR. Mirrors the title slide.

## Content rhythm (pacing)

Aim for roughly 1.0 to 1.3 slides per minute of runtime:

| Runtime | Total slides | Sections |
|---|---|---|
| 5 min | 6-7 | 0 (skip dividers) |
| 10 min | 10-13 | 2-3 |
| 15 min | 15-19 | 3-5 |
| 20 min | 18-24 | 5-6 |
| 30 min | 26-36 | 6 max |

Distribute 2-3 content slides per section. Title plus recap plus
thanks all count toward the total.

## No em-dashes in audience-visible content

The em-dash (\`—\`, U+2014) reads as an AI tell in slide prose.
Forbidden in: any JSX text node inside a slide render function,
\`meta.title\`, slide titles, kicker labels, citation labels, body
paragraphs, captions. Replace with periods, commas, colons,
parentheses, or restructure:

- "X — Y." → "X. Y." (period for setup + payoff)
- "X — A, B, C." → "X: A, B, C." (colon for list intro)
- "X, which — by the way — does Y." → restructure entirely

Em-dashes are FINE in code comments, JSDoc, and TypeScript
identifiers (author-facing only). The rule is specifically about
audience-visible text. Hyphens (\`-\`) in compound words like
\`edge-native\` are not em-dashes and are fine.

## Citations for factual claims

When a slide states a factual claim (statistic, dated quote,
external research finding, named-vendor benchmark), attribute it.

- Inline marker next to the claim: \`<Cite n={1} />\` (optionally
  \`<Cite n={1} href="https://…" />\`).
- Matching footer at the bottom of the slide:
  \`<SourceFooter sources={SOURCES} />\`.
- Define sources inside the same slide file:
  \`const SOURCES: Source[] = [{ n: 1, label: "Acme · State of X 2025", href: "https://…" }];\`
  Numbers in \`SOURCES\` must line up with the \`n\` values used by
  \`<Cite>\` markers above.
- A \`Source\` may omit \`href\` when no public URL exists (book,
  internal RFC, conference talk). The footer renders it as text.

Do NOT fabricate sources. If your prompt did not provide a citation
and you are not certain of a real public source, either drop the
specific claim (keep the slide qualitative) or omit \`<Cite>\`
entirely. Only cite well-known public docs (e.g. Cloudflare's own
developer docs, an upstream RFC) when the claim genuinely maps to a
canonical page. Hallucinated URLs are worse than no citation.

Slides without factual claims do not need a \`<SourceFooter>\`. Title,
cover, section, recap, and thanks slides almost never carry one.

## Uploaded binary assets (speaker photos, logos, screenshots)

The user may upload images for THIS draft via the asset shelf on
the new-deck creator. Uploaded files land in Cloudflare R2 and are
served from stable, immutable URLs of the form:

\`\`\`
/images/decks/${slug}/<contentHash>.<ext>
\`\`\`

If the user's prompt references one of those URLs (pasted from the
shelf's Copy URL button), USE IT DIRECTLY in your JSX:

\`\`\`tsx
<img
  src="/images/decks/${slug}/abc123.png"
  alt="<concise alt the user described, or empty if decorative>"
  className="rounded-lg"
/>
\`\`\`

The user may also embed PROFILE ASSETS — recurring images uploaded
once to their profile library (speaker photo, logos, brand marks).
Those URLs have the shape:

\`\`\`
/images/profile/<ownerHash>/<contentHash>.<ext>
\`\`\`

Treat them the same way as deck assets: if the prompt references
one of these URLs, embed it directly. They are stable + immutable.
The ownerHash is opaque (a hash of the author's identity); never
try to derive it or guess at one.

Do NOT invent asset URLs. If the user wants an image you do not
have a URL for, either (a) leave a clearly-labelled placeholder
that asks the user to upload + paste a URL, or (b) skip the image
entirely. Never guess at a path like \`/images/decks/${slug}/photo.png\`
or \`/images/profile/<anything>/<anything>.png\` that the user has
not explicitly given you — those will 404 at runtime.

You MUST NOT emit binary file content. The output schema only
carries text files (\`{ path, content }\`). For any image needed in
a slide, the source of truth is either a user-uploaded URL (above)
or no image. Base64-inlined images are forbidden.

## Click-to-advance discipline

The deck advances on left-click of the slide surface. Two opt-outs:

- \`data-no-advance\` on a passive container suppresses click-advance
  for everything inside. Use on every \`<a>\`, \`<button>\`, source row,
  cite marker, or any non-native interactive widget.
- \`data-interactive\` on an active control also suppresses keyboard
  nav while focused. Use on text inputs, selects, toggles.

Native \`<a>\`, \`<button>\`, \`<input>\`, \`<select>\`, \`<textarea>\`,
\`<label>\` get this for free. Explicit \`data-no-advance\` is good
hygiene for non-native interactive divs.

## Brand voice

Pragmatic, technical, dry. Audience is engineers. Avoid hype,
avoid corporate-speak. Prefer specifics over abstractions.
Speaker notes can be more conversational than slide text.

Five non-negotiables:
1. Warm-cream not pure white (\`bg-cf-bg-100\`, never \`bg-white\`).
2. Warm-brown not pure black (\`text-cf-text\`, never \`text-black\`).
3. Medium weight, never bold (\`font-medium\` on display).
4. Tight negative tracking on display (\`tracking-[-0.025em]\` to \`tracking-[-0.04em]\`).
5. Dashed-border hover (no scale, no glow, no lift).

## Output schema

Return a single JSON object:

\`\`\`json
{
  "files": [
    { "path": "src/decks/public/${slug}/meta.ts", "content": "..." },
    { "path": "src/decks/public/${slug}/index.tsx", "content": "..." },
    { "path": "src/decks/public/${slug}/01-title.tsx", "content": "..." }
  ],
  "commitMessage": "Initial deck about <topic>"
}
\`\`\`

Each \`content\` is the COMPLETE file (replaces wholesale). No
partial edits or diffs.`;
}

/**
 * Build the user message — combines the prompt + existing files
 * (iteration) + pinned elements (Wave 2).
 */
function buildUserMessage(input: AiDeckGenInput): string {
  const parts: string[] = [];

  parts.push(`User prompt: ${input.userPrompt}`);

  // Source-backed `DeckMeta` has no `visibility` field. The UI still
  // sends the user's selected visibility for conversational context
  // and future compatibility, but the generator MUST NOT emit it into
  // `meta.ts` or TypeScript's excess-property check will fail when the
  // draft is published into the source repo.
  const visibility = input.visibility ?? "private";
  parts.push(
    `\nThe UI visibility selector is currently **${visibility}**, but source ` +
      `deck \`DeckMeta\` does NOT have a \`visibility\` field. Do NOT add ` +
      `\`visibility\` to \`meta.ts\`; the fresh draft is protected by ` +
      `\`draft: true\` until publish.`,
  );

  // Creation-time instruction (issue #191): AI-generated decks are
  // born as drafts so they don't immediately appear on the public
  // homepage. `existingFiles` absence is the creation marker —
  // iteration receives `existingFiles` and must NOT inject the flag
  // (preserve whatever's on disk). The orchestrator's post-process
  // in `runCreateDeckDraft` enforces this regardless of the model's
  // output (`ensureDraftTrueInMetaContent`); the prompt-side line
  // is the belt to the post-process's braces.
  if (!input.existingFiles || input.existingFiles.length === 0) {
    parts.push(
      `\nThis is a fresh deck creation. Set \`draft: true\` on the ` +
        `generated \`meta.ts\`'s \`DeckMeta\` object so the deck is born ` +
        `as a draft (does not appear on the public homepage; visible in ` +
        `admin with a Draft pill).`,
    );
  }

  if (input.existingFiles && input.existingFiles.length > 0) {
    parts.push("\n## Current deck files\n");
    parts.push(
      "These are the existing files in the deck. Modify or replace as needed.",
    );
    parts.push(
      "If you keep a file unchanged, OMIT it from the output (only emit files that change).",
    );
    for (const file of input.existingFiles) {
      parts.push(`\n### \`${file.path}\`\n\n\`\`\`tsx\n${file.content}\n\`\`\``);
    }
  }

  if (input.pinnedElements && input.pinnedElements.length > 0) {
    parts.push("\n## Pinned elements\n");
    parts.push(
      "The user clicked these elements in the inspector. " +
        "Scope your edits to ONLY these source ranges unless the user's prompt explicitly broadens scope.",
    );
    for (const pin of input.pinnedElements) {
      parts.push(
        `\n- \`${pin.file}\` lines ${pin.lineStart}-${pin.lineEnd}\n` +
          `  Excerpt: \`${pin.htmlExcerpt}\``,
      );
    }
  }

  return parts.join("\n");
}

export interface StreamDeckFilesOptions {
  /** Override the model id (e.g. when the user picked a different one). */
  modelId?: string;
  /**
   * AI Gateway authentication token (Worker secret
   * `CF_AI_GATEWAY_TOKEN`). When set, threaded through the
   * `cf-aig-authorization: Bearer <token>` header on every Workers
   * AI call so the Authenticated Gateway accepts the request. When
   * unset (e.g. test fixtures) no auth header is sent — fine for
   * unauthenticated gateways and for tests that mock the model.
   *
   * Owned by the calling site (`worker/sandbox-deck-creation.ts`'s
   * `runCreateDeckDraft` / `runIterateOnDeckDraft`); pulled off
   * `env.CF_AI_GATEWAY_TOKEN` and passed through to here so this
   * leaf module stays env-free.
   */
  gatewayToken?: string;
  /**
   * Test seam: by default the helper builds its own Workers AI provider
   * via `createWorkersAI({ binding, gateway })`. Tests can pass a pre-
   * built model factory to bypass that wiring.
   */
  buildModel?: (aiBinding: Ai, modelId: string) => unknown;
}

/**
 * Streaming partial shape yielded by `streamDeckFiles` during model
 * generation. Sourced from the AI SDK's `partialObjectStream`, which
 * yields a deep-partial of the schema as the model writes successive
 * tokens, transformed into a public shape that's easier for the UI
 * to render:
 *
 *   - `files` is always an array of strictly-typed entries (no
 *     missing `path` / `content`). The last file is marked `"writing"`,
 *     earlier files are marked `"done"`. When the partial stream
 *     exhausts, callers know the final file is also done.
 *   - `currentFile` is the path of the file currently being written
 *     (== last entry in `files`). Surfaced as a separate field so
 *     the canvas doesn't need to peek into the array.
 *   - `commitMessage` is present once the model has emitted it
 *     (typically near the end of the response — the schema declares
 *     it after the files array).
 *
 * Issue #178 sub-piece (1).
 */
export interface DeckGenPartial {
  files: Array<{ path: string; content: string; state: "writing" | "done" }>;
  currentFile?: string;
  commitMessage?: string;
}

/**
 * Return shape of `streamDeckFiles`. Mirrors the Vercel AI SDK's own
 * `streamObject` API (`{ partialObjectStream, object }`) so callers
 * compose naturally — they can `for await` the partials AND `await`
 * the final result independently.
 *
 * The two halves carry different shapes by design:
 *
 *   - `partials` is verbose (full file contents per yield) and feeds
 *     the UI canvas.
 *   - `result` is the lean `DeckDraftResult`-style summary that
 *     callers feed to the model as a tool-result. See ADR 0002.
 */
export interface StreamDeckFilesResult {
  partials: AsyncIterable<DeckGenPartial>;
  result: Promise<AiDeckGenResult>;
}

/**
 * Run a deck-generation pass against Workers AI and surface its
 * progress through TWO channels:
 *
 *   - `partials` — async iterable of `DeckGenPartial` snapshots
 *     yielded as the model writes successive tokens (transformed
 *     from the AI SDK's `partialObjectStream`).
 *   - `result` — promise that resolves to a validated `AiDeckGenResult`
 *     once the model finishes (path-allowlist + no-files checks
 *     applied to the final `object`).
 *
 * Never throws — model failures, schema violations, and path
 * violations all come back via the `AiDeckGenFailure` branch of
 * `result` so callers can render a useful UI message instead of
 * handling exceptions.
 *
 * Mirrors the AI SDK's `streamObject`'s `{partialObjectStream, object}`
 * idiom. The two halves are designed to be consumed in parallel:
 *
 *   const { partials, result } = streamDeckFiles(env.AI, input, opts);
 *   for await (const partial of partials) { ... }
 *   const final = await result;
 *
 * Issue #178 sub-piece (1).
 */
export function streamDeckFiles(
  aiBinding: Ai,
  input: AiDeckGenInput,
  options: StreamDeckFilesOptions = {},
): StreamDeckFilesResult {
  const modelId = options.modelId ?? DEFAULT_DECK_GEN_MODEL_ID;
  const aiGatewayHeaders = buildAiGatewayHeaders(options.gatewayToken);
  const buildModel =
    options.buildModel ??
    ((binding: Ai, id: string) => {
      const workersai = createWorkersAI({
        binding,
        gateway: { id: AI_GATEWAY_ID },
      });
      return workersai(
        id as Parameters<ReturnType<typeof createWorkersAI>>[0],
        aiGatewayHeaders ? { extraHeaders: aiGatewayHeaders } : {},
      );
    });
  const model = buildModel(aiBinding, modelId);

  // Use `generateObject` (non-streaming) rather than `streamObject`.
  //
  // Empirically (the 2026-05-14 e2e marathon), `streamObject` against
  // workers-ai-provider failed across every model we tried:
  //   - `@cf/openai/gpt-oss-120b` — fast "could not parse the
  //     response" failures across 5+ retries.
  //   - `@cf/google/gemma-4-26b-a4b-it` — streamed for the full 5-min
  //     Workers AI timeout (18,326 output tokens) without ever
  //     converging to a parseable object.
  //   - `@cf/google/gemma-3-12b-it` — 408 timeout at 120s with 0
  //     output tokens. Not a reasoning model — skip.
  //
  // Switching to `generateObject` + Kimi K2.6 cleared the pipeline:
  // 142s ai_gen, 5,875 output tokens, valid JSON, deck pushed to
  // Artifacts with commit `ab1304939...`. Reasoning models think
  // internally before emitting; `streamObject`'s progressive parser
  // expects mid-stream JSON fragments which reasoning models don't
  // produce. `generateObject` waits for the full response and parses
  // once, which matches reasoning-model output behaviour.
  //
  // UX trade-off: no progressive file rendering — files all appear
  // at once when the model finishes. Acceptable for first-turn deck
  // creation; the canvas's `apply` / `commit` / `push` chips still
  // show progression.
  //
  // The function still exposes the `partials` async iterable for
  // contract compatibility with the orchestrator. It yields a single
  // "all done" partial at the end instead of progressively.
  const objectPromise = generateDeckObjectWithRetry({
    model,
    system: buildSystemPrompt(input.slug),
    prompt: buildUserMessage(input),
    slug: input.slug,
  });

  // `partials` yields exactly once — at the end, with all files
  // marked done. The orchestrator's `for await (const partial of
  // partials)` loop iterates once. No mid-stream snapshots reach
  // the canvas, so the legacy "writing" intermediate state is
  // skipped.
  const partials: AsyncIterable<DeckGenPartial> = (async function* () {
    try {
      const resolved = await objectPromise;
      if (!resolved.ok) return;
      const { object } = resolved;
      const rawFiles = Array.isArray(object?.files) ? object.files : [];
      const validFiles = rawFiles.filter(
        (f): f is { path: string; content: string } =>
          typeof f?.path === "string" &&
          f.path.length > 0 &&
          typeof f.content === "string",
      );
      const files = validFiles.map((f) => ({
        path: f.path,
        content: f.content,
        state: "done" as const,
      }));
      const partial: DeckGenPartial = { files };
      if (files.length > 0) {
        partial.currentFile = files[files.length - 1]?.path;
      }
      if (typeof object?.commitMessage === "string") {
        partial.commitMessage = object.commitMessage;
      }
      yield partial;
    } catch {
      // generateObject threw — yield nothing. The `result` Promise
      // below will surface the error to the orchestrator via the
      // AiDeckGenFailure branch.
    }
  })();

  // Final result mirrors the old streamObject path: validate the
  // resolved object against the path allowlist and the
  // no-files-failure rule. Failure shapes (model_error /
  // path_violation / no_files) match the `AiDeckGenFailure` union
  // so callers can branch identically.
  const result: Promise<AiDeckGenResult> = objectPromise.then((resolved) =>
    resolved.ok ? validateGeneratedObject(resolved.object, input.slug) : resolved.failure,
  );

  return { partials, result };
}

async function generateDeckObjectWithRetry(opts: {
  model: unknown;
  system: string;
  prompt: string;
  slug: string;
}): Promise<
  | { ok: true; object: DeckGenObject }
  | { ok: false; failure: AiDeckGenFailure }
> {
  let prompt = opts.prompt;
  let lastSemanticError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { object } = await generateObject({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: opts.model as any,
        schema: deckGenSchema,
        system: opts.system,
        prompt,
      });
      const validation = validateGeneratedObject(object, opts.slug);
      if (validation.ok) return { ok: true, object };
      if (validation.phase !== "schema_violation") {
        return { ok: false, failure: validation };
      }
      lastSemanticError = validation.error;
      prompt =
        opts.prompt +
        `\n\nYour previous output failed validation: ${lastSemanticError}\n` +
        "Try again. You MUST include meta.ts, index.tsx, and at least one numbered slide file. " +
        "Every content field must be complete TypeScript/TSX source code only, with no tool-wrapper artifacts.";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        failure: {
          ok: false,
          phase: "model_error",
          error: `Workers AI request failed: ${message}`,
        },
      };
    }
  }
  return {
    ok: false,
    failure: {
      ok: false,
      phase: "schema_violation",
      error: `Model output failed validation after retry: ${lastSemanticError}`,
    },
  };
}

/**
 * Shared post-resolve validation. Used by `streamDeckFiles` once the
 * AI SDK's `object` promise settles. Mirrors the validation block in
 * `generateDeckFiles` exactly — extracted so both code paths stay in
 * sync as the path allowlist rules evolve.
 */
function validateGeneratedObject(
  object: z.infer<typeof deckGenSchema>,
  slug: string,
): AiDeckGenResult {
  const allowedPrefix = `src/decks/public/${slug}/`;
  for (const file of object.files) {
    if (!file.path.startsWith(allowedPrefix)) {
      return {
        ok: false,
        phase: "path_violation",
        error: `File path "${file.path}" is outside the allowed deck folder ${allowedPrefix}. Refusing to write.`,
      };
    }
    if (file.path.includes("..")) {
      return {
        ok: false,
        phase: "path_violation",
        error: `File path "${file.path}" contains '..' segment. Refusing to write.`,
      };
    }
  }
  if (object.files.length === 0) {
    return {
      ok: false,
      phase: "no_files",
      error: "Model returned no files. Try a more specific prompt.",
    };
  }
  const semanticError = validateGeneratedDeckSemantics(object.files, slug);
  if (semanticError) {
    return {
      ok: false,
      phase: "schema_violation",
      error: semanticError,
    };
  }
  return {
    ok: true,
    files: object.files,
    commitMessage: object.commitMessage,
  };
}

function validateGeneratedDeckSemantics(
  files: Array<{ path: string; content: string }>,
  slug: string,
): string | null {
  const base = `src/decks/public/${slug}/`;
  const paths = new Set(files.map((f) => f.path));
  const required = [`${base}meta.ts`, `${base}index.tsx`];
  for (const path of required) {
    if (!paths.has(path)) return `Model output is missing required file ${path}.`;
  }
  if (!files.some((f) => /^src\/decks\/public\/[^/]+\/\d{2}-[a-z0-9-]+\.tsx$/.test(f.path))) {
    return "Model output must include at least one numbered slide file like 01-title.tsx.";
  }
  for (const file of files) {
    if (!/\.(ts|tsx)$/.test(file.path)) {
      return `Model output contains non-TypeScript file path ${file.path}.`;
    }
    if (/[<\/]parameter\b|<parameter\b|NOT_VALID/i.test(file.content) || /NOT_VALID/i.test(file.path)) {
      return `Model output for ${file.path} contains tool-wrapper artifacts instead of source code.`;
    }
  }
  const meta = files.find((f) => f.path === `${base}meta.ts`)?.content ?? "";
  if (!/export\s+const\s+meta\b/.test(meta)) {
    return "meta.ts must export `const meta`.";
  }
  if (/\bvisibility\s*:/.test(meta)) {
    return "meta.ts must not set `visibility`; source DeckMeta does not support that field.";
  }
  const index = files.find((f) => f.path === `${base}index.tsx`)?.content ?? "";
  if (!/export\s+default\s+deck\b|export\s+default\s+\{/.test(index)) {
    return "index.tsx must default-export the Deck object.";
  }
  return null;
}
