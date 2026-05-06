/**
 * `useDeckTheme(slug)` — fetch the per-deck theme override on mount and
 * apply it as `:root` CSS custom properties so the deck (and all admin
 * chrome inside the same root) re-paints with the override.
 *
 * Used by:
 *   - <Deck>: every render path. Public viewers fetch + apply silently.
 *   - <ThemeSidebar> (admin only): reads `applyDraft()` / `clearDraft()`
 *     to render live previews while the author drags the colour pickers,
 *     and `refetch()` after a Save / Reset flushes KV.
 *
 * State machine:
 *
 *      load → tokens != null → setProperty(...) → cleanup on unmount
 *      load → tokens === null → no-op (source CSS defaults stay live)
 *
 *      applyDraft(d): setProperty(...) for all 4 tokens (overrides any
 *                     persisted override; purely DOM-side).
 *      clearDraft(): re-apply persisted tokens if any, else removeProperty()
 *                    so the source CSS shows through.
 *
 * No localStorage. KV is the source of truth; client-side state is
 * ephemeral and resets on a hard reload.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  THEME_TOKEN_NAMES,
  type ThemeTokens,
  type ThemeTokenName,
} from "@/lib/theme-tokens";

interface ThemeApiResponse {
  tokens: ThemeTokens | null;
  updatedAt: string | null;
}

export interface UseDeckThemeResult {
  /** The persisted override from KV, or null when none is configured. */
  tokens: ThemeTokens | null;
  /** ISO timestamp of the last persisted save (KV's `updatedAt`). */
  updatedAt: string | null;
  /** True until the first fetch resolves (success or failure). */
  isLoading: boolean;
  /** Apply a draft override to the DOM without persisting it. */
  applyDraft: (tokens: ThemeTokens) => void;
  /** Revert the DOM to either the persisted override or source defaults. */
  clearDraft: () => void;
  /** Re-fetch from `/api/themes/<slug>`. Call after Save / Reset. */
  refetch: () => Promise<void>;
}

function setRootToken(name: ThemeTokenName, value: string) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(`--color-${name}`, value);
}

function clearRootToken(name: ThemeTokenName) {
  if (typeof document === "undefined") return;
  document.documentElement.style.removeProperty(`--color-${name}`);
}

function applyAll(tokens: ThemeTokens) {
  for (const name of THEME_TOKEN_NAMES) {
    setRootToken(name, tokens[name]);
  }
}

function clearAll() {
  for (const name of THEME_TOKEN_NAMES) {
    clearRootToken(name);
  }
}

export function useDeckTheme(slug: string): UseDeckThemeResult {
  const [tokens, setTokens] = useState<ThemeTokens | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Track the last-applied state (persisted or draft). Used by `clearDraft`
  // to know whether to fall back to persisted tokens or to source defaults.
  const persistedRef = useRef<ThemeTokens | null>(null);

  const fetchTheme = useCallback(async () => {
    // Always bypass the browser HTTP cache. The response carries
    // `cache-control: public, max-age=60` for *edge* caching (Cloudflare
    // serves the same KV value to many visitors without re-reading KV),
    // but the browser-side cache would make Save → reload appear stale to
    // the author. Cache-Control is response-side; `cache: 'no-store'` is
    // request-side, so the two coexist: edge keeps caching, browser
    // always re-validates.
    const url = `/api/themes/${encodeURIComponent(slug)}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        // Treat any non-2xx as "no override" — the deck still works on
        // source defaults; we don't surface this error to users in v1.
        setTokens(null);
        setUpdatedAt(null);
        persistedRef.current = null;
        clearAll();
        return;
      }
      const body = (await res.json()) as ThemeApiResponse;
      setTokens(body.tokens);
      setUpdatedAt(body.updatedAt);
      persistedRef.current = body.tokens;
      if (body.tokens) {
        applyAll(body.tokens);
      } else {
        clearAll();
      }
    } catch {
      // Network failure → fall back to source defaults silently.
      setTokens(null);
      setUpdatedAt(null);
      persistedRef.current = null;
      clearAll();
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setIsLoading(true);
    void fetchTheme();
    return () => {
      // Cleanup: always strip our inline overrides on unmount so navigating
      // away from a styled deck doesn't pollute the next page (or admin
      // index) with the previous deck's brand.
      clearAll();
    };
  }, [fetchTheme]);

  const applyDraft = useCallback((draft: ThemeTokens) => {
    applyAll(draft);
  }, []);

  const clearDraft = useCallback(() => {
    if (persistedRef.current) {
      applyAll(persistedRef.current);
    } else {
      clearAll();
    }
  }, []);

  return {
    tokens,
    updatedAt,
    isLoading,
    applyDraft,
    clearDraft,
    refetch: fetchTheme,
  };
}
