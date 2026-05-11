/**
 * Client-side admin route guard.
 *
 * ## Why this exists
 *
 * Cloudflare Access gates `/admin/*` and `/api/admin/*` at the edge —
 * BUT only for full HTTP requests. The SPA does client-side React Router
 * navigation: clicking a link inside the app that changes the URL via
 * `history.pushState` does NOT make an HTTP request, and so Access
 * never sees it. An unauthenticated visitor could open the public
 * homepage at `/` (gets the SPA), then click "Studio" or paste
 * `/admin` into the address bar AFTER the app loaded, and React Router
 * would mount the admin layout entirely client-side. The admin chrome
 * (TopToolbar admin buttons, Settings rows for AI / GitHub / etc.)
 * would render without an Access session.
 *
 * Surfaced 2026-05-11: a user reported reaching `/admin/decks/<slug>`
 * via homepage → Studio link without being prompted to authenticate.
 *
 * ## How this works
 *
 * `useAccessAuth()` probes `/api/admin/auth-status` (Access-gated) on
 * mount. The result is one of:
 *
 *   - `"checking"`   — probe in flight; render a brief splash so we
 *                       don't flash admin chrome and then yank it.
 *   - `"unauthenticated"` — render a sign-in landing. The Reload
 *                       button triggers a full browser navigation,
 *                       which Cloudflare Access intercepts at the
 *                       edge and redirects to SSO.
 *   - `"authenticated"`   — render `children` (the admin UI).
 *
 * ## Defense in depth, not the primary gate
 *
 * Server-side, `requireAccessAuth()` still rejects every
 * `/api/admin/*` request without a valid auth header — so even a
 * cleverer attacker that bypassed this guard could not actually
 * read deck data or perform writes. This guard exists to prevent
 * INFORMATION DISCLOSURE (model names, settings UI, button names,
 * presenter affordances) and to give honest UX (clear sign-in flow
 * instead of a broken-looking admin page where every action fails).
 */
import type { ReactNode } from "react";
import { useAccessAuth } from "@/lib/use-access-auth";

interface RequireAdminAccessProps {
  children: ReactNode;
}

export function RequireAdminAccess({ children }: RequireAdminAccessProps) {
  const status = useAccessAuth();
  if (status === "checking") return <AdminAuthChecking />;
  if (status !== "authenticated") return <AdminAuthRequired />;
  return <>{children}</>;
}

/**
 * Brief loading splash for the in-flight auth probe. Lifetime is
 * sub-second on a warm network — the alternative (rendering admin
 * chrome immediately and then swapping it out if the probe returns
 * unauthenticated) would flash UI we'd have to yank back.
 */
function AdminAuthChecking() {
  return (
    <main
      data-testid="admin-auth-checking"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cf-bg-100 px-6 text-center"
    >
      <p className="cf-tag">Slide of Hand · Admin</p>
      <p className="text-sm text-cf-text-muted">Checking session…</p>
    </main>
  );
}

/**
 * Sign-in landing for unauthenticated visitors. The "Sign in via
 * Access" button triggers `window.location.reload()` — a full
 * browser navigation, which the Cloudflare Access edge intercepts and
 * redirects to SSO. Same pattern as `<PresenterAuthRequired>` in
 * PresenterWindow.tsx and the auth-expired banner in
 * StudioAgentPanel.tsx.
 */
function AdminAuthRequired() {
  return (
    <main
      role="alert"
      data-testid="admin-auth-required"
      className="flex min-h-screen flex-col items-center justify-center gap-5 bg-cf-bg-100 px-6 text-center"
    >
      <p className="cf-tag">Slide of Hand · Admin</p>
      <h1 className="text-2xl font-medium tracking-[-0.025em] text-cf-text">
        Sign in required
      </h1>
      <p className="max-w-md text-sm text-cf-text-muted">
        The Studio is reserved for deck authors. Sign in via Cloudflare
        Access to manage decks, edit speaker notes, and use the AI
        assistant.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="admin-auth-reload"
          onClick={() => window.location.reload()}
          className="cf-btn-primary"
        >
          Sign in via Access
        </button>
        <a
          href="/"
          data-testid="admin-auth-home"
          className="cf-btn-ghost"
        >
          Back to public site
        </a>
      </div>
    </main>
  );
}
