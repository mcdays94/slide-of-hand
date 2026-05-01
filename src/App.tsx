/**
 * App shell — React Router v6, path-based routing.
 *
 * Wave 2 wires:
 *   - `/`              → root index placeholder (full curated index in slice #4)
 *   - `/decks/<slug>`  → deck viewer
 *   - 404              → simple fallback
 */

import { Link, Route, Routes } from "react-router-dom";
import Root from "./routes/_root";
import DeckRoute from "./routes/deck.$slug";

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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/decks/:slug" element={<DeckRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
