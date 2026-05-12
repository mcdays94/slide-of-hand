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

import { streamObject } from "ai";
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
 * Default model for deck creation. GPT-OSS 120B is reasoning-tuned
 * and produces the most consistent structured output in our testing.
 * Override via `options.modelId` if the user has selected a
 * different model in Settings.
 *
 * Inlined for the same reason as `AI_GATEWAY_ID` above. Mirrors
 * `AI_ASSISTANT_MODEL_IDS["gpt-oss-120b"]` in `worker/agent.ts`.
 */
export const DEFAULT_DECK_GEN_MODEL_ID = "@cf/openai/gpt-oss-120b";

export interface AiDeckGenInput {
  /** Kebab-case slug for the deck. Used to scope file paths. */
  slug: string;
  /** The user's natural-language prompt describing the deck. */
  userPrompt: string;
  /**
   * Intended publish-time visibility of the deck. Embedded in the
   * user message so the generated `meta.ts` carries
   * `visibility: "public" | "private"` correctly. Issue #171
   * visibility toggle. Defaults to "private" when unset (matches
   * the new-deck creator UI default).
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

/**
 * Build the system prompt describing the deck contract. Compact —
 * the goal is to give the model enough scaffolding to produce valid
 * JSX without burning tokens on the full external skill body.
 */
function buildSystemPrompt(slug: string): string {
  return `You are an AI assistant generating a JSX deck for Slide of Hand,
a deck platform on Cloudflare Workers + Static Assets.

YOU MUST output the COMPLETE set of TypeScript / TSX files that make up the deck.

## Output rules

- All file paths MUST start with \`src/decks/public/${slug}/\`. Files anywhere else are REJECTED.
- Always include these three at minimum:
  1. \`src/decks/public/${slug}/meta.ts\` — exports a typed \`DeckMeta\`.
  2. \`src/decks/public/${slug}/index.tsx\` — default-exports a typed \`Deck\` composing the slides.
  3. \`src/decks/public/${slug}/01-<name>.tsx\` — at least one slide.
- Numbering slide files: \`01-...\`, \`02-...\`, etc. for ordering.
- Slide \`id\` values are kebab-case (e.g. "title", "intro", "cta"), NOT prefixed with a number.
- DeckMeta \`slug\` field MUST equal "${slug}" exactly.
- DeckMeta \`date\` field is ISO YYYY-MM-DD (use a near-future date).

## DeckMeta + SlideDef shape

\`\`\`ts
import type { DeckMeta } from "@/framework/viewer/types";

export const meta: DeckMeta = {
  slug: "${slug}",                  // MUST match folder name
  title: "...",                    // public-facing title
  description: "...",              // one-sentence
  date: "2026-06-01",              // ISO YYYY-MM-DD
  author: "...",                   // optional
  runtimeMinutes: 15,              // optional, talk runtime
};
\`\`\`

Slides:

\`\`\`tsx
import type { SlideDef } from "@/framework/viewer/types";
import { Reveal } from "@/framework/viewer/Reveal";

export const titleSlide: SlideDef = {
  id: "title",                     // kebab-case
  title: "...",                    // optional, shown in chrome
  layout: "cover",                 // "cover" | "section" | "default" | "full"
  phases: 1,                       // optional, number of reveals before advancing
  notes: <p>Speaker notes here.</p>,  // optional, ReactNode
  render: () => (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-7xl tracking-[-0.04em] text-cf-text">Title</h1>
      <Reveal at={1}>
        <p className="text-xl text-cf-text-muted">Subtitle</p>
      </Reveal>
    </div>
  ),
};
\`\`\`

index.tsx pattern:

\`\`\`tsx
import type { Deck } from "@/framework/viewer/types";
import { meta } from "./meta";
import { titleSlide } from "./01-title";
import { introSlide } from "./02-intro";

const deck: Deck = { meta, slides: [titleSlide, introSlide] };
export default deck;
\`\`\`

## Design tokens — ALWAYS use these, never hex

- \`text-cf-text\` (warm brown) for body / headings
- \`text-cf-text-muted\` (softer brown) for captions / secondary
- \`bg-cf-bg-100\` (warm cream) for backgrounds
- \`text-cf-orange\` for accents (sparingly)
- NEVER \`#FFFFFF\`, NEVER \`#000000\`, NEVER bold headings (use \`font-medium\` + tight tracking like \`tracking-[-0.04em]\`)

## Layouts

- \`cover\` — title / conclusion slides (large centered headline)
- \`section\` — mid-deck section dividers (uppercase kicker via \`sectionLabel\`)
- \`default\` — standard slides
- \`full\` — edge-to-edge (visualizations, code samples)

## Phase reveals

\`phases: N\` declares N additional reveals before the slide advances.
Inside the slide, use \`<Reveal at={N}>\` for mount/unmount reveals or
\`const phase = usePhase()\` + Framer Motion opacity for layout-stable reveals.

## Brand voice

Pragmatic, technical, dry. Audience is engineers. Avoid hype, avoid corporate-speak.
Prefer specifics over abstractions. Speaker notes can be more conversational.

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

Each \`content\` is the COMPLETE file (replaces wholesale). No partial edits or diffs.`;
}

/**
 * Build the user message — combines the prompt + existing files
 * (iteration) + pinned elements (Wave 2).
 */
function buildUserMessage(input: AiDeckGenInput): string {
  const parts: string[] = [];

  parts.push(`User prompt: ${input.userPrompt}`);

  // Tell the model the publish-time visibility so it sets
  // `visibility: "public"` or `visibility: "private"` on the
  // generated `meta.ts`'s `DeckMeta` object. Defaults to "private"
  // when unset — matches the new-deck creator UI's default and the
  // safer-floor principle (issue #171).
  const visibility = input.visibility ?? "private";
  parts.push(
    `\nThe deck's intended publish-time visibility is: **${visibility}**. ` +
      `Set \`visibility: "${visibility}"\` on the generated \`meta.ts\`'s ` +
      `\`DeckMeta\` object so the deck is born with this value baked in.`,
  );

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

  const stream = streamObject({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: model as any,
    schema: deckGenSchema,
    system: buildSystemPrompt(input.slug),
    prompt: buildUserMessage(input),
  });

  // Transform the deep-partial JSON yielded by `partialObjectStream`
  // into the public `DeckGenPartial` shape. The transform is forgiving
  // — a partial may have files with missing paths or content (mid-
  // parse); skip the ones without a path and default missing content
  // to an empty string. The LAST file with a valid path is the one
  // currently being written.
  const partials: AsyncIterable<DeckGenPartial> = (async function* () {
    for await (const raw of stream.partialObjectStream) {
      const rawFiles = Array.isArray(raw?.files) ? raw.files : [];
      const validFiles = rawFiles.filter(
        (f): f is { path: string; content?: string } =>
          typeof f?.path === "string" && f.path.length > 0,
      );
      const files = validFiles.map((f, i) => ({
        path: f.path,
        content: typeof f.content === "string" ? f.content : "",
        state: (i === validFiles.length - 1 ? "writing" : "done") as
          | "writing"
          | "done",
      }));
      const partial: DeckGenPartial = { files };
      if (files.length > 0) {
        partial.currentFile = files[files.length - 1]?.path;
      }
      if (typeof raw?.commitMessage === "string") {
        partial.commitMessage = raw.commitMessage;
      }
      yield partial;
    }
  })();

  // Final result mirrors `generateDeckFiles`: validate the resolved
  // object against the path allowlist and the no-files-failure rule.
  // Failure shapes (model_error / path_violation / no_files) match
  // the `AiDeckGenFailure` union so callers can branch identically.
  const result: Promise<AiDeckGenResult> = stream.object.then(
    (object) => validateGeneratedObject(object, input.slug),
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false as const,
        phase: "model_error" as const,
        error: `Workers AI request failed: ${message}`,
      };
    },
  );

  return { partials, result };
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
  return {
    ok: true,
    files: object.files,
    commitMessage: object.commitMessage,
  };
}
