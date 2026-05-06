/**
 * `<ElementInspector>` — admin-only right-side overlay for swapping a
 * single element's text-color class. Triggered by the `I` key in
 * `<Deck>` and gated by `usePresenterMode()` so it never appears on the
 * public viewer.
 *
 * Slice-3 scope (#45): ONLY the `color` category from
 * `TAILWIND_TOKENS` is offered. Slice-4 (#46) will widen to the other
 * five categories (background / typography / spacing / border / sizing).
 *
 * Live-preview model (mirrors `<ThemeSidebar>`):
 *   - The user clicks an element on the slide; `<Deck>` passes the
 *     selection into this sidebar via `selection`.
 *   - The author picks a different color class; we mutate the live
 *     element's `className` immediately (`classList.replace(from, to)`)
 *     for a snappy preview, AND push a draft override list up through
 *     `onApplyDraft` so the same change persists across re-renders /
 *     route navigation.
 *   - Save POSTs the list via `useElementOverrides.save`.
 *   - Close drops the draft AND reverts the live `className` mutation so
 *     leaving without saving leaves the DOM untouched.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { easeEntrance } from "@/lib/motion";
import { TAILWIND_TOKENS } from "@/lib/tailwind-tokens";
import type { ElementOverride } from "./useElementOverrides";

/**
 * The currently-inspected element + the metadata `<Deck>` captured when
 * the user clicked it. The element reference is non-serialisable but
 * needed for live class mutation; everything else is the persisted
 * shape.
 */
export interface InspectorSelection {
  /** Live DOM node to mutate (live-preview path). */
  element: Element;
  /** SlideDef.id under which this selection lives. */
  slideId: string;
  /** Selector relative to `[data-slide-index]` (from #44 helpers). */
  selector: string;
  /** Tag + text fingerprint (from #44 helpers). */
  fingerprint: { tag: string; text: string };
}

export interface ElementInspectorProps {
  open: boolean;
  slug: string;
  selection: InspectorSelection | null;
  /** Currently-applied list (persistent + any in-flight draft). */
  applied: ElementOverride[];
  /** Push a new draft list up to `useElementOverrides`. */
  onApplyDraft: (overrides: ElementOverride[]) => void;
  /** Drop the draft so applied falls back to persistent. */
  onClearDraft: () => void;
  /** POST + refetch. Returns `{ ok }`. */
  onSave: (
    overrides: ElementOverride[],
  ) => Promise<{ ok: boolean; status?: number }>;
  /** Close the sidebar (called on Esc / Close button). */
  onClose: () => void;
}

type SaveState = "idle" | "saving" | "error";

const COLOR_GROUP = TAILWIND_TOKENS.find((g) => g.category === "color");

/**
 * Find the color-category class currently applied to `el`, or `null` if
 * none of the curated tokens are present. The picker uses this to seed
 * the radio selection AND to know what `from` value to record in the
 * override.
 */
function findCurrentColorClass(el: Element | null): string | null {
  if (!el || !COLOR_GROUP) return null;
  for (const cls of COLOR_GROUP.classNames) {
    if (el.classList.contains(cls)) return cls;
  }
  return null;
}

/**
 * Build a tag+class badge label for the SelectionOverlay or sidebar
 * header. Format: `H1.text-cf-orange` (uppercase tag, dot-prefixed
 * class). When no swap-able class is present, just the tag.
 */
export function buildSelectionLabel(
  fingerprint: { tag: string },
  currentClass: string | null,
): string {
  const tag = fingerprint.tag.toUpperCase();
  return currentClass ? `${tag}.${currentClass}` : tag;
}

/**
 * Walk the applied override list looking for an entry that matches
 * `(slideId, selector)`. Used so re-selecting an already-overridden
 * element preserves its swap chain.
 */
function findMatchingOverride(
  overrides: ElementOverride[],
  slideId: string,
  selector: string,
): ElementOverride | null {
  return (
    overrides.find(
      (o) => o.slideId === slideId && o.selector === selector,
    ) ?? null
  );
}

/**
 * Replace (or append) an override matching `(slideId, selector)` in the
 * list. Returns a new array — caller pushes it to `onApplyDraft`.
 */
function upsertOverride(
  list: ElementOverride[],
  override: ElementOverride,
): ElementOverride[] {
  const idx = list.findIndex(
    (o) =>
      o.slideId === override.slideId && o.selector === override.selector,
  );
  if (idx === -1) return [...list, override];
  const next = list.slice();
  next[idx] = override;
  return next;
}

export function ElementInspector({
  open,
  selection,
  applied,
  onApplyDraft,
  onClearDraft,
  onSave,
  onClose,
}: ElementInspectorProps) {
  // The "original" class is the one the element had at the moment of
  // selection (BEFORE any in-session swap). We track it separately so
  // Reset can revert the live DOM mutation back to the source state.
  const [originalClass, setOriginalClass] = useState<string | null>(null);
  // The currently-picked class for THIS selection. Drives the radio.
  const [pickedClass, setPickedClass] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Re-seed when selection swaps (or clears).
  useEffect(() => {
    if (!selection) {
      setOriginalClass(null);
      setPickedClass(null);
      setSaveState("idle");
      setStatusMessage(null);
      return;
    }
    // Read the element's current color class. If a saved override
    // already targets this element, the element's class on mount has
    // ALREADY been swapped (the deck-level applier ran), so this reads
    // the post-swap value — which is what we want.
    const current = findCurrentColorClass(selection.element);
    setOriginalClass(current);
    setPickedClass(current);
    setSaveState("idle");
    setStatusMessage(null);
  }, [selection]);

  const colorTokens = useMemo(
    () => COLOR_GROUP?.classNames ?? [],
    [],
  );

  const onPick = useCallback(
    (next: string) => {
      if (!selection || !originalClass) return;
      if (next === pickedClass) return;

      // Mutate the live DOM element so the change is visible immediately.
      // We swap from the CURRENT class (whatever the picker last set)
      // to the new class, NOT from `originalClass`, so consecutive picks
      // chain correctly.
      const current = pickedClass ?? originalClass;
      if (current && selection.element.classList.contains(current)) {
        selection.element.classList.replace(current, next);
      } else {
        // Defensive: if the original isn't on the element any more
        // (e.g. external mutation), just add the new class.
        selection.element.classList.add(next);
      }
      setPickedClass(next);

      // Push the override up through the draft list so it survives
      // re-renders and is captured in the eventual Save.
      const override: ElementOverride = {
        slideId: selection.slideId,
        selector: selection.selector,
        fingerprint: selection.fingerprint,
        classOverrides: [{ from: originalClass, to: next }],
      };
      onApplyDraft(upsertOverride(applied, override));
    },
    [selection, originalClass, pickedClass, applied, onApplyDraft],
  );

  const onResetSelection = useCallback(() => {
    if (!selection || !originalClass) return;
    const current = pickedClass ?? originalClass;
    if (
      current &&
      current !== originalClass &&
      selection.element.classList.contains(current)
    ) {
      selection.element.classList.replace(current, originalClass);
    }
    setPickedClass(originalClass);
    // Drop the draft entry for this selection.
    const next = applied.filter(
      (o) =>
        !(
          o.slideId === selection.slideId && o.selector === selection.selector
        ),
    );
    onApplyDraft(next);
  }, [selection, originalClass, pickedClass, applied, onApplyDraft]);

  const onSaveClick = useCallback(async () => {
    setSaveState("saving");
    setStatusMessage(null);
    const result = await onSave(applied);
    if (!result.ok) {
      setSaveState("error");
      setStatusMessage(
        result.status
          ? `Save failed (${result.status}).`
          : "Save failed (network).",
      );
      return;
    }
    setSaveState("idle");
    setStatusMessage("Saved.");
  }, [applied, onSave]);

  const onCloseClick = useCallback(() => {
    // Revert any in-session live DOM mutation for the active selection
    // so closing-without-saving never leaves the audience-facing markup
    // changed.
    if (selection && originalClass) {
      const current = pickedClass ?? originalClass;
      if (
        current &&
        current !== originalClass &&
        selection.element.classList.contains(current)
      ) {
        selection.element.classList.replace(current, originalClass);
      }
    }
    onClearDraft();
    onClose();
  }, [selection, originalClass, pickedClass, onClearDraft, onClose]);

  const headerLabel = useMemo(() => {
    if (!selection) return "";
    return buildSelectionLabel(selection.fingerprint, pickedClass);
  }, [selection, pickedClass]);

  const hasDraft = useMemo(() => {
    if (!selection) return false;
    return Boolean(findMatchingOverride(applied, selection.slideId, selection.selector));
  }, [applied, selection]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="element-inspector"
          data-testid="element-inspector"
          data-no-advance
          aria-label="Element inspector"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.2, ease: easeEntrance }}
          className="absolute right-0 top-0 z-50 flex h-full w-[340px] flex-col border-l border-cf-border bg-cf-bg-100 text-cf-text shadow-[0_0_0_1px_var(--color-cf-border)]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-cf-border px-5 py-4">
            <div>
              <p className="cf-tag">Inspector</p>
              <h2 className="mt-1 flex items-center gap-2 text-lg font-medium tracking-[-0.02em]">
                {selection ? "Element" : "Inspect"}
                {hasDraft && (
                  <span
                    aria-label="unsaved changes"
                    title="Unsaved changes"
                    data-testid="element-inspector-dirty-indicator"
                    className="inline-block h-2 w-2 rounded-full bg-cf-orange"
                  />
                )}
              </h2>
              {selection && (
                <p
                  data-testid="element-inspector-target"
                  className="mt-2 font-mono text-xs uppercase tracking-[0.1em] text-cf-text-muted"
                >
                  {headerLabel}
                </p>
              )}
            </div>
            <button
              type="button"
              data-interactive
              data-testid="element-inspector-close"
              onClick={onCloseClick}
              aria-label="Close element inspector"
              className="cf-btn-ghost"
            >
              Esc
            </button>
          </header>

          <div className="flex flex-1 flex-col overflow-y-auto px-5 py-5">
            {!selection && (
              <p
                data-testid="element-inspector-empty"
                className="text-sm text-cf-text-muted"
              >
                Click an element on the slide to inspect it.
              </p>
            )}

            {selection && (
              <fieldset className="flex flex-col gap-4">
                <legend className="cf-tag">Text color</legend>
                <p className="text-xs text-cf-text-muted">
                  {originalClass ? (
                    <>
                      Original:{" "}
                      <code
                        data-testid="element-inspector-original"
                        className="font-mono"
                      >
                        {originalClass}
                      </code>
                    </>
                  ) : (
                    <>This element has no curated text-color class.</>
                  )}
                </p>
                <ul
                  className="flex flex-col gap-1"
                  data-testid="element-inspector-color-list"
                >
                  {colorTokens.map((cls) => {
                    const checked = pickedClass === cls;
                    return (
                      <li key={cls}>
                        <label
                          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm ${
                            checked
                              ? "bg-cf-bg-300 text-cf-text"
                              : "text-cf-text-muted hover:bg-cf-bg-200"
                          }`}
                        >
                          <input
                            type="radio"
                            data-interactive
                            data-testid={`element-inspector-color-${cls}`}
                            name="text-color"
                            value={cls}
                            checked={checked}
                            disabled={!originalClass}
                            onChange={() => onPick(cls)}
                            className="accent-cf-orange"
                          />
                          <span className="font-mono">{cls}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            )}

            {statusMessage && (
              <p
                className={`mt-4 cf-tag ${
                  saveState === "error"
                    ? "text-cf-danger"
                    : "text-cf-text-muted"
                }`}
                role="status"
              >
                {statusMessage}
              </p>
            )}

            <footer className="mt-auto flex flex-col gap-2 border-t border-cf-border pt-4">
              <button
                type="button"
                data-interactive
                data-testid="element-inspector-save"
                onClick={onSaveClick}
                disabled={!hasDraft || saveState === "saving"}
                className="cf-btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveState === "saving" ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                data-interactive
                data-testid="element-inspector-reset"
                onClick={onResetSelection}
                disabled={
                  !selection || pickedClass === originalClass || !originalClass
                }
                className="cf-btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset selection
              </button>
            </footer>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
