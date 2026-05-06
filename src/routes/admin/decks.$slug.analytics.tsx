/**
 * Admin analytics dashboard — `/admin/decks/<slug>/analytics`.
 *
 * Reads aggregated analytics from `GET /api/admin/analytics/<slug>` and
 * renders a KPI strip, a per-day views line chart (Recharts), and a
 * per-slide stats table. The page is lazy-loaded from `App.tsx` so the
 * Recharts bundle (~50 KB gzipped) lands in its own chunk and never
 * leaks into the public deck viewer's bundle.
 *
 * Cloudflare Access gates `/admin/*` at the edge so this route assumes
 * an authenticated request — no JWT validation here.
 *
 * 404 fallback for unknown slugs mirrors the admin deck viewer's UX.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ANALYTICS_RANGES,
  isAnalyticsRange,
  type AnalyticsRange,
  type AnalyticsResponse,
  type PerSlideStats,
} from "@/lib/analytics-types";
import { getDeckBySlug } from "@/lib/decks-registry";

interface FetchState {
  status: "idle" | "loading" | "ok" | "error";
  data: AnalyticsResponse | null;
  error: string | null;
}

const INITIAL: FetchState = {
  status: "loading",
  data: null,
  error: null,
};

type SortKey = keyof Pick<
  PerSlideStats,
  | "slideId"
  | "views"
  | "medianDurationMs"
  | "p75DurationMs"
  | "p95DurationMs"
  | "phaseAdvances"
  | "jumpsTo"
>;

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB");
}

export default function AdminDeckAnalyticsRoute() {
  const { slug } = useParams<{ slug: string }>();
  const deck = slug ? getDeckBySlug(slug) : undefined;

  const [range, setRange] = useState<AnalyticsRange>("7d");
  const [state, setState] = useState<FetchState>(INITIAL);
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading", error: null }));
    const url = `/api/admin/analytics/${encodeURIComponent(slug)}?range=${range}`;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`request failed (${res.status})`);
        }
        return (await res.json()) as AnalyticsResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setState({ status: "ok", data, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          data: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, range]);

  const sortedSlides = useMemo(() => {
    const slides = state.data?.perSlide ?? [];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...slides].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [state.data, sortKey, sortDir]);

  if (!deck) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="cf-tag">404</p>
        <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
          No deck called &ldquo;{slug}&rdquo;.
        </h1>
        <Link to="/admin" className="cf-btn-ghost">
          Back to admin
        </Link>
      </main>
    );
  }

  const totalViews = state.data?.totalViews ?? 0;
  const slideCount = state.data?.perSlide.length ?? 0;
  const totalSlideAdvances = (state.data?.perSlide ?? []).reduce(
    (sum, s) => sum + (s.medianDurationMs > 0 ? s.views : 0),
    0,
  );
  const avgSlidesPerSession =
    totalViews > 0 ? totalSlideAdvances / totalViews : 0;

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-12"
      data-testid="analytics-page"
    >
      <div className="flex flex-col gap-2">
        <p className="cf-tag">Analytics</p>
        <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
          {deck.meta.title}
        </h1>
        <p className="text-sm text-cf-text-muted">
          Aggregated, anonymous view data. No cookies, no IPs, no per-user
          tracking. Numbers may lag writes by 30–60 seconds (Analytics Engine
          eventual consistency).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="cf-tag">Range</span>
        <div
          role="group"
          aria-label="Range selector"
          className="flex gap-1"
        >
          {ANALYTICS_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              data-interactive
              data-testid={`range-${r}`}
              onClick={() => {
                if (isAnalyticsRange(r)) setRange(r);
              }}
              className={`rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] transition-colors ${
                range === r
                  ? "border-cf-orange bg-cf-orange/10 text-cf-orange"
                  : "border-cf-border bg-cf-bg-100/40 text-cf-text-muted hover:border-dashed hover:text-cf-text"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Link to={`/admin/decks/${slug}`} className="cf-btn-ghost no-underline">
            Open viewer
          </Link>
          <Link to="/admin" className="cf-btn-ghost no-underline">
            Back to admin
          </Link>
        </div>
      </div>

      {state.status === "loading" ? (
        <div
          className="rounded border border-dashed border-cf-border bg-cf-bg-100 px-6 py-12 text-center text-sm text-cf-text-muted"
          data-testid="analytics-loading"
        >
          Loading analytics…
        </div>
      ) : state.status === "error" ? (
        <div
          className="rounded border border-cf-border bg-cf-bg-100 px-6 py-12 text-center text-sm text-cf-text-muted"
          data-testid="analytics-error"
        >
          <p className="font-medium text-cf-text">
            Couldn&rsquo;t load analytics.
          </p>
          <p className="mt-1">{state.error}</p>
        </div>
      ) : totalViews === 0 ? (
        <div
          className="rounded border border-dashed border-cf-border bg-cf-bg-100 px-6 py-12 text-center text-sm text-cf-text-muted"
          data-testid="analytics-empty"
        >
          <p className="font-medium text-cf-text">No views yet.</p>
          <p className="mt-1">
            Share <code className="font-mono">/decks/{slug}</code> with someone
            to start collecting data.
          </p>
        </div>
      ) : (
        <>
          <KpiStrip
            totalViews={totalViews}
            slideCount={slideCount}
            avgSlidesPerSession={avgSlidesPerSession}
          />
          <ChartSection perDay={state.data?.perDay ?? []} />
          <PerSlideTable
            slides={sortedSlides}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(key) => {
              if (key === sortKey) {
                setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              } else {
                setSortKey(key);
                setSortDir("desc");
              }
            }}
          />
        </>
      )}
    </main>
  );
}

interface KpiStripProps {
  totalViews: number;
  slideCount: number;
  avgSlidesPerSession: number;
}

function KpiStrip({
  totalViews,
  slideCount,
  avgSlidesPerSession,
}: KpiStripProps) {
  return (
    <section
      className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      data-testid="analytics-kpis"
    >
      <Kpi label="Total views" value={formatNumber(totalViews)} />
      <Kpi label="Slides with views" value={formatNumber(slideCount)} />
      <Kpi
        label="Slides per session"
        value={
          avgSlidesPerSession > 0
            ? avgSlidesPerSession.toFixed(1)
            : "—"
        }
      />
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-cf-border bg-cf-bg-100 px-5 py-4">
      <div className="cf-tag">{label}</div>
      <div className="mt-2 font-mono text-3xl tracking-[-0.025em] text-cf-text">
        {value}
      </div>
    </div>
  );
}

function ChartSection({
  perDay,
}: {
  perDay: AnalyticsResponse["perDay"];
}) {
  // Recharts colours via design-token CSS custom properties. We can't use
  // Tailwind utility classes inside Recharts (they accept stroke / fill
  // props, not className), so we inline the resolved value via
  // `getComputedStyle` only on the client. SSR / first paint falls back
  // to the canonical hex literal.
  const orange = "var(--color-cf-orange)";
  const muted = "var(--color-cf-text-subtle)";
  const border = "var(--color-cf-border)";

  return (
    <section
      className="rounded border border-cf-border bg-cf-bg-100 p-5"
      data-testid="analytics-chart"
    >
      <div className="mb-4 flex items-baseline justify-between">
        <span className="cf-tag">Views per day</span>
        <span className="text-xs text-cf-text-muted">UTC days</span>
      </div>
      <div style={{ width: "100%", height: 280 }}>
        {perDay.length === 0 ? (
          <p className="py-12 text-center text-sm text-cf-text-muted">
            No daily data yet.
          </p>
        ) : (
          <ResponsiveContainer>
            <LineChart
              data={perDay}
              margin={{ top: 10, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke={border} strokeDasharray="2 4" />
              <XAxis
                dataKey="date"
                stroke={muted}
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: border }}
              />
              <YAxis
                stroke={muted}
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: border }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-cf-bg-100)",
                  border: `1px solid ${border}`,
                  fontSize: 12,
                  color: "var(--color-cf-text)",
                }}
              />
              <Line
                type="monotone"
                dataKey="views"
                stroke={orange}
                strokeWidth={2}
                dot={{ r: 3, stroke: orange, fill: orange }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

interface PerSlideTableProps {
  slides: PerSlideStats[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}

function PerSlideTable({
  slides,
  sortKey,
  sortDir,
  onSort,
}: PerSlideTableProps) {
  const cols: { key: SortKey; label: string; align: "left" | "right" }[] = [
    { key: "slideId", label: "Slide", align: "left" },
    { key: "views", label: "Views", align: "right" },
    { key: "medianDurationMs", label: "Median", align: "right" },
    { key: "p75DurationMs", label: "p75", align: "right" },
    { key: "p95DurationMs", label: "p95", align: "right" },
    { key: "phaseAdvances", label: "Phases", align: "right" },
    { key: "jumpsTo", label: "Jumps", align: "right" },
  ];

  return (
    <section
      className="overflow-x-auto rounded border border-cf-border bg-cf-bg-100"
      data-testid="analytics-table"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-cf-border text-cf-text-muted">
            {cols.map((c) => {
              const active = c.key === sortKey;
              return (
                <th
                  key={c.key}
                  className={`px-4 py-3 font-mono text-[10px] uppercase tracking-[0.25em] ${
                    c.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    data-interactive
                    onClick={() => onSort(c.key)}
                    className={`transition-colors ${
                      active ? "text-cf-text" : "hover:text-cf-text"
                    }`}
                  >
                    {c.label}
                    {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {slides.length === 0 ? (
            <tr>
              <td
                colSpan={cols.length}
                className="px-4 py-6 text-center text-cf-text-muted"
              >
                No per-slide data.
              </td>
            </tr>
          ) : (
            slides.map((s) => (
              <tr
                key={s.slideId}
                className="border-b border-cf-border last:border-b-0"
              >
                <td className="px-4 py-3 font-mono text-cf-text">
                  {s.slideId}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cf-text">
                  {formatNumber(s.views)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cf-text-muted">
                  {formatMs(s.medianDurationMs)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cf-text-muted">
                  {formatMs(s.p75DurationMs)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cf-text-muted">
                  {formatMs(s.p95DurationMs)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cf-text-muted">
                  {formatNumber(s.phaseAdvances)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cf-text-muted">
                  {formatNumber(s.jumpsTo)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
