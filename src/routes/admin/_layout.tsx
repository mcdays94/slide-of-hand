/**
 * Admin shell layout — wraps every `/admin/*` page with a thin chrome strip
 * (kicker + link back to the public index). Nested routes render via
 * `<Outlet />`.
 *
 * Slice #7 deliberately keeps the layout minimal and uses only the shared
 * design tokens from `styles/index.css` (cf-bg-*, cf-text-*, cf-tag, cf-btn-*).
 * No new colours, no admin-specific theme.
 *
 * Authentication is NOT enforced here — Cloudflare Access (slice #8) gates
 * `/admin/*` at the edge before any of this code runs.
 */

import { Link, Outlet } from "react-router-dom";

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-cf-bg-100 text-cf-text">
      <header className="flex items-center justify-between border-b border-cf-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Link to="/admin" className="cf-tag no-underline">
            Slide of Hand · Admin
          </Link>
        </div>
        <Link to="/" className="cf-btn-ghost no-underline">
          Public site
        </Link>
      </header>
      <Outlet />
    </div>
  );
}
