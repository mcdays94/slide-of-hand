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
import { useCallback, useEffect, useRef, useState } from "react";

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

export interface PausableElapsed {
  /** Current elapsed time in ms. Frozen while `paused === true`. */
  elapsedMs: number;
  /** Whether the clock is currently paused. */
  paused: boolean;
  /** Toggle pause / resume. */
  toggle: () => void;
  /** Force pause (idempotent). */
  pause: () => void;
  /** Force resume (idempotent). */
  resume: () => void;
}

/**
 * Pausable elapsed-time hook for the presenter window.
 *
 * Behaviour:
 *   - Starts unpaused. Reads the deck's persisted start time from
 *     sessionStorage (same key as `useElapsedTime`), so refresh keeps the
 *     clock running.
 *   - When `pause()` is called, freezes the displayed elapsed at the
 *     instant of the call.
 *   - When `resume()` is called, advances the persisted start timestamp
 *     forward by the paused duration so the displayed elapsed continues
 *     from where it left off (rather than jumping to wall-clock + start).
 *
 * The pause state itself is in-memory only — refreshing the presenter
 * window resumes the wall-clock-driven elapsed.
 */
export function usePausableElapsedTime(deckSlug: string): PausableElapsed {
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);

  // `startedAt` is mutable: pausing does not change it; resuming pushes it
  // forward by the paused-duration so the displayed elapsed picks up where
  // it left off.
  const startedAtRef = useRef<number>(0);
  const [, forceRender] = useState(0);
  if (startedAtRef.current === 0) {
    startedAtRef.current = readOrInitStart(
      deckSlug,
      typeof window !== "undefined" ? window.sessionStorage : undefined,
      Date.now(),
    );
  }
  const pausedAtRef = useRef<number | null>(null);
  const pausedElapsedRef = useRef<number>(0);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const pause = useCallback(() => {
    setPaused((p) => {
      if (p) return p;
      const at = Date.now();
      pausedAtRef.current = at;
      pausedElapsedRef.current = Math.max(0, at - startedAtRef.current);
      return true;
    });
  }, []);

  const resume = useCallback(() => {
    setPaused((p) => {
      if (!p) return p;
      const pausedAt = pausedAtRef.current ?? Date.now();
      const pausedDuration = Date.now() - pausedAt;
      startedAtRef.current = startedAtRef.current + pausedDuration;
      pausedAtRef.current = null;
      // Persist updated start so a refresh during this session resumes
      // from where we left off rather than re-eating the paused window.
      try {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            "slide-of-hand-deck-elapsed:" + deckSlug,
            String(startedAtRef.current),
          );
        }
      } catch {
        /* sessionStorage may be denied; the in-memory start is still correct */
      }
      // Bump now and force a re-render so the displayed elapsed updates
      // immediately, before the next interval tick.
      setNow(Date.now());
      forceRender((n) => n + 1);
      return false;
    });
  }, [deckSlug]);

  const toggle = useCallback(() => {
    if (pausedAtRef.current != null) resume();
    else pause();
  }, [pause, resume]);

  const elapsedMs = paused
    ? pausedElapsedRef.current
    : Math.max(0, now - startedAtRef.current);

  return { elapsedMs, paused, toggle, pause, resume };
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
