/**
 * `<ThemeSidebar>` — admin-only right-side overlay for editing the four
 * core brand tokens of a deck. Triggered by the `T` key in `<Deck>` and
 * gated by `usePresenterMode()` so it never appears on the public viewer.
 *
 * Live-preview model:
 *   - The component owns a local `draft` state mirroring the four pickers.
 *   - On every change it calls `applyDraft(draft)` from `useDeckTheme()`,
 *     so the deck (and the admin chrome around it) repaints instantly.
 *   - Save POSTs the draft to `/api/admin/themes/<slug>` and re-fetches.
 *   - Reset DELETEs the KV key, calls `clearDraft()` to repaint with the
 *     CSS source defaults, and re-fetches.
 *
 * No state survives a hard reload; KV is the source of truth.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { easeEntrance } from "@/lib/motion";
import {
  HEX_COLOR_REGEX,
  SOURCE_DEFAULTS,
  THEME_TOKEN_NAMES,
  TOKEN_LABELS,
  type ThemeTokenName,
  type ThemeTokens,
} from "@/lib/theme-tokens";
import type { UseDeckThemeResult } from "./useDeckTheme";

export interface ThemeSidebarProps {
  open: boolean;
  slug: string;
  theme: UseDeckThemeResult;
  onClose: () => void;
}

type SaveState = "idle" | "saving" | "error";

function tokensEqual(a: ThemeTokens, b: ThemeTokens): boolean {
  for (const name of THEME_TOKEN_NAMES) {
    if (a[name].toLowerCase() !== b[name].toLowerCase()) return false;
  }
  return true;
}

function initialDraft(persisted: ThemeTokens | null): ThemeTokens {
  return persisted ? { ...persisted } : { ...SOURCE_DEFAULTS };
}

export function ThemeSidebar({ open, slug, theme, onClose }: ThemeSidebarProps) {
  const { tokens: persisted, applyDraft, clearDraft, refetch } = theme;

  // The draft state mirrors the form. We seed it from the persisted
  // override (if any) or the source defaults (if none), and reseed each
  // time the sidebar opens or the persisted value changes.
  const [draft, setDraft] = useState<ThemeTokens>(() =>
    initialDraft(persisted),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Re-seed the draft when the sidebar opens, or when persisted state
  // changes (Save / Reset / refetch). This intentionally wipes any
  // unsaved-but-not-applied edits when the sidebar is closed and re-opened
  // — simpler than tracking a separate "dirty" buffer.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setDraft(initialDraft(persisted));
      setSaveState("idle");
      setStatusMessage(null);
    }
    prevOpen.current = open;
  }, [open, persisted]);

  const baseline = useMemo<ThemeTokens>(
    () => persisted ?? SOURCE_DEFAULTS,
    [persisted],
  );

  const isDirty = useMemo(() => !tokensEqual(draft, baseline), [draft, baseline]);

  const updateToken = useCallback(
    (name: ThemeTokenName, raw: string) => {
      setDraft((prev) => {
        const next = { ...prev, [name]: raw };
        // Only push to DOM when the value is a valid 7-char hex, else the
        // browser would render an invalid colour and the deck would flicker.
        if (HEX_COLOR_REGEX.test(raw)) {
          applyDraft(next);
        }
        return next;
      });
    },
    [applyDraft],
  );

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      // Validate locally before hitting the network.
      for (const name of THEME_TOKEN_NAMES) {
        if (!HEX_COLOR_REGEX.test(draft[name])) {
          setSaveState("error");
          setStatusMessage(`Invalid hex value for ${TOKEN_LABELS[name]}.`);
          return;
        }
      }
      setSaveState("saving");
      setStatusMessage(null);
      try {
        const res = await fetch(`/api/admin/themes/${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokens: draft }),
        });
        if (!res.ok) {
          setSaveState("error");
          setStatusMessage(`Save failed (${res.status}).`);
          return;
        }
        await refetch();
        setSaveState("idle");
        setStatusMessage("Saved.");
      } catch {
        setSaveState("error");
        setStatusMessage("Save failed (network).");
      }
    },
    [draft, slug, refetch],
  );

  const onReset = useCallback(async () => {
    setSaveState("saving");
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/admin/themes/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setSaveState("error");
        setStatusMessage(`Reset failed (${res.status}).`);
        return;
      }
      await refetch();
      clearDraft();
      setDraft({ ...SOURCE_DEFAULTS });
      setSaveState("idle");
      setStatusMessage("Reset to defaults.");
    } catch {
      setSaveState("error");
      setStatusMessage("Reset failed (network).");
    }
  }, [slug, refetch, clearDraft]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="theme-sidebar"
          data-testid="theme-sidebar"
          data-no-advance
          aria-label="Theme overrides"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.2, ease: easeEntrance }}
          className="absolute right-0 top-0 z-50 flex h-full w-[340px] flex-col border-l border-cf-border bg-cf-bg-100 text-cf-text shadow-[0_0_0_1px_var(--color-cf-border)]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-cf-border px-5 py-4">
            <div>
              <p className="cf-tag">Overrides</p>
              <h2 className="mt-1 flex items-center gap-2 text-lg font-medium tracking-[-0.02em]">
                Theme
                {isDirty && (
                  <span
                    aria-label="unsaved changes"
                    title="Unsaved changes"
                    data-testid="theme-sidebar-dirty-indicator"
                    className="inline-block h-2 w-2 rounded-full bg-cf-orange"
                  />
                )}
              </h2>
            </div>
            <button
              type="button"
              data-interactive
              data-testid="theme-sidebar-close"
              onClick={onClose}
              aria-label="Close theme sidebar"
              className="cf-btn-ghost"
            >
              Esc
            </button>
          </header>

          <form
            onSubmit={onSubmit}
            className="flex flex-1 flex-col overflow-y-auto px-5 py-5"
          >
            <fieldset className="flex flex-col gap-4">
              <legend className="sr-only">Theme tokens</legend>
              {THEME_TOKEN_NAMES.map((name) => {
                const value = draft[name];
                const valid = HEX_COLOR_REGEX.test(value);
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-3"
                  >
                    <label
                      htmlFor={`theme-token-${name}`}
                      className="flex flex-1 flex-col"
                    >
                      <span className="cf-tag">{name}</span>
                      <span className="mt-0.5 text-sm text-cf-text">
                        {TOKEN_LABELS[name]}
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id={`theme-token-${name}`}
                        type="color"
                        data-interactive
                        aria-label={`${TOKEN_LABELS[name]} colour picker`}
                        value={valid ? value : "#000000"}
                        onChange={(e) => updateToken(name, e.target.value)}
                        className="h-8 w-10 cursor-pointer rounded border border-cf-border bg-transparent p-0"
                      />
                      <input
                        type="text"
                        data-interactive
                        aria-label={`${TOKEN_LABELS[name]} hex value`}
                        value={value}
                        spellCheck={false}
                        onChange={(e) =>
                          updateToken(name, e.target.value.trim())
                        }
                        className={`w-24 rounded border px-2 py-1 font-mono text-xs uppercase tracking-[0.1em] ${
                          valid
                            ? "border-cf-border text-cf-text"
                            : "border-cf-danger text-cf-danger"
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </fieldset>

            {statusMessage && (
              <p
                className={`mt-4 cf-tag ${
                  saveState === "error" ? "text-cf-danger" : "text-cf-text-muted"
                }`}
                role="status"
              >
                {statusMessage}
              </p>
            )}

            <footer className="mt-auto flex flex-col gap-2 border-t border-cf-border pt-4">
              <button
                type="submit"
                data-interactive
                data-testid="theme-sidebar-save"
                disabled={!isDirty || saveState === "saving"}
                className="cf-btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveState === "saving" ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                data-interactive
                data-testid="theme-sidebar-reset"
                onClick={onReset}
                disabled={!persisted || saveState === "saving"}
                className="cf-btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset to defaults
              </button>
            </footer>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
