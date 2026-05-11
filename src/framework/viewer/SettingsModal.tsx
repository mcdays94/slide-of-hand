/**
 * `<SettingsModal>` — centred overlay for editing per-browser viewer
 * preferences (issue #32).
 *
 * v1 ships a single setting: `showSlideIndicators` (default ON). When
 * OFF, `<ProgressBar>` follows the same mouse-proximity gating as
 * `<HintBar>` instead of being permanently visible.
 *
 * Adding a 2nd / 3rd setting is a one-property change in
 * `@/lib/settings.ts` plus a new `<SettingsRow>` here. The form
 * scaffolding stays lean — no array-driven row generator, no "settings
 * schema". Just append rows.
 *
 * Closes on:
 *   - the X button
 *   - clicking the backdrop (anywhere outside the panel)
 *   - the Esc key (handled by `<Deck>`'s top-level keydown listener,
 *     which calls our `onClose` via `closeOverlays`)
 */

import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
} from "framer-motion";
import { useEffect, useId, type MouseEvent, type ReactNode } from "react";
import type {
  AiAssistantModel,
  DeckCardHoverAnimationSettings,
  NotesDefaultMode,
} from "@/lib/settings";
import { usePresenterMode } from "@/framework/presenter/mode";
import { GitHubConnectRow } from "@/components/GitHubConnectRow";
import {
  DECK_CARD_HOVER_SLIDE_COUNT_MAX,
  DECK_CARD_HOVER_SLIDE_COUNT_MIN,
} from "@/lib/settings";
import { easeStandard } from "@/lib/motion";
import { useSettings } from "./useSettings";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const backdropMotion: HTMLMotionProps<"div"> = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: easeStandard },
};

const panelMotion: HTMLMotionProps<"div"> = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { duration: 0.2, ease: easeStandard },
};

interface SettingsRowProps {
  /** Stable id used to associate the label and the toggle. */
  inputId: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}

function SettingsRow({
  inputId,
  label,
  description,
  checked,
  onChange,
  testId,
}: SettingsRowProps) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="flex-1">
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-cf-text"
        >
          {label}
        </label>
        <p className="mt-1 text-xs text-cf-text-muted">{description}</p>
      </div>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-interactive
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-cf-border transition-colors duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-cf-orange ${
          checked ? "bg-cf-orange" : "bg-cf-bg-200"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 transform rounded-full bg-cf-bg-100 shadow-sm transition-transform duration-200 ease-out ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

interface SettingsSegmentedRowProps<T extends string> {
  label: string;
  description: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  /** Test-id prefix; each option gets `${testIdPrefix}-${option.value}`. */
  testIdPrefix?: string;
}

/**
 * Segmented-control row for enum settings (issue #126). Two-or-more
 * mutually-exclusive buttons; the active option carries the orange
 * border + filled style used for similar toggles in the presenter
 * window. Visually distinct from `<SettingsRow>` so the user reads
 * "this is one of N choices, not on/off".
 *
 * Layout:
 *   - **2 options**: horizontal — label left, buttons right. Works
 *     because 2-option labels (Rich/Markdown) fit comfortably
 *     alongside the description column.
 *   - **3+ options**: stack vertically — label + description on top,
 *     buttons below as a full-width segmented control. Without this,
 *     long option labels (e.g. "GPT-OSS 120B" + "LLAMA 4 SCOUT" +
 *     "KIMI K2.6") squeeze the description column to ~8 chars/line.
 *     Issue surfaced 2026-05-11 on the AI model picker.
 */
function SettingsSegmentedRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  testIdPrefix,
}: SettingsSegmentedRowProps<T>) {
  const stack = options.length > 2;
  return (
    <div
      className={
        stack
          ? "flex flex-col gap-3 py-4"
          : "flex items-start justify-between gap-6 py-4"
      }
    >
      <div className={stack ? "" : "flex-1"}>
        <p className="block text-sm font-medium text-cf-text">{label}</p>
        <p className="mt-1 text-xs text-cf-text-muted">{description}</p>
      </div>
      <div
        role="group"
        aria-label={label}
        className={`flex shrink-0 items-center gap-1 rounded-md border border-cf-border bg-cf-bg-200 p-0.5 ${stack ? "self-stretch" : ""}`}
      >
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              data-interactive
              data-testid={
                testIdPrefix ? `${testIdPrefix}-${opt.value}` : undefined
              }
              onClick={() => onChange(opt.value)}
              className={`rounded px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                stack ? "flex-1" : ""
              } ${
                isActive
                  ? "bg-cf-orange text-cf-bg-100"
                  : "text-cf-text-muted hover:text-cf-text"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface SettingsNumericRowProps {
  label: string;
  description: string;
  value: number;
  /** Inclusive minimum; rendered as the first option. */
  min: number;
  /** Inclusive maximum; rendered as the last option. */
  max: number;
  onChange: (next: number) => void;
  /** Test-id prefix; each option gets `${testIdPrefix}-${n}`. */
  testIdPrefix?: string;
}

/**
 * Numeric segmented-row (issue #128). Renders one button per integer in
 * `[min, max]` and highlights the active value. We chose a segmented
 * control over a stepper so the user can pick any value in one click —
 * the range (1-8) is small enough to fit comfortably and avoids the
 * extra plus/minus chrome.
 */
function SettingsNumericRow({
  label,
  description,
  value,
  min,
  max,
  onChange,
  testIdPrefix,
}: SettingsNumericRowProps) {
  const options: number[] = [];
  for (let n = min; n <= max; n++) options.push(n);
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="flex-1">
        <p className="block text-sm font-medium text-cf-text">{label}</p>
        <p className="mt-1 text-xs text-cf-text-muted">{description}</p>
      </div>
      <div
        role="group"
        aria-label={label}
        data-testid={testIdPrefix}
        className="flex shrink-0 items-center gap-1 rounded-md border border-cf-border bg-cf-bg-200 p-0.5"
      >
        {options.map((n) => {
          const isActive = n === value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={isActive}
              data-interactive
              data-testid={
                testIdPrefix ? `${testIdPrefix}-${n}` : undefined
              }
              onClick={() => onChange(n)}
              className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                isActive
                  ? "bg-cf-orange text-cf-bg-100"
                  : "text-cf-text-muted hover:text-cf-text"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { settings, setSetting } = useSettings();
  const showIndicatorsId = useId();
  const presenterFinalPhaseId = useId();
  const notesDefaultModeId = useId();
  const deckCardHoverId = useId();
  const aiAssistantModelId = useId();
  const showAssistantReasoningId = useId();

  // Click-on-backdrop closes; clicks on the inner panel must NOT bubble
  // to the backdrop. We compare currentTarget vs target so a click that
  // started inside the panel but ended on the backdrop (drag-select)
  // doesn't accidentally close.
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Esc-to-close handled inside the modal itself. <Deck>'s top-level
  // keydown handler also calls closeOverlays for Esc, but it bails
  // early if focus is on a `data-interactive` element (e.g. the toggle
  // we just clicked). Listening here too makes the close reliable
  // regardless of focus.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The modal is mounted UNCONDITIONALLY so AnimatePresence can play the
  // exit animation. We render nothing (no panel, no overlay) when
  // `open` is false; AnimatePresence handles the rest.
  return (
    <AnimatePresence>
      {open && (
        <SettingsModalContent
          showIndicators={settings.showSlideIndicators}
          showIndicatorsId={showIndicatorsId}
          onToggleShowIndicators={(next) =>
            setSetting("showSlideIndicators", next)
          }
          presenterFinalPhase={settings.presenterNextSlideShowsFinalPhase}
          presenterFinalPhaseId={presenterFinalPhaseId}
          onTogglePresenterFinalPhase={(next) =>
            setSetting("presenterNextSlideShowsFinalPhase", next)
          }
          notesDefaultMode={settings.notesDefaultMode}
          notesDefaultModeId={notesDefaultModeId}
          onChangeNotesDefaultMode={(next) =>
            setSetting("notesDefaultMode", next)
          }
          deckCardHoverAnimation={settings.deckCardHoverAnimation}
          deckCardHoverId={deckCardHoverId}
          onChangeDeckCardHoverAnimation={(next) =>
            setSetting("deckCardHoverAnimation", next)
          }
          aiAssistantModel={settings.aiAssistantModel}
          aiAssistantModelId={aiAssistantModelId}
          onChangeAiAssistantModel={(next) =>
            setSetting("aiAssistantModel", next)
          }
          showAssistantReasoning={settings.showAssistantReasoning}
          showAssistantReasoningId={showAssistantReasoningId}
          onToggleShowAssistantReasoning={(next) =>
            setSetting("showAssistantReasoning", next)
          }
          onBackdropClick={onBackdropClick}
          onClose={onClose}
        />
      )}
    </AnimatePresence>
  );
}

interface SettingsModalContentProps {
  showIndicators: boolean;
  showIndicatorsId: string;
  onToggleShowIndicators: (next: boolean) => void;
  presenterFinalPhase: boolean;
  presenterFinalPhaseId: string;
  onTogglePresenterFinalPhase: (next: boolean) => void;
  notesDefaultMode: NotesDefaultMode;
  notesDefaultModeId: string;
  onChangeNotesDefaultMode: (next: NotesDefaultMode) => void;
  deckCardHoverAnimation: DeckCardHoverAnimationSettings;
  deckCardHoverId: string;
  onChangeDeckCardHoverAnimation: (
    next: DeckCardHoverAnimationSettings,
  ) => void;
  aiAssistantModel: AiAssistantModel;
  aiAssistantModelId: string;
  onChangeAiAssistantModel: (next: AiAssistantModel) => void;
  showAssistantReasoning: boolean;
  showAssistantReasoningId: string;
  onToggleShowAssistantReasoning: (next: boolean) => void;
  onBackdropClick: (e: MouseEvent<HTMLDivElement>) => void;
  onClose: () => void;
}

function SettingsModalContent({
  showIndicators,
  showIndicatorsId,
  onToggleShowIndicators,
  presenterFinalPhase,
  presenterFinalPhaseId,
  onTogglePresenterFinalPhase,
  notesDefaultMode,
  onChangeNotesDefaultMode,
  deckCardHoverAnimation,
  deckCardHoverId,
  onChangeDeckCardHoverAnimation,
  aiAssistantModel,
  onChangeAiAssistantModel,
  showAssistantReasoning,
  showAssistantReasoningId,
  onToggleShowAssistantReasoning,
  onBackdropClick,
  onClose,
}: SettingsModalContentProps): ReactNode {
  // Presenter mode is the gate for admin-only integrations. The
  // SettingsModal is opened from both public deck routes and admin
  // routes — the GitHub-connect row only makes sense in the admin
  // context (the OAuth flow hits Access-gated endpoints; public
  // visitors don't have an Access session).
  const presenterMode = usePresenterMode();
  return (
    <motion.div
      key="settings-modal-backdrop"
      data-testid="settings-modal"
      data-no-advance
      onClick={onBackdropClick}
      className="absolute inset-0 z-50 flex items-center justify-center bg-cf-bg-100/80 px-6 py-12 backdrop-blur-sm"
      {...backdropMotion}
    >
      <motion.div
        data-testid="settings-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="cf-card w-full max-w-md p-8"
        {...panelMotion}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="cf-tag mb-2">Preferences</p>
            <h2
              id="settings-modal-title"
              className="text-2xl font-medium tracking-[-0.025em]"
            >
              Settings
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            data-interactive
            data-testid="settings-modal-close"
            onClick={onClose}
            className="cf-btn-ghost"
          >
            Esc
          </button>
        </div>
        <div className="divide-y divide-cf-border border-y border-cf-border">
          {/* Audience-side setting — visible to everyone, including
              unauthenticated visitors on `/decks/<slug>`. Show-slide-
              indicators is a pure viewer-side display preference; it
              doesn't reveal any admin surface or expose deck-author
              context. Every other setting below is admin-gated. */}
          <SettingsRow
            inputId={showIndicatorsId}
            label="Show slide indicators always"
            description="Keep the bottom progress bar visible at all times. When off, it fades in only when your cursor approaches the bottom of the screen."
            checked={showIndicators}
            onChange={onToggleShowIndicators}
            testId="settings-modal-toggle-show-indicators"
          />
          {/* Admin-only rows. Gated on `presenterMode` which on the
              public deck route is driven by `useAccessAuth()` (see
              `routes/deck.$slug.tsx`). Hiding these from non-Access
              visitors prevents information disclosure (model names,
              GitHub connection state, presenter-only preferences) and
              keeps the audience-side viewer Settings modal lean. */}
          {presenterMode && (
            <>
              <SettingsRow
                inputId={presenterFinalPhaseId}
                label="Next slide preview shows final state"
                description="In the presenter window, render the next-slide preview as a single thumbnail at its last phase (fully revealed). When off, multi-phase next slides show a horizontal filmstrip — one mini thumbnail per phase, in order — so you can see each reveal before pressing Next."
                checked={presenterFinalPhase}
                onChange={onTogglePresenterFinalPhase}
                testId="settings-modal-toggle-presenter-final-phase"
              />
              <SettingsSegmentedRow
                label="Default speaker-notes mode"
                description="Which view the speaker-notes editor opens in. Rich is a WYSIWYG editor with a PowerPoint-style toolbar. Markdown opens directly to the source view — pick this if you prefer to write or paste markdown directly. You can still toggle modes per-slide via the toolbar."
                value={notesDefaultMode}
                options={[
                  { value: "rich", label: "Rich" },
                  { value: "markdown", label: "Markdown" },
                ]}
                onChange={onChangeNotesDefaultMode}
                testIdPrefix="settings-modal-notes-default-mode"
              />
              <SettingsRow
                inputId={deckCardHoverId}
                label="Deck card hover preview"
                description="On the homepage and admin grid, hovering a deck card cycles through the first few slide thumbnails so you can preview a deck without opening it. List view never animates."
                checked={deckCardHoverAnimation.enabled}
                onChange={(next) =>
                  onChangeDeckCardHoverAnimation({
                    ...deckCardHoverAnimation,
                    enabled: next,
                  })
                }
                testId="settings-modal-toggle-deck-card-hover"
              />
              {deckCardHoverAnimation.enabled && (
                <SettingsNumericRow
                  label="Slides shown on hover"
                  description="How many slide thumbnails to cycle through while hovering. The first slide is always shown when not hovering."
                  value={deckCardHoverAnimation.slideCount}
                  min={DECK_CARD_HOVER_SLIDE_COUNT_MIN}
                  max={DECK_CARD_HOVER_SLIDE_COUNT_MAX}
                  onChange={(next) =>
                    onChangeDeckCardHoverAnimation({
                      ...deckCardHoverAnimation,
                      slideCount: next,
                    })
                  }
                  testIdPrefix="settings-modal-deck-card-hover-slide-count"
                />
              )}
              <SettingsSegmentedRow
                label="AI assistant model"
                description="Which Workers AI model the in-Studio chat assistant uses. Kimi K2.6 is the frontier default; Llama 4 Scout is multimodal; GPT-OSS 120B is reasoning-tuned. The server validates against the allow-list on every turn."
                value={aiAssistantModel}
                options={[
                  { value: "kimi-k2.6", label: "Kimi K2.6" },
                  { value: "llama-4-scout", label: "Llama 4 Scout" },
                  { value: "gpt-oss-120b", label: "GPT-OSS 120B" },
                ]}
                onChange={onChangeAiAssistantModel}
                testIdPrefix="settings-modal-ai-assistant-model"
              />
              <SettingsRow
                inputId={showAssistantReasoningId}
                label="Show model thinking"
                description="Render the assistant's chain-of-thought above each reply, in a collapsible block. Off by default. Only reasoning-tuned models (GPT-OSS 120B today) emit visible thinking — enabling this for Kimi K2.6 or Llama 4 Scout is a no-op."
                checked={showAssistantReasoning}
                onChange={onToggleShowAssistantReasoning}
                testId="settings-modal-toggle-show-assistant-reasoning"
              />
              <GitHubConnectRow />
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
