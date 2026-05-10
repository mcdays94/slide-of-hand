#!/usr/bin/env node
/**
 * build-thumbnails.mjs — snap real visual thumbnails for every public deck.
 *
 * For each public deck (folder under `src/decks/public/`) and each slide
 * in its exported `Deck.slides` array, boot a transient `vite dev` server,
 * navigate to `?slide=N&phase=0`, snap the viewport at 1920×1080, downscale
 * to 320×180, and write to `public/thumbnails/<slug>/<NN>.png`.
 *
 * The script is invoked via `npm run thumbnails`. It requires:
 *   - `playwright` (devDep) with chromium installed (`npx playwright install chromium`)
 *   - `sharp` (devDep) for resizing
 *
 * Output PNGs are gitignored — they are build artifacts, regenerated before
 * deploy. Production gracefully falls back to text tiles when absent.
 *
 * Design notes:
 *   - Sequential per-slide. Parallelism adds bugs.
 *   - Uses `vite dev` (not `vite preview`) so we don't require `dist/` to
 *     exist. The dev server is killed in a `finally` block to avoid zombies.
 *   - Wait strategy: `domcontentloaded` + 800ms timeout. NOT `networkidle`,
 *     because long-lived BroadcastChannels keep the network "active" forever.
 *     The 800ms gives Framer Motion entrance animations time to settle.
 *   - Slug enumeration walks the filesystem; slide-count discovery happens
 *     inside the browser via Playwright's `page.evaluate(() => import(...))`.
 *     Vite serves TSX as ESM through its dev middleware, so a dynamic import
 *     from the page context returns the deck's default export — and we read
 *     `deck.slides.length` directly. This is robust against nested slide
 *     folders (e.g. `src/decks/public/<slug>/slides/NN-*.tsx`), composite
 *     section dividers from `sections.tsx`, and any future deck shapes —
 *     none of which a filesystem grep would catch (issue #107).
 */

import { spawn } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 5218;
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const PUBLIC_DECKS_DIR = join(ROOT, "src", "decks", "public");
const OUT_DIR = join(ROOT, "public", "thumbnails");
const SETTLE_MS = 800;
const VIEWPORT = { width: 1920, height: 1080 };
const THUMB_SIZE = { width: 320, height: 180 };

/**
 * Walk `src/decks/public/*` and return [{ slug }] for every folder that
 * contains an `index.tsx`. The slide count is filled in later, inside the
 * browser, by importing the deck module through the Vite dev server — see
 * `discoverSlideCount()`.
 */
async function discoverDeckSlugs() {
  const slugs = [];
  let entries;
  try {
    entries = await readdir(PUBLIC_DECKS_DIR, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read ${PUBLIC_DECKS_DIR}: ${err.message}`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const deckDir = join(PUBLIC_DECKS_DIR, slug);
    const indexPath = join(deckDir, "index.tsx");
    try {
      await stat(indexPath);
    } catch {
      continue; // No index.tsx — skip silently.
    }
    slugs.push({ slug });
  }
  return slugs;
}

/**
 * Discover the canonical slide count by dynamically importing the deck's
 * `index.tsx` module through the Vite dev server. Vite transforms TSX to
 * ESM on the fly, so a `page.evaluate(() => import(...))` from a blank
 * about:blank context returns the deck's default export.
 *
 * The import URL — `/src/decks/public/<slug>/index.tsx` — is the same path
 * Vite uses internally; the `@/...` alias is NOT available here because we
 * are addressing Vite's filesystem-rooted dev URL, not the resolved alias
 * from `vite.config.ts`. Using the raw path is robust and version-stable.
 *
 * On failure (deck module throws, missing default export, malformed Deck),
 * returns 1 and logs a warning so the run still produces *something* for
 * the affected slug — the existing fallback behaviour.
 */
async function discoverSlideCount(page, slug) {
  // Navigate to a real route on the dev server so dynamic imports resolve
  // against the same origin. about:blank doesn't allow same-origin imports
  // back to the dev server.
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  try {
    const count = await page.evaluate(async (s) => {
      const mod = await import(`/src/decks/public/${s}/index.tsx`);
      const deck = mod.default;
      if (!deck || !Array.isArray(deck.slides)) return -1;
      return deck.slides.length;
    }, slug);
    if (count <= 0) {
      console.warn(
        `  ⚠ deck "${slug}" did not export a valid Deck.slides array; will snap slide 0 only`,
      );
      return 1;
    }
    return count;
  } catch (err) {
    console.warn(
      `  ⚠ deck "${slug}" failed to import (${err.message}); will snap slide 0 only`,
    );
    return 1;
  }
}

/**
 * Spawn `vite` and resolve once it's ready (when stdout includes "ready in").
 * Returns the child process — caller must `kill()` it in a finally block.
 */
function spawnDevServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "vite",
        "--host",
        HOST,
        "--port",
        String(PORT),
        "--strictPort",
        "--clearScreen",
        "false",
      ],
      {
        cwd: ROOT,
        env: { ...process.env, PORTLESS: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let resolved = false;
    const onData = (chunk) => {
      const s = chunk.toString();
      if (!resolved && /ready in/i.test(s)) {
        resolved = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`vite exited before ready (code ${code})`));
      }
    });

    // Timeout safety net — 30s should be far more than enough.
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        reject(new Error("vite dev server did not become ready in 30s"));
      }
    }, 30_000);
  });
}

async function snapDeck(browser, deck) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const deckOutDir = join(OUT_DIR, deck.slug);
  await mkdir(deckOutDir, { recursive: true });

  for (let i = 0; i < deck.slideCount; i++) {
    const url = `${BASE_URL}/decks/${deck.slug}?slide=${i}&phase=0`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(SETTLE_MS);
    const buf = await page.screenshot({ type: "png", fullPage: false });
    const resized = await sharp(buf)
      .resize(THUMB_SIZE.width, THUMB_SIZE.height, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const fileName = `${String(i + 1).padStart(2, "0")}.png`;
    await writeFile(join(deckOutDir, fileName), resized);
  }

  await context.close();
  return deck.slideCount;
}

async function main() {
  console.log("→ building thumbnails…");
  const slugs = await discoverDeckSlugs();
  if (slugs.length === 0) {
    console.warn("No public decks found; nothing to do.");
    return;
  }
  console.log(`  decks: ${slugs.map((d) => d.slug).join(", ")}`);

  let server;
  let browser;
  try {
    console.log(`  starting vite dev on ${HOST}:${PORT}…`);
    server = await spawnDevServer();
    console.log("  vite ready");

    browser = await chromium.launch();

    // Single browser context for slide-count discovery. We reuse one page
    // and navigate it sequentially per deck — cheaper than opening a new
    // context per deck, and the counts are independent.
    const probeContext = await browser.newContext({ viewport: VIEWPORT });
    const probePage = await probeContext.newPage();
    const decks = [];
    for (const { slug } of slugs) {
      const slideCount = await discoverSlideCount(probePage, slug);
      decks.push({ slug, slideCount });
    }
    await probeContext.close();

    for (const deck of decks) {
      const n = await snapDeck(browser, deck);
      console.log(`  ${deck.slug}: snapped ${n} slide${n === 1 ? "" : "s"}`);
    }

    console.log("✓ thumbnails written to public/thumbnails/");
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    if (server) {
      try {
        server.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((err) => {
  console.error("✗ build-thumbnails failed:", err);
  process.exitCode = 1;
});
