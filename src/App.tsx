/**
 * App shell — React Router v6, path-based routing.
 *
 * Routes:
 *   - `/`                                → public root (curated index in slice #4)
 *   - `/decks/<slug>`                    → public deck viewer (no presenter affordances)
 *   - `/admin`                           → admin deck index (public + private)
 *   - `/admin/decks/<slug>`              → admin deck viewer (presenter mode active)
 *   - `/admin/decks/<slug>/analytics`    → admin per-deck analytics dashboard (lazy-loaded; Recharts in its own chunk)
 *   - 404                                → simple fallback
 *
 * `/admin/*` is gated by Cloudflare Access at the edge in slice #8 — the
 * Worker + this app remain auth-unaware.
 *
 * Analytics route is `React.lazy`-loaded so the ~50 KB Recharts bundle
 * never lands on the public bundle path; visitors of `/decks/<slug>` do
 * not pay any of that cost. The bundle splits at build time.
 */

import { Suspense, lazy } from "react";
import { Link, Route, Routes } from "react-router-dom";
import Root from "./routes/_root";
import DeckRoute from "./routes/deck.$slug";
import AdminLayout from "./routes/admin/_layout";
import AdminIndex from "./routes/admin/index";
import AdminDeckRoute from "./routes/admin/decks.$slug";

const AdminDeckAnalyticsRoute = lazy(
  () => import("./routes/admin/decks.$slug.analytics"),
);

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="cf-tag">404</p>
      <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
        Page not found.
      </h1>
      <Link to="/" className="cf-btn-ghost">
        Home
      </Link>
    </main>
  );
}

function AnalyticsFallback() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="cf-tag">Analytics</p>
      <p className="text-sm text-cf-text-muted">Loading analytics…</p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/decks/:slug" element={<DeckRoute />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminIndex />} />
        <Route
          path="decks/:slug/analytics"
          element={
            <Suspense fallback={<AnalyticsFallback />}>
              <AdminDeckAnalyticsRoute />
            </Suspense>
          }
        />
      </Route>
      {/* Deck viewer is intentionally NOT nested under <AdminLayout> — the
          viewer fills the full viewport (h-screen w-screen) and any chrome
          strip above it would break the 16:9 letterbox. The deck's own
          chrome (overview, help, presenter affordances) is sufficient. */}
      <Route path="/admin/decks/:slug" element={<AdminDeckRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
