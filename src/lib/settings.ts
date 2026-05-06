/**
 * User-configurable viewer settings persisted to `localStorage`.
 *
 * The settings module is intentionally tiny: a typed `Settings` record, a
 * default constant, and `readSettings()` / `writeSettings()` helpers that
 * isolate every storage interaction in `try/catch` so private-mode
 * browsers, quota-exceeded errors, or just-plain-corrupt JSON degrade
 * silently to defaults.
 *
 * The hook consumer (`useSettings`) is the public API for React code; this
 * module exists separately so non-React contexts (tests, future SSR /
 * worker checks) can read / write settings without dragging in React.
 *
 * Adding a new setting is a one-property change: extend the `Settings`
 * type, add a default to `DEFAULT_SETTINGS`, and wire a row into
 * `<SettingsModal>`. v1 ships exactly one setting (`showSlideIndicators`).
 */

/** Storage key under which the settings JSON blob is persisted. */
export const STORAGE_KEY = "slide-of-hand-settings";

export interface Settings {
  /**
   * When `true`, `<ProgressBar>` is always visible at the bottom of the
   * viewer (current default behaviour after PR #40). When `false`, the
   * progress bar follows the same mouse-proximity gating as `<HintBar>`:
   * hidden by default, fades in within 80px of the bottom edge, fades
   * out 800ms after the cursor leaves.
   */
  showSlideIndicators: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  showSlideIndicators: true,
};

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the persisted settings, merged with defaults. Always returns a
 * complete `Settings` object — missing keys, invalid JSON, missing
 * storage, or a thrown access all degrade to `DEFAULT_SETTINGS`.
 */
export function readSettings(): Settings {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object") {
      return { ...DEFAULT_SETTINGS };
    }
    const partial = parsed as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      // Only accept keys whose values match the default's type. Extra /
      // unknown keys are ignored (forward-compat for v2 settings older
      // bundles haven't seen).
      showSlideIndicators:
        typeof partial.showSlideIndicators === "boolean"
          ? partial.showSlideIndicators
          : DEFAULT_SETTINGS.showSlideIndicators,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persist a partial update — merged with the current persisted settings.
 * Returns the merged object that was actually written (or the defaults,
 * if storage is unavailable). Storage failures are swallowed so a
 * private-mode browser doesn't break the UI.
 */
export function writeSettings(partial: Partial<Settings>): Settings {
  const current = readSettings();
  const merged: Settings = { ...current, ...partial };
  const storage = getStorage();
  if (!storage) return merged;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* private mode / quota — ignore */
  }
  return merged;
}

/**
 * Wipe the persisted settings entirely so subsequent reads fall back to
 * defaults. Storage failures are swallowed.
 */
export function resetSettings(): Settings {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return { ...DEFAULT_SETTINGS };
}
