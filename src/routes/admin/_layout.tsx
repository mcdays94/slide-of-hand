/**
 * Admin shell layout — wraps every `/admin/*` page with a thin chrome strip
 * (kicker + Settings + link back to the public index). Nested routes render
 * via `<Outlet />`.
 *
 * Authentication is NOT enforced here — Cloudflare Access gates `/admin/*`
 * at the edge before any of this code runs.
 *
 * ## Why this layout owns Settings
 *
 * The `<SettingsModal>` is also mounted inside `<Deck>` (so the `S`
 * keyboard shortcut works while presenting). But the modal hosts
 * admin-only rows now — including the GitHub-connect row from
 * PR #147 — which the user shouldn't have to open a specific deck to
 * reach. Mounting from the admin layout puts Settings on EVERY
 * admin route (`/admin`, `/admin/decks/<slug>`, etc.) and makes the
 * GitHub connection accessible from the deck list itself, not just
 * deep inside an edit view.
 *
 * Two modals exist briefly when the user is inside `<Deck>`: this
 * one (mounted by the layout) and the one mounted by `<Deck>`. Only
 * one of them is `open` at any time — they share `useSettings()`
 * state but track open/close independently. Either entry point
 * (button click or `S` keystroke) works.
 *
 * ## Why `<PresenterModeProvider enabled={true}>`
 *
 * The SettingsModal's GitHub-connect row gates on `usePresenterMode()`
 * — true on admin/presenter routes, false on the public deck viewer.
 * Wrapping the entire admin shell ensures the row appears regardless
 * of which admin sub-route the user is on. (Inside `<Deck>`, the
 * per-route `<PresenterModeProvider>` does the same job already.)
 */

import { Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { SettingsModal } from "@/framework/viewer/SettingsModal";
import { PresenterModeProvider } from "@/framework/presenter/mode";

export default function AdminLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <PresenterModeProvider enabled={true}>
      <div className="flex min-h-screen flex-col bg-cf-bg-100 text-cf-text">
        <header className="flex items-center justify-between border-b border-cf-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="cf-tag no-underline">
              Slide of Hand · Admin
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="cf-btn-ghost inline-flex items-center gap-1.5"
              data-testid="admin-header-settings"
              aria-label="Open settings"
              title="Settings"
            >
              <SettingsIcon size={14} aria-hidden="true" />
              <span>Settings</span>
            </button>
            <Link to="/" className="cf-btn-ghost no-underline">
              Public site
            </Link>
          </div>
        </header>
        <Outlet />
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
    </PresenterModeProvider>
  );
}
