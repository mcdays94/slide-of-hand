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

/**
 * The default mode for the speaker-notes editor (issue #126). Rich-text
 * is the default for new users — it matches the PowerPoint-style notes
 * pane. Authors who prefer writing in markdown directly can flip the
 * setting and have markdown mode open automatically.
 */
export type NotesDefaultMode = "rich" | "markdown";

/**
 * Hover-preview animation settings (issue #128). When `enabled` is true
 * and the homepage / admin grid renders a `<DeckCard>` in `view="grid"`
 * mode, hovering the card cycles through the first `slideCount` slide
 * thumbnails (`01.png` … `0N.png`) at a fixed interval, giving the
 * viewer a quick preview of what's inside without having to open the
 * deck.
 *
 * `slideCount` is clamped to the inclusive range `[1, 8]` — 8 matches
 * the maximum number of thumbnails the build script generates per deck
 * (`scripts/build-thumbnails.mjs`). Values outside the range are
 * coerced to the nearest endpoint; non-integer values are rounded.
 */
export interface DeckCardHoverAnimationSettings {
  enabled: boolean;
  /** Inclusive 1-8. */
  slideCount: number;
}

/** Lower bound for `deckCardHoverAnimation.slideCount`. */
export const DECK_CARD_HOVER_SLIDE_COUNT_MIN = 1;
/** Upper bound for `deckCardHoverAnimation.slideCount`. Matches the build-script cap. */
export const DECK_CARD_HOVER_SLIDE_COUNT_MAX = 8;

function clampSlideCount(n: number): number {
  const rounded = Math.round(n);
  if (rounded < DECK_CARD_HOVER_SLIDE_COUNT_MIN) {
    return DECK_CARD_HOVER_SLIDE_COUNT_MIN;
  }
  if (rounded > DECK_CARD_HOVER_SLIDE_COUNT_MAX) {
    return DECK_CARD_HOVER_SLIDE_COUNT_MAX;
  }
  return rounded;
}

export interface Settings {
  /**
   * When `true`, `<ProgressBar>` is always visible at the bottom of the
   * viewer (current default behaviour after PR #40). When `false`, the
   * progress bar follows the same mouse-proximity gating as `<HintBar>`:
   * hidden by default, fades in within 80px of the bottom edge, fades
   * out 800ms after the cursor leaves.
   */
  showSlideIndicators: boolean;
  /**
   * When `true`, the presenter window's next-slide preview is rendered
   * at the LAST phase (fully revealed) as a single thumbnail. When
   * `false` (default), the next-slide area shows a horizontal filmstrip
   * of every phase for multi-phase next slides — the presenter can see
   * each reveal before pressing Next. Single-phase next slides render
   * as a single thumbnail in either mode.
   */
  presenterNextSlideShowsFinalPhase: boolean;
  /**
   * The default mode the speaker-notes editor opens in. Issue #126.
   * "rich" is the default — a TipTap-based WYSIWYG view with a
   * PowerPoint-style toolbar (Bold/Italic/Underline/Strike/H2/lists/
   * link/HR). "markdown" opens directly to a textarea showing the
   * markdown source — useful for authors who prefer to write or paste
   * markdown directly. The user can still toggle between modes via
   * the toolbar at any time; this setting only controls which view
   * loads first.
   */
  notesDefaultMode: NotesDefaultMode;
  /**
   * Hover-preview animation on deck cards (issue #128). When enabled,
   * hovering a grid-mode `<DeckCard>` cycles through the first
   * `slideCount` slide thumbnails on a 600ms interval. Animation is
   * grid-only — list-mode cards never animate. Default: enabled with
   * `slideCount = 3`.
   */
  deckCardHoverAnimation: DeckCardHoverAnimationSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  showSlideIndicators: true,
  presenterNextSlideShowsFinalPhase: false,
  notesDefaultMode: "rich",
  deckCardHoverAnimation: { enabled: true, slideCount: 3 },
};

/**
 * Coerce a possibly-malformed `deckCardHoverAnimation` blob from
 * persisted storage into a valid `DeckCardHoverAnimationSettings`.
 * Missing fields fall back to defaults, type mismatches fall back to
 * defaults, and `slideCount` is clamped to the supported range. Older
 * bundles that pre-date this setting will write nothing → defaults.
 */
function parseDeckCardHoverAnimation(
  raw: unknown,
): DeckCardHoverAnimationSettings {
  const fallback = DEFAULT_SETTINGS.deckCardHoverAnimation;
  if (raw == null || typeof raw !== "object") return { ...fallback };
  const partial = raw as Partial<DeckCardHoverAnimationSettings>;
  const enabled =
    typeof partial.enabled === "boolean" ? partial.enabled : fallback.enabled;
  const slideCount =
    typeof partial.slideCount === "number" && Number.isFinite(partial.slideCount)
      ? clampSlideCount(partial.slideCount)
      : fallback.slideCount;
  return { enabled, slideCount };
}

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
      presenterNextSlideShowsFinalPhase:
        typeof partial.presenterNextSlideShowsFinalPhase === "boolean"
          ? partial.presenterNextSlideShowsFinalPhase
          : DEFAULT_SETTINGS.presenterNextSlideShowsFinalPhase,
      notesDefaultMode:
        partial.notesDefaultMode === "rich" ||
        partial.notesDefaultMode === "markdown"
          ? partial.notesDefaultMode
          : DEFAULT_SETTINGS.notesDefaultMode,
      deckCardHoverAnimation: parseDeckCardHoverAnimation(
        partial.deckCardHoverAnimation,
      ),
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
