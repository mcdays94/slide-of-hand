/**
 * `useDeckAnalytics(slug)` — fire anonymous beacon events to
 * `POST /api/beacon` for view tracking, slide / phase advances, jumps
 * from the overview, and overview opens.
 *
 * Used by `<Deck>` for both public and admin viewers. The author's own
 * local development is silenced via the same dev-mode gate the IDE deep
 * link uses (`import.meta.env.DEV && __PROJECT_ROOT__.length > 0`),
 * so author testing on `http://localhost:5173` does not pollute
 * production analytics.
 *
 * ── Privacy ─────────────────────────────────────────────────────────────
 *
 * The session ID is generated via `crypto.randomUUID()` on first call
 * and held in `sessionStorage` so it survives reloads but resets per
 * tab / browser session. No cookies. No localStorage (which would
 * cross sessions and feel surveillance-y). The Worker treats the ID
 * as an opaque grouping key and never correlates it back to a person.
 *
 * ── Transport ───────────────────────────────────────────────────────────
 *
 * `fetch(..., { keepalive: true })` lets the request survive a
 * `pagehide` / `beforeunload` without us having to spawn a separate
 * `navigator.sendBeacon`. Errors are silently swallowed — beacon
 * failures must never break the deck.
 *
 * ── Schema ──────────────────────────────────────────────────────────────
 *
 *   trackSlideAdvance(fromSlideId | null, toSlideId, durationMs)
 *     - When `fromSlideId` is non-null:
 *         emits `slide_advance` (slideId = fromSlideId, double1 = durationMs)
 *         emits `view`          (slideId = toSlideId)
 *     - When `fromSlideId` is null (initial mount):
 *         emits `view`          (slideId = toSlideId)
 *
 *   trackPhaseAdvance(slideId, phaseIndex)
 *     - emits `phase_advance` (slideId, double2 = phaseIndex)
 *
 *   trackJump(toSlideId)
 *     - emits `jump` (slideId = toSlideId)
 *
 *   trackOverviewOpen()
 *     - emits `overview_open` (slideId = `__overview__`, sentinel)
 */

import { useCallback, useMemo, useRef } from "react";
import type { BeaconPayload, EventType } from "@/lib/analytics-types";

const SESSION_STORAGE_KEY = "slide-of-hand-session-id";

const OVERVIEW_SLIDE_SENTINEL = "overview";

export interface UseDeckAnalyticsResult {
  /**
   * Fire on every cursor.slide change. Pass `null` for `fromSlideId` on
   * the very first call (initial mount); pass the previous slide ID for
   * every subsequent change.
   */
  trackSlideAdvance: (
    fromSlideId: string | null,
    toSlideId: string,
    durationMs: number,
  ) => void;
  /** Fire a `phase_advance` event for an in-slide reveal. */
  trackPhaseAdvance: (slideId: string, phaseIndex: number) => void;
  /** Fire a `jump` event for an overview → slide N navigation. */
  trackJump: (toSlideId: string) => void;
  /** Fire an `overview_open` event when the audience presses `O`. */
  trackOverviewOpen: () => void;
}

/**
 * Generate or reuse a per-tab session ID. We deliberately use
 * `sessionStorage` (tab-scoped) rather than `localStorage` (origin-wide,
 * persistent) so analytics are scoped to a single browsing session.
 */
function readOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr-noop";
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && existing.length > 0) return existing;
    const next =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : fallbackId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    // sessionStorage may be denied (private mode quotas). Fall back to a
    // throwaway in-memory ID; the resulting events will not be grouped
    // across page loads, but they still aggregate at the Worker side.
    return fallbackId();
  }
}

function fallbackId(): string {
  // Two 32-bit Math.random samples concatenated as hex. Not a real UUID
  // but the Worker only checks shape (≤ 64 hex/dash chars).
  const part = (n: number) =>
    Math.floor(n * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
  return `${part(Math.random())}-${part(Math.random())}`;
}

/**
 * Returns true when this is a developer running `npm run dev` against
 * the source — we want author testing to be invisible to the production
 * analytics dataset. Mirrors the IDE-deep-link gate from
 * `src/routes/admin/index.tsx`.
 *
 * The vitest runtime is also `DEV` with `__PROJECT_ROOT__` set, so we
 * additionally exclude `MODE === "test"` — otherwise none of the hook's
 * unit tests would observe a beacon firing.
 */
function isDevAuthorRuntime(): boolean {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.MODE === "test") return false;
  try {
    return (
      typeof __PROJECT_ROOT__ !== "undefined" && __PROJECT_ROOT__.length > 0
    );
  } catch {
    return false;
  }
}

function postBeacon(payload: BeaconPayload): void {
  if (typeof fetch === "undefined") return;
  try {
    void fetch("/api/beacon", {
      method: "POST",
      // `keepalive` makes the request survive a `pagehide` event so the
      // final `slide_advance` (audience navigates away mid-deck) still
      // gets a chance to land. Keepalive bodies are capped at 64 KiB —
      // we send <200 bytes so we're nowhere near.
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      /* silently swallow — beacon failure must never break the deck */
    });
  } catch {
    /* same — beacon errors are non-fatal */
  }
}

export function useDeckAnalytics(slug: string): UseDeckAnalyticsResult {
  // Stable session ID for the lifetime of this hook instance.
  const sessionIdRef = useRef<string>("");
  const skipRef = useRef<boolean>(false);

  if (sessionIdRef.current === "") {
    sessionIdRef.current = readOrCreateSessionId();
    skipRef.current = isDevAuthorRuntime();
  }

  const send = useCallback(
    (
      eventType: EventType,
      slideId: string,
      durationMs: number,
      phaseIndex: number,
    ) => {
      if (skipRef.current) return;
      const body: BeaconPayload = {
        slug,
        slideId,
        eventType,
        sessionId: sessionIdRef.current,
        durationMs,
        phaseIndex,
      };
      postBeacon(body);
    },
    [slug],
  );

  const trackSlideAdvance = useCallback(
    (
      fromSlideId: string | null,
      toSlideId: string,
      durationMs: number,
    ) => {
      if (fromSlideId) {
        // Time on the slide just left.
        send(
          "slide_advance",
          fromSlideId,
          Math.max(0, Math.round(durationMs)),
          0,
        );
      }
      // The slide just entered counts as a view.
      send("view", toSlideId, 0, 0);
    },
    [send],
  );

  const trackPhaseAdvance = useCallback(
    (slideId: string, phaseIndex: number) => {
      send("phase_advance", slideId, 0, Math.max(0, Math.round(phaseIndex)));
    },
    [send],
  );

  const trackJump = useCallback(
    (toSlideId: string) => {
      send("jump", toSlideId, 0, 0);
    },
    [send],
  );

  const trackOverviewOpen = useCallback(() => {
    send("overview_open", OVERVIEW_SLIDE_SENTINEL, 0, 0);
  }, [send]);

  return useMemo(
    () => ({
      trackSlideAdvance,
      trackPhaseAdvance,
      trackJump,
      trackOverviewOpen,
    }),
    [trackSlideAdvance, trackPhaseAdvance, trackJump, trackOverviewOpen],
  );
}
