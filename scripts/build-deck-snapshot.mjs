#!/usr/bin/env node
/**
 * Build the deck snapshot consumed by the skill composer endpoint
 * (`/api/skills/cloudflare-deck-template` — see worker/skill-composer.ts).
 *
 * Why this exists.
 *
 * The skill composer endpoint serves a Markdown skill body that combines:
 *   1. Static prose at `docs/skills/cloudflare-deck-template/SKILL.md`.
 *   2. A live list of every deck in `src/decks/public/*` so external
 *      authoring agents (Opencode / Claude Code / Codex) know which decks
 *      already exist as reference.
 *
 * The Worker bundle is built by wrangler/esbuild, not Vite, so we can't
 * use `import.meta.glob` from the Worker context to scan decks at request
 * time. Instead this script:
 *
 *   1. Reads `docs/skills/cloudflare-deck-template/SKILL.md`.
 *   2. Lists `src/decks/public/<slug>/meta.ts` files via fs.
 *   3. Eval-parses each `meta.ts` to extract its `DeckMeta` (after
 *      stripping the TypeScript import + type annotation).
 *   4. Writes `worker/decks-snapshot.generated.json` containing both
 *      pieces. The JSON is committed so fresh checkouts and CI work
 *      without re-running this script.
 *
 * Why eval is safe here. The script only reads our own source files
 * (`src/decks/public/<slug>/meta.ts`). They are trusted code under
 * version control. The eval is wrapped in a parenthesised expression
 * so it always returns a value, never executes a statement.
 *
 * Wire-up:
 *   - `npm run build-deck-snapshot` runs this script directly.
 *   - `npm run build` runs it as a prebuild step (so the deployed
 *     Worker always carries the latest deck list).
 *
 * Regeneration is idempotent — re-running with no source change
 * produces a byte-identical JSON (same key order, same trailing
 * newline). The only field that changes per run is `generatedAt`,
 * which is included so the endpoint can surface it for debugging.
 */
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DECKS_ROOT = path.join(ROOT, "src", "decks", "public");
const SKILL_MD = path.join(
  ROOT,
  "docs",
  "skills",
  "cloudflare-deck-template",
  "SKILL.md",
);
const OUT_PATH = path.join(ROOT, "worker", "decks-snapshot.generated.json");

/**
 * Parse a `meta.ts` file into a plain `DeckMeta` object.
 *
 * Strips the `import type ...;` line(s) and the `: DeckMeta` type
 * annotation, then wraps the remaining `export const meta = { ... };`
 * in a parenthesised eval. Errors include the file path so the failing
 * file is obvious.
 *
 * @param {string} filePath absolute path to the meta.ts file
 * @returns {Promise<object>} the meta object
 */
export async function parseMetaFile(filePath) {
  const raw = await readFile(filePath, "utf8");

  // Strip `import` lines (single-line form — meta.ts files always
  // single-import the DeckMeta type).
  const noImports = raw.replace(/^import[^\n]+;?$/gm, "");

  // Match the `export const meta(: DeckMeta)? = { ... };` declaration.
  // The object literal greedy-matches up to the closing `};` at the
  // file end (after which only whitespace remains).
  const exportMatch = noImports.match(
    /export\s+const\s+meta\s*(?::\s*\w+)?\s*=\s*(\{[\s\S]*?\})\s*;\s*$/,
  );
  if (!exportMatch) {
    throw new Error(
      `[build-deck-snapshot] Could not parse meta export in ${filePath}`,
    );
  }

  const objectLiteral = exportMatch[1];

  // Eval the object literal. Trusted input (our own source).
  try {
    // eslint-disable-next-line no-eval
    const meta = eval(`(${objectLiteral})`);
    if (
      !meta ||
      typeof meta !== "object" ||
      typeof meta.slug !== "string" ||
      typeof meta.title !== "string" ||
      typeof meta.date !== "string"
    ) {
      throw new Error(
        `[build-deck-snapshot] Meta in ${filePath} is missing required fields (slug, title, date).`,
      );
    }
    return meta;
  } catch (err) {
    throw new Error(
      `[build-deck-snapshot] Failed to eval meta in ${filePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Scan `src/decks/public/*` for `<slug>/meta.ts` and parse each.
 * Returns the decks sorted by date desc, then slug asc (matches
 * `decks-registry.ts` ordering so the snapshot feels consistent with
 * the public index).
 *
 * @returns {Promise<Array<object>>}
 */
export async function scanPublicDecks() {
  let entries;
  try {
    entries = await readdir(DECKS_ROOT, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }

  const decks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slugFolder = entry.name;
    const metaPath = path.join(DECKS_ROOT, slugFolder, "meta.ts");

    // Skip folders without a meta.ts (e.g. assets-only directories).
    try {
      await stat(metaPath);
    } catch {
      continue;
    }

    const meta = await parseMetaFile(metaPath);

    // Folder name + meta.slug must match. The deck registry asserts
    // this at runtime; we mirror the check here so the snapshot is a
    // canonical view of the same constraint.
    if (meta.slug !== slugFolder) {
      throw new Error(
        `[build-deck-snapshot] Slug mismatch in ${metaPath}: meta.slug="${meta.slug}" but folder is "${slugFolder}". They MUST match.`,
      );
    }

    decks.push(meta);
  }

  decks.sort((a, b) => {
    if (a.date === b.date) return a.slug.localeCompare(b.slug);
    return b.date.localeCompare(a.date);
  });

  return decks;
}

/**
 * Compose the snapshot — static skill body + deck list. The composer
 * lives in TypeScript (worker/skill-composer.ts) and reads this
 * snapshot at request time; this script just produces inputs.
 */
async function buildSnapshot() {
  const staticBody = await readFile(SKILL_MD, "utf8");
  const decks = await scanPublicDecks();
  return {
    staticBody,
    decks,
    generatedAt: new Date().toISOString(),
  };
}

async function main() {
  const snapshot = await buildSnapshot();

  // Sort keys deterministically so re-running with no change yields
  // (modulo `generatedAt`) byte-identical output and a clean git diff.
  const serialised = JSON.stringify(snapshot, null, 2) + "\n";
  await writeFile(OUT_PATH, serialised, "utf8");

  console.log(
    `[build-deck-snapshot] Wrote ${OUT_PATH} (${snapshot.decks.length} decks, ` +
      `staticBody=${snapshot.staticBody.length} chars)`,
  );
}

// Allow this module to be imported in tests (parseMetaFile,
// scanPublicDecks) without auto-running main().
const invokedDirectly = process.argv[1] === __filename;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
