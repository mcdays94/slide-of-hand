#!/usr/bin/env node
/**
 * build-thumbnails.mjs — snap real visual thumbnails for every public deck.
 *
 * For each public deck (folder under `src/decks/public/`) and each slide
 * (folder's `NN-*.tsx` files), boot a transient `vite dev` server, navigate
 * to `?slide=N&phase=0`, snap the viewport at 1920×1080, downscale to
 * 320×180, and write to `public/thumbnails/<slug>/<NN>.png`.
 *
 * The script is invoked via `npm run thumbnails`. It requires:
 *   - `playwright` (devDep) with chromium installed (`npx playwright install chromium`)
 *   - `sharp` (devDep) for resizing
 *
 * Output PNGs are gitignored — they are build artifacts, regenerated before
 * deploy. Production gracefully falls back to text tiles when absent.
 *
 * Design notes:
 *   - Sequential per-slide. ~5 slides × 1 deck < 10s; parallelism adds bugs.
 *   - Uses `vite dev` (not `vite preview`) so we don't require `dist/` to
 *     exist. The dev server is killed in a `finally` block to avoid zombies.
 *   - Wait strategy: `domcontentloaded` + 800ms timeout. NOT `networkidle`,
 *     because long-lived BroadcastChannels keep the network "active" forever.
 *     The 800ms gives Framer Motion entrance animations time to settle.
 *   - Slug enumeration walks the filesystem (no `import.meta.glob` available
 *     in node). Slide count = number of `NN-*.tsx` files (per AGENTS.md).
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

/** Walk `src/decks/public/*` and return [{ slug, slideCount }]. */
async function discoverDecks() {
  const decks = [];
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
    const files = await readdir(deckDir);
    const slideFiles = files.filter((f) => /^\d+-.+\.tsx$/.test(f)).sort();
    const slideCount = slideFiles.length > 0 ? slideFiles.length : 1;
    if (slideFiles.length === 0) {
      console.warn(
        `  ⚠ deck "${slug}" has no NN-*.tsx files; will snap slide 0 only`,
      );
    }
    decks.push({ slug, slideCount });
  }
  return decks;
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
  const decks = await discoverDecks();
  if (decks.length === 0) {
    console.warn("No public decks found; nothing to do.");
    return;
  }
  console.log(`  decks: ${decks.map((d) => d.slug).join(", ")}`);

  let server;
  let browser;
  try {
    console.log(`  starting vite dev on ${HOST}:${PORT}…`);
    server = await spawnDevServer();
    console.log("  vite ready");

    browser = await chromium.launch();

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
