/**
 * `useViewPreference` — per-surface Grid/List view-mode preference,
 * persisted to localStorage (issue #127).
 *
 * The deck-card grid renders on two surfaces — the public homepage
 * (`/`) and the Studio admin index (`/admin`) — and each remembers its
 * own choice. Storage keys:
 *
 *   - `slide-of-hand:view-preference:public`
 *   - `slide-of-hand:view-preference:admin`
 *
 * Defaults to `"grid"`. Unknown stored values (legacy / corrupted /
 * cross-version) are ignored and the default kicks in.
 *
 * SSR / no-window guard: Slide of Hand is an SPA so there's no
 * server-side render path today, but the hook still defends against
 * `typeof window === "undefined"` so it doesn't crash any future SSR
 * harness or test environment that hasn't stubbed `localStorage`.
 */

import { useCallback, useEffect, useState } from "react";

export type Surface = "public" | "admin";
export type ViewMode = "grid" | "list";

const STORAGE_PREFIX = "slide-of-hand:view-preference:";
const DEFAULT_MODE: ViewMode = "grid";

function storageKey(surface: Surface): string {
  return `${STORAGE_PREFIX}${surface}`;
}

function readStored(surface: Surface): ViewMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(storageKey(surface));
    if (raw === "grid" || raw === "list") return raw;
  } catch {
    // localStorage unavailable (e.g. disabled / private mode); fall
    // through to default.
  }
  return DEFAULT_MODE;
}

export interface UseViewPreferenceResult {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
}

export function useViewPreference(surface: Surface): UseViewPreferenceResult {
  // Read stored value lazily on first render so SSR (no window) gets
  // the default and CSR boots straight to the persisted choice with
  // no flicker.
  const [mode, setModeState] = useState<ViewMode>(() => readStored(surface));

  // Re-sync if the surface ever changes (e.g. the same hook instance
  // is reused under a different surface — unlikely in practice, but
  // keeps the hook honest).
  useEffect(() => {
    setModeState(readStored(surface));
  }, [surface]);

  const setMode = useCallback(
    (next: ViewMode) => {
      setModeState(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey(surface), next);
      } catch {
        // Quota / unavailable — the in-memory state still reflects
        // the choice for the current session.
      }
    },
    [surface],
  );

  return { mode, setMode };
}
