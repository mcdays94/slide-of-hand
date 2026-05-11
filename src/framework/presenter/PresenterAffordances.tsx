/**
 * Auth-gated presenter affordances.
 *
 * Hosts admin-only presenter affordances that should NOT be available
 * to unauthenticated visitors on the public deck route. Currently:
 *
 *   - `<PresenterWindowTrigger>` — the `P`-key handler that opens the
 *     presenter window. Speaker notes live behind authentication, so
 *     non-authenticated visitors should not be able to pop the window.
 *
 * Audience-side aids (laser, magnifier, marker) used to mount here
 * too, but they're audience tools — a presenter giving a talk on the
 * public URL needs Q/W/E to work without signing in. As of
 * 2026-05-11 those tools live OUTSIDE this gate, mounted directly by
 * `<Deck>` via `<PresenterTools>`.
 *
 * Gating: `usePresenterMode()`. On the public `/decks/<slug>` route
 * the provider's `enabled` is driven by `useAccessAuth()` (see
 * `src/routes/deck.$slug.tsx`) — so this component renders its
 * children only for authenticated admins. On `/admin/decks/<slug>`
 * the provider is hardcoded `enabled={true}` (the admin route is
 * Access-gated at the edge AND wrapped in `<RequireAdminAccess>`,
 * so every caller reaching here is authenticated).
 *
 * Each child component is responsible for its own keyboard listeners
 * and broadcast channel sends; `<Deck>` doesn't need to know about
 * presenter affordances beyond mounting this component.
 */
import { Fragment } from "react";
import { usePresenterMode } from "./mode";
import { PresenterWindowTrigger } from "./PresenterWindowTrigger";

export function PresenterAffordances() {
  if (!usePresenterMode()) return null;
  return (
    <Fragment>
      <PresenterWindowTrigger />
    </Fragment>
  );
}
