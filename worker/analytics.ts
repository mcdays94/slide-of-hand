/**
 * Analytics API — issue #19 / Bucket C3.
 *
 * Two endpoints:
 *
 *   POST /api/beacon                 — public ingestion (writes to AE)
 *   GET  /api/admin/analytics/<slug> — Access-gated read via SQL API (defense-in-depth: Worker also checks)
 *
 * Cloudflare Access guards `/api/admin/*` at the edge (see the
 * `Slide of Hand Admin` Access app's `self_hosted_domains`). As of
 * 2026-05-06 the Worker ALSO validates the `cf-access-authenticated-
 * user-email` header on the admin read endpoint via
 * `requireAccessAuth()` — defense-in-depth so a misconfigured Access
 * app fails closed instead of open. See `worker/access-auth.ts` for
 * the rationale.
 *
 * The read endpoint reads `env.CF_API_TOKEN` (a Worker secret) to call
 * the Cloudflare SQL API on behalf of the Access-authenticated author.
 *
 * ── Storage shape (Cloudflare Analytics Engine) ────────────────────────
 *
 *   blobs[0]   = deckSlug
 *   blobs[1]   = slideId
 *   blobs[2]   = eventType (view | slide_advance | phase_advance | jump | overview_open)
 *   blobs[3]   = sessionId (anonymous per-tab UUID)
 *   doubles[0] = durationMs (time on previous slide; 0 if N/A)
 *   doubles[1] = phaseIndex (only meaningful for phase_advance events)
 *   indexes[0] = deckSlug (sampled index)
 *
 * Schema changes are ADDITIVE ONLY. Don't reuse a blob/double slot.
 * Adding new columns is fine; renaming or repurposing existing slots
 * silently corrupts historical aggregations.
 *
 * ── Privacy ────────────────────────────────────────────────────────────
 *
 * No cookies, no IP storage (Cloudflare auto-strips request IP from AE
 * unless explicitly written), no user identity. The session ID is a
 * per-tab UUID held in `sessionStorage` — it resets per browser session
 * and is used only as a grouping key for de-duplicating bursts of
 * events from a single viewer.
 *
 * Returns:
 *   - a `Response` for any path it owns (200 / 204 / 400 / 405 / 502)
 *   - `null` for paths it does not own (so the caller can fall through
 *     to other handlers / `env.ASSETS.fetch(request)`).
 */

import {
  ANALYTICS_RANGES,
  isAnalyticsRange,
  isValidId,
  validateBeaconBody,
  type AnalyticsRange,
  type AnalyticsResponse,
  type PerDayStats,
  type PerSlideStats,
} from "../src/lib/analytics-types";
import { requireAccessAuth } from "./access-auth";

// ── Cloudflare runtime types ──────────────────────────────────────────────
//
// We declare a minimal local interface for the Analytics Engine binding
// rather than depending on `@cloudflare/workers-types` here — the
// generated types upstream evolve, and the only method we touch is
// `writeDataPoint`. The shape is documented in
// https://developers.cloudflare.com/analytics/analytics-engine/get-started/

export interface AnalyticsDataPoint {
  blobs: string[];
  doubles: number[];
  indexes: string[];
}

export interface AnalyticsEngineBinding {
  writeDataPoint: (event: AnalyticsDataPoint) => void;
}

export interface AnalyticsEnv {
  ANALYTICS: AnalyticsEngineBinding;
  /** Cloudflare API token with Account Analytics → Read scope. */
  CF_API_TOKEN?: string;
  /** Account ID — read from `wrangler.jsonc` `account_id` at deploy. */
  CF_ACCOUNT_ID?: string;
}

const BEACON_PATH = "/api/beacon";
const READ_PATH = /^\/api\/admin\/analytics\/([^/]+)\/?$/;

const NO_STORE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

// Analytics dashboard responses must NOT be cached at any shared cache
// (CF edge, ISP proxy, etc.) — they contain aggregated data behind the
// Access gate, and a `public` cache directive would expose admin payloads
// at the edge for the cache lifetime even if Access were misconfigured.
// Defense-in-depth pairs with `requireAccessAuth()` in the read handler:
// even on the rare path where Access fails open, the response can't be
// cached and replayed to other clients.
//
// `private` says "browser MAY cache, shared caches MUST NOT." `no-store`
// would forbid even the browser cache; `max-age=60` gives the author's
// own browser a tiny cache window so a quick refresh doesn't hammer
// the SQL API. Acceptable trade-off for v1.
const READ_HEADERS = {
  "content-type": "application/json",
  "cache-control": "private, max-age=60",
};

const MAX_BODY_BYTES = 2048;

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: NO_STORE_HEADERS,
  });
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: { ...NO_STORE_HEADERS, allow: allowed.join(", ") },
  });
}

function serverError(message: string, status = 502): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: NO_STORE_HEADERS,
  });
}

// ── Beacon ingestion ─────────────────────────────────────────────────────

async function handleBeacon(
  request: Request,
  env: AnalyticsEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  // Body size cap. We read as text first so we can guard before JSON.parse.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return badRequest(`body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return badRequest("invalid JSON body");
  }

  const validation = validateBeaconBody(parsed);
  if (!validation.ok) {
    return badRequest(validation.error);
  }
  const e = validation.value;

  // writeDataPoint is fire-and-forget. AE accepts the event and flushes
  // asynchronously. There's no acknowledgement / row id.
  try {
    env.ANALYTICS.writeDataPoint({
      blobs: [e.slug, e.slideId, e.eventType, e.sessionId],
      doubles: [e.durationMs, e.phaseIndex],
      indexes: [e.slug],
    });
  } catch (err) {
    // AE write failures should not surface to the client — beacons are
    // best-effort. Log + swallow.
    console.warn("ANALYTICS.writeDataPoint failed:", err);
  }

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

// ── Read via Cloudflare SQL API ──────────────────────────────────────────

const RANGE_TO_INTERVAL: Record<AnalyticsRange, string> = {
  "24h": "INTERVAL '1' DAY",
  "7d": "INTERVAL '7' DAY",
  "30d": "INTERVAL '30' DAY",
};

const DATASET = "slide_of_hand_views";

interface SqlApiResponse<TRow = Record<string, unknown>> {
  meta?: unknown;
  data?: TRow[];
  rows?: number;
  rows_before_limit_at_least?: number;
}

async function querySql<TRow = Record<string, unknown>>(
  sql: string,
  env: AnalyticsEnv,
): Promise<TRow[]> {
  if (!env.CF_API_TOKEN) {
    throw new Error("CF_API_TOKEN is not configured");
  }
  if (!env.CF_ACCOUNT_ID) {
    throw new Error("CF_ACCOUNT_ID is not configured");
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      "content-type": "text/plain",
    },
    body: sql,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `SQL API ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as SqlApiResponse<TRow>;
  return json.data ?? [];
}

interface PerDayRow {
  date: string;
  views: string | number;
}

interface TotalRow {
  totalViews: string | number;
}

function asNumber(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

interface PerSlideViewRow {
  slideId: string;
  views: string | number;
}

interface PerSlideDurationRow {
  slideId: string;
  medianDurationMs: string | number;
  p75DurationMs: string | number;
  p95DurationMs: string | number;
}

interface PerSlideEventCountRow {
  slideId: string;
  count: string | number;
}

async function handleRead(
  slug: string,
  range: AnalyticsRange,
  env: AnalyticsEnv,
): Promise<Response> {
  const interval = RANGE_TO_INTERVAL[range];

  // Quote slug for SQL. The slug has already been validated against
  // `isValidId` (kebab-case alphanumeric + hyphens) so SQL injection is
  // not possible — but we still wrap in single quotes per the SQL API's
  // string-literal syntax. AE SQL is a *subset* of ClickHouse SQL: as of
  // 2026-05 the `*If` variant aggregates (countIf, quantileTDigestIf,
  // etc.) are NOT supported. We work around by issuing one query per
  // event-type filter instead and stitching the results client-side.
  const slugLit = `'${slug}'`;
  const baseWhere = `WHERE blob1 = ${slugLit} AND timestamp > NOW() - ${interval}`;

  // 1. Total views (across all slides).
  const totalSql = `
    SELECT count() AS totalViews
    FROM ${DATASET}
    ${baseWhere}
      AND blob3 = 'view'
    FORMAT JSON`;

  // 2. Daily view counts.
  const perDaySql = `
    SELECT
      formatDateTime(toDate(timestamp), '%Y-%m-%d') AS date,
      count() AS views
    FROM ${DATASET}
    ${baseWhere}
      AND blob3 = 'view'
    GROUP BY date
    ORDER BY date ASC
    FORMAT JSON`;

  // 3. Per-slide view counts.
  const perSlideViewsSql = `
    SELECT blob2 AS slideId, count() AS views
    FROM ${DATASET}
    ${baseWhere}
      AND blob3 = 'view'
    GROUP BY slideId
    ORDER BY views DESC
    FORMAT JSON`;

  // 4. Per-slide duration percentiles (only `slide_advance` events
  //    carry a meaningful `durationMs`). `quantileWeighted` is the
  //    AE-supported quantile aggregator; the second arg is the weight
  //    (we always pass 1 for unweighted samples).
  const perSlideDurationsSql = `
    SELECT
      blob2 AS slideId,
      quantileWeighted(0.5)(double1, 1) AS medianDurationMs,
      quantileWeighted(0.75)(double1, 1) AS p75DurationMs,
      quantileWeighted(0.95)(double1, 1) AS p95DurationMs
    FROM ${DATASET}
    ${baseWhere}
      AND blob3 = 'slide_advance'
    GROUP BY slideId
    FORMAT JSON`;

  // 5. Per-slide phase-advance counts.
  const perSlidePhasesSql = `
    SELECT blob2 AS slideId, count() AS count
    FROM ${DATASET}
    ${baseWhere}
      AND blob3 = 'phase_advance'
    GROUP BY slideId
    FORMAT JSON`;

  // 6. Per-slide jump-arrival counts.
  const perSlideJumpsSql = `
    SELECT blob2 AS slideId, count() AS count
    FROM ${DATASET}
    ${baseWhere}
      AND blob3 = 'jump'
    GROUP BY slideId
    FORMAT JSON`;

  let totalRows: TotalRow[];
  let perDayRows: PerDayRow[];
  let perSlideViewRows: PerSlideViewRow[];
  let perSlideDurationRows: PerSlideDurationRow[];
  let perSlidePhaseRows: PerSlideEventCountRow[];
  let perSlideJumpRows: PerSlideEventCountRow[];
  try {
    [
      totalRows,
      perDayRows,
      perSlideViewRows,
      perSlideDurationRows,
      perSlidePhaseRows,
      perSlideJumpRows,
    ] = await Promise.all([
      querySql<TotalRow>(totalSql, env),
      querySql<PerDayRow>(perDaySql, env),
      querySql<PerSlideViewRow>(perSlideViewsSql, env),
      querySql<PerSlideDurationRow>(perSlideDurationsSql, env),
      querySql<PerSlideEventCountRow>(perSlidePhasesSql, env),
      querySql<PerSlideEventCountRow>(perSlideJumpsSql, env),
    ]);
  } catch (err) {
    return serverError(
      `analytics query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const durationsBySlide = new Map<string, PerSlideDurationRow>();
  for (const r of perSlideDurationRows) {
    durationsBySlide.set(String(r.slideId), r);
  }
  const phasesBySlide = new Map<string, number>();
  for (const r of perSlidePhaseRows) {
    phasesBySlide.set(String(r.slideId), asNumber(r.count));
  }
  const jumpsBySlide = new Map<string, number>();
  for (const r of perSlideJumpRows) {
    jumpsBySlide.set(String(r.slideId), asNumber(r.count));
  }

  // Use the union of slide IDs across all per-slide queries — a slide
  // with phase advances but no view events still deserves a row.
  const slideIds = new Set<string>();
  for (const r of perSlideViewRows) slideIds.add(String(r.slideId));
  for (const id of durationsBySlide.keys()) slideIds.add(id);
  for (const id of phasesBySlide.keys()) slideIds.add(id);
  for (const id of jumpsBySlide.keys()) slideIds.add(id);

  const viewsBySlide = new Map<string, number>();
  for (const r of perSlideViewRows) {
    viewsBySlide.set(String(r.slideId), asNumber(r.views));
  }

  const perSlide: PerSlideStats[] = Array.from(slideIds).map((slideId) => {
    const dur = durationsBySlide.get(slideId);
    return {
      slideId,
      views: viewsBySlide.get(slideId) ?? 0,
      medianDurationMs: dur ? Math.round(asNumber(dur.medianDurationMs)) : 0,
      p75DurationMs: dur ? Math.round(asNumber(dur.p75DurationMs)) : 0,
      p95DurationMs: dur ? Math.round(asNumber(dur.p95DurationMs)) : 0,
      phaseAdvances: phasesBySlide.get(slideId) ?? 0,
      jumpsTo: jumpsBySlide.get(slideId) ?? 0,
    };
  });
  perSlide.sort((a, b) => b.views - a.views || a.slideId.localeCompare(b.slideId));

  const perDay: PerDayStats[] = perDayRows.map((r) => ({
    date: String(r.date),
    views: asNumber(r.views),
  }));

  const totalViews = totalRows[0] ? asNumber(totalRows[0].totalViews) : 0;

  const body: AnalyticsResponse = {
    slug,
    range,
    totalViews,
    perSlide,
    perDay,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: READ_HEADERS,
  });
}

// ── Router ───────────────────────────────────────────────────────────────

/**
 * Route a request against the analytics API surface. Returns a
 * `Response` for paths this handler owns, or `null` for everything else
 * (so the Worker entry can fall through to other handlers / the static
 * assets binding).
 */
export async function handleAnalytics(
  request: Request,
  env: AnalyticsEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === BEACON_PATH || path === BEACON_PATH + "/") {
    return handleBeacon(request, env);
  }

  const readMatch = path.match(READ_PATH);
  if (readMatch) {
    const denied = requireAccessAuth(request);
    if (denied) return denied;
    const slug = decodeURIComponent(readMatch[1]);
    if (!isValidId(slug)) return badRequest("invalid slug");
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed(["GET", "HEAD"]);
    }
    const rangeParam = url.searchParams.get("range") ?? "7d";
    const range: AnalyticsRange = isAnalyticsRange(rangeParam)
      ? rangeParam
      : "7d";
    return handleRead(slug, range, env);
  }

  return null;
}

export { ANALYTICS_RANGES };
