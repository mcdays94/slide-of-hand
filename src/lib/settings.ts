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
 * Which edge the ToC sidebar opens from when invoked via the M-key
 * shortcut (or any programmatic open that doesn't specify a side).
 * Edge-handle clicks always honour the clicked edge regardless of
 * this preference — see `<Deck>`'s `openSidebarFromSide`. Issue #211.
 */
export type ToCSidebarEdge = "left" | "right";

/**
 * In-Studio AI assistant model picker (issue #131 item A). The friendly
 * keys + type + type-guard live in their own DOM-free module so the
 * worker can import them without dragging in this file's localStorage
 * glue. We re-export here so existing client-side imports keep
 * working.
 *
 *   - **kimi-k2.6** (default) — Moonshot frontier 1T-parameter model,
 *     262.1k context, multi-turn tool calling.
 *   - **llama-4-scout** — Meta Llama 4 Scout, multimodal, 17B/16E.
 *   - **gpt-oss-120b** — OpenAI's open-weight reasoning model, 120B.
 *
 * See `src/lib/ai-models.ts` for the canonical declaration.
 */
export {
  AI_ASSISTANT_MODELS,
  isAiAssistantModel,
  type AiAssistantModel,
} from "./ai-models";
import { isAiAssistantModel } from "./ai-models";
import type { AiAssistantModel } from "./ai-models";

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
  /**
   * The model the in-Studio AI agent uses for chat completions
   * (issue #131 item A). One of three friendly keys; the server
   * maps the chosen key to the current Workers AI catalog ID. See
   * `AiAssistantModel` above for the per-option rationale.
   */
  aiAssistantModel: AiAssistantModel;
  /**
   * When `true`, the in-Studio chat panel renders the assistant's
   * `reasoning` message parts (the model's chain-of-thought) inline,
   * in a `<details open>` block above each assistant turn that emits
   * them. The user can collapse a given turn's reasoning per-instance;
   * each `<details>` keeps its own open state independently.
   *
   * Off by default. Reasoning is internal-feeling text most users
   * don't want by default, and the non-reasoning Workers AI models
   * (Kimi K2.6, Llama 4 Scout) don't emit reasoning parts anyway — so
   * the toggle is invisible in their output. Power-user opt-in only.
   *
   * Only the reasoning-tuned models (GPT-OSS 120B today) reliably
   * emit reasoning parts, but the setting is model-agnostic: enabling
   * it on a non-reasoning model is a no-op rather than an error.
   */
  showAssistantReasoning: boolean;
  /**
   * Which edge the ToC sidebar opens from when invoked via the
   * M-key shortcut (or any programmatic open that doesn't specify
   * a side). Default `"right"` matches the prior single-side
   * behaviour. Edge-handle clicks always honour the clicked edge
   * regardless of this preference — the setting only governs M /
   * programmatic openings. Issue #211.
   */
  tocSidebarEdge: ToCSidebarEdge;
}

export const DEFAULT_SETTINGS: Settings = {
  showSlideIndicators: true,
  presenterNextSlideShowsFinalPhase: false,
  notesDefaultMode: "rich",
  deckCardHoverAnimation: { enabled: true, slideCount: 3 },
  aiAssistantModel: "kimi-k2.6",
  showAssistantReasoning: false,
  tocSidebarEdge: "right",
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
      aiAssistantModel: isAiAssistantModel(partial.aiAssistantModel)
        ? partial.aiAssistantModel
        : DEFAULT_SETTINGS.aiAssistantModel,
      showAssistantReasoning:
        typeof partial.showAssistantReasoning === "boolean"
          ? partial.showAssistantReasoning
          : DEFAULT_SETTINGS.showAssistantReasoning,
      tocSidebarEdge:
        partial.tocSidebarEdge === "left" || partial.tocSidebarEdge === "right"
          ? partial.tocSidebarEdge
          : DEFAULT_SETTINGS.tocSidebarEdge,
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
