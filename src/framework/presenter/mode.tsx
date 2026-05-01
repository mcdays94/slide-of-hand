/**
 * Presenter mode coordination — a tiny shared context that lets
 * different parts of the framework agree on whether the current
 * viewer is "presenter mode" (author at /admin/decks/<slug>) or
 * "public viewer" (anyone at /decks/<slug>).
 *
 * Shared between:
 *   - `framework/presenter/PresenterWindow.tsx` (slice #5) — only
 *     responds to the `P` key when this is true
 *   - `framework/tools/PresenterTools.tsx` (slice #6) — only mounts
 *     laser/magnifier/marker/auto-hide when this is true
 *   - `routes/admin/decks.$slug.tsx` (slice #7) — wraps the viewer
 *     in `<PresenterModeProvider enabled={true}>`
 *
 * The public viewer route does NOT wrap, so the default value is
 * `false` and presenter affordances stay hidden.
 *
 * Pre-created by the orchestrator before Wave 3 dispatch so the
 * three parallel workers have a stable shared contract instead of
 * each creating their own conflicting copy of this context.
 */
import { createContext, useContext, type ReactNode } from "react";

const PresenterModeContext = createContext<boolean>(false);

export function PresenterModeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <PresenterModeContext.Provider value={enabled}>
      {children}
    </PresenterModeContext.Provider>
  );
}

export function usePresenterMode(): boolean {
  return useContext(PresenterModeContext);
}
