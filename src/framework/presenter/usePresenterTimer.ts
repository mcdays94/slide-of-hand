/**
 * Presenter timer + pacing classification.
 *
 * Two concerns split into pure helpers (testable) and a thin React hook:
 *
 *   1. `formatElapsed(ms)` — `M:SS` for the elapsed-since-first-visit clock.
 *   2. `formatDelta(ms)` — `+30s` / `-2m` relative-to-expected delta.
 *   3. `classifyPacing(deltaMs)` — green / amber / red bucket per spec.
 *   4. `useElapsedTime(slug)` — sessionStorage-persisted start timestamp;
 *      ticks once per second.
 *   5. `usePacing(...)` — derives expected runtime + delta + classification
 *      for the current cursor.
 *
 * Spec (issue #5 acceptance criteria):
 *   - green within ±10 s
 *   - amber over (positive delta past +10 s)
 *   - red ≥ 2× expected (i.e. delta ≥ expected total)
 *
 * Negative deltas (running ahead) outside the ±10 s green band are also
 * classified as `amber`. The presenter can read sign separately.
 */
import { useEffect, useState } from "react";

/** Pacing color buckets. */
export type Pacing = "green" | "amber" | "red";

const STORAGE_PREFIX = "slide-of-hand-deck-elapsed:";

/** Format a positive duration in milliseconds as `M:SS`. */
export function formatElapsed(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Format a signed duration as a short relative delta: `+30s`, `-2m`, `+1m 5s`.
 *
 * Sub-minute → seconds. ≥ 60 s → minutes (and a stray seconds component if
 * it isn't a clean multiple of 60). Sign is always shown except for zero.
 */
export function formatDelta(ms: number): string {
  if (ms === 0) return "0s";
  const sign = ms < 0 ? "-" : "+";
  const abs = Math.abs(Math.floor(ms / 1000));
  if (abs < 60) return `${sign}${abs}s`;
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  if (seconds === 0) return `${sign}${minutes}m`;
  return `${sign}${minutes}m ${seconds}s`;
}

/**
 * Classify a pacing delta against an expected total runtime, in ms.
 *
 *   - `green` if `|delta| <= 10 s`
 *   - `red` if `delta >= expectedMs` (i.e. ≥ 2× over)
 *   - `amber` otherwise
 *
 * Negative `expectedMs` (or 0) collapses to a binary green/amber on the ±10s
 * band only — there's no meaningful "2× over" without a target.
 */
export function classifyPacing(deltaMs: number, expectedMs: number): Pacing {
  const absDelta = Math.abs(deltaMs);
  if (absDelta <= 10_000) return "green";
  if (expectedMs > 0 && deltaMs >= expectedMs) return "red";
  return "amber";
}

/**
 * Read or initialize the sessionStorage-persisted "first slide visit" time
 * for a deck. The key is namespaced by slug so multiple decks have
 * independent clocks even when toggled in the same tab.
 *
 * Exported for tests; production code uses `useElapsedTime`.
 */
export function readOrInitStart(
  slug: string,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  now: number,
): number {
  if (!storage) return now;
  const key = STORAGE_PREFIX + slug;
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    storage.setItem(key, String(now));
  } catch {
    /* storage may be denied (private mode, quota); fall back to in-memory */
  }
  return now;
}

/**
 * React hook: returns ms elapsed since the first visit to this deck (in this
 * tab), persisted via sessionStorage so a refresh keeps the clock running.
 * Updates once per second.
 */
export function useElapsedTime(deckSlug: string): number {
  const [now, setNow] = useState(() => Date.now());
  const [startedAt] = useState(() =>
    readOrInitStart(
      deckSlug,
      typeof window !== "undefined" ? window.sessionStorage : undefined,
      Date.now(),
    ),
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return Math.max(0, now - startedAt);
}

/**
 * Derive expected total runtime for a deck, in ms.
 *
 * Priority: sum of per-slide `runtimeSeconds` if every visible slide has one,
 * else fall back to `meta.runtimeMinutes * 60_000`, else 0 (no expectation).
 */
export function expectedRuntimeMs(
  perSlide: Array<number | undefined>,
  runtimeMinutes: number | undefined,
): number {
  const allHaveSecs = perSlide.length > 0 && perSlide.every((s) => typeof s === "number" && s > 0);
  if (allHaveSecs) {
    return perSlide.reduce<number>((acc, s) => acc + (s ?? 0) * 1000, 0);
  }
  if (typeof runtimeMinutes === "number" && runtimeMinutes > 0) {
    return runtimeMinutes * 60_000;
  }
  return 0;
}
