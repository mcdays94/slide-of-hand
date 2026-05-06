/**
 * Analytics contract — issue #19 / Bucket C3.
 *
 * Shared between the Worker (validating beacon bodies, querying the
 * Cloudflare SQL API) and the SPA (`useDeckAnalytics`, the admin
 * `/admin/decks/<slug>/analytics` route).
 *
 * v1 covers five event types: a slide `view` (fire-and-forget on entry),
 * `slide_advance` (carries the duration spent on the previous slide),
 * `phase_advance` (carries the phase index inside a multi-phase slide),
 * `jump` (overview → slide N), and `overview_open` (audience opened the
 * O overlay).
 *
 * All fields are intentionally de-identified: the only "user" key is a
 * per-tab session UUID held in `sessionStorage` so it resets per browser
 * session. No cookies, no IPs, no fingerprinting.
 */

/** Allowed event types. Extending requires a new value, not a reuse. */
export const EVENT_TYPES = [
  "view",
  "slide_advance",
  "phase_advance",
  "jump",
  "overview_open",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Body shape accepted by `POST /api/beacon`.
 *
 * `durationMs` and `phaseIndex` are optional; the Worker treats them as
 * 0 when missing. The Worker enforces non-negative integer constraints.
 */
export interface BeaconPayload {
  slug: string;
  slideId: string;
  eventType: EventType;
  sessionId: string;
  durationMs?: number;
  phaseIndex?: number;
}

/** ID-shape regex — kebab-case, lowercase, no leading/trailing hyphen. */
const ID_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Generic ID validator: kebab-case, length 1-200, no `..`. Used both for
 * `slug` and `slideId` (server-side cap; the actual deck/slide IDs are
 * much shorter but we leave headroom for future composite IDs).
 */
export function isValidId(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 200) return false;
  if (value.includes("..")) return false;
  return ID_REGEX.test(value);
}

/**
 * Session IDs are produced by `crypto.randomUUID()` (RFC 4122 v4) on the
 * client. We accept any string up to 64 chars containing only
 * alphanumeric ASCII characters and hyphens. Validation is loose
 * because the server only uses the value as an opaque grouping key —
 * collisions on a 122-bit UUID are negligible.
 */
const SESSION_ID_REGEX = /^[0-9a-zA-Z-]{1,64}$/;

export function isValidSessionId(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 64) return false;
  return SESSION_ID_REGEX.test(value);
}

export function isEventType(value: unknown): value is EventType {
  return (
    typeof value === "string" &&
    (EVENT_TYPES as readonly string[]).includes(value)
  );
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Validate the body of `POST /api/beacon` and return a normalized payload
 * (with default 0 for the optional numeric fields).
 *
 * We deliberately avoid coupling this to the Worker's request handling —
 * the Worker imports + invokes this with the parsed JSON. Same module is
 * unit-testable in pure-JS land (no `Request`, no `env`).
 */
export function validateBeaconBody(
  input: unknown,
): ValidationResult<Required<BeaconPayload>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be an object" };
  }
  const record = input as Record<string, unknown>;

  if (typeof record.slug !== "string" || !isValidId(record.slug)) {
    return { ok: false, error: "invalid slug" };
  }
  if (typeof record.slideId !== "string" || !isValidId(record.slideId)) {
    return { ok: false, error: "invalid slideId" };
  }
  if (!isEventType(record.eventType)) {
    return { ok: false, error: "invalid eventType" };
  }
  if (
    typeof record.sessionId !== "string" ||
    !isValidSessionId(record.sessionId)
  ) {
    return { ok: false, error: "invalid sessionId" };
  }

  const durationMs = normalizeNonNegativeInt(record.durationMs);
  if (durationMs === null) {
    return { ok: false, error: "durationMs must be a non-negative integer" };
  }
  const phaseIndex = normalizeNonNegativeInt(record.phaseIndex);
  if (phaseIndex === null) {
    return { ok: false, error: "phaseIndex must be a non-negative integer" };
  }

  return {
    ok: true,
    value: {
      slug: record.slug,
      slideId: record.slideId,
      eventType: record.eventType,
      sessionId: record.sessionId,
      durationMs,
      phaseIndex,
    },
  };
}

function normalizeNonNegativeInt(input: unknown): number | null {
  if (input === undefined || input === null) return 0;
  if (typeof input !== "number") return null;
  if (!Number.isFinite(input)) return null;
  if (!Number.isInteger(input)) return null;
  if (input < 0) return null;
  // Cap at ~24h to prevent abuse / mistaken huge timers.
  if (input > 86_400_000) return null;
  return input;
}

// ── Read API response shape ──────────────────────────────────────────────

export type AnalyticsRange = "24h" | "7d" | "30d";

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = [
  "24h",
  "7d",
  "30d",
] as const;

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return (
    typeof value === "string" &&
    (ANALYTICS_RANGES as readonly string[]).includes(value)
  );
}

export interface PerSlideStats {
  slideId: string;
  views: number;
  medianDurationMs: number;
  p75DurationMs: number;
  p95DurationMs: number;
  phaseAdvances: number;
  /** Count of `jump` events that landed on this slide. */
  jumpsTo: number;
}

export interface PerDayStats {
  /** ISO date `YYYY-MM-DD`, UTC bucket. */
  date: string;
  views: number;
}

export interface AnalyticsResponse {
  slug: string;
  range: AnalyticsRange;
  totalViews: number;
  perSlide: PerSlideStats[];
  perDay: PerDayStats[];
}
