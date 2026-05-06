/**
 * `<SettingsProvider>` + `useSettings()` — React glue around the
 * `localStorage`-backed settings module (`src/lib/settings.ts`).
 *
 * The provider reads initial state via `readSettings()` (so the very
 * first render reflects the persisted blob), exposes a typed setter, and
 * listens for the `storage` event so a settings change in another tab
 * propagates here without a reload.
 *
 * Adding a new setting only requires extending `Settings` in
 * `@/lib/settings` and adding a row to `<SettingsModal>` — no changes to
 * this file.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  readSettings,
  resetSettings as resetSettingsToDefaults,
  writeSettings,
  type Settings,
} from "@/lib/settings";

export interface SettingsContextValue {
  settings: Settings;
  /**
   * Update one setting. Persists to localStorage and re-renders all
   * consumers of the context. Synchronous from the consumer's POV.
   */
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /**
   * Reset every setting to its default value and wipe the persisted
   * blob.
   */
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export interface SettingsProviderProps {
  children: ReactNode;
  /**
   * Optional override for tests — bypasses the localStorage read so a
   * test can mount the provider with a known state without seeding
   * storage by hand.
   */
  initialSettings?: Settings;
}

export function SettingsProvider({
  children,
  initialSettings,
}: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings>(
    () => initialSettings ?? readSettings(),
  );

  const setSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((prev) => {
        const next: Settings = { ...prev, [key]: value };
        writeSettings({ [key]: value } as Partial<Settings>);
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => {
    resetSettingsToDefaults();
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  // Cross-tab sync: when another tab writes the settings blob, re-read
  // and update local state. We only react to events on our key (and
  // `key === null` from a `localStorage.clear()` call).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      setSettings(readSettings());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, setSetting, reset }),
    [settings, setSetting, reset],
  );

  return createElement(SettingsContext.Provider, { value }, children);
}

/**
 * Subscribe to the settings context. If no provider is mounted (e.g. a
 * unit test rendering a chrome component in isolation), returns a
 * sensible no-op shape backed by `DEFAULT_SETTINGS` so callers don't
 * have to null-check.
 */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (ctx) return ctx;
  return {
    settings: DEFAULT_SETTINGS,
    setSetting: () => {
      /* no-op without provider */
    },
    reset: () => {
      /* no-op without provider */
    },
  };
}
