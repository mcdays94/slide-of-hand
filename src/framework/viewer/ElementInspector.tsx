/**
 * `<ElementInspector>` — admin-only right-side overlay for swapping
 * Tailwind class tokens on a single element across the full SoH catalog.
 * Triggered by the `I` key in `<Deck>` and gated by `usePresenterMode()`
 * so it never appears on the public viewer.
 *
 * Slice-4 scope (#46): widens the slice-3 tracer (color only) to cover
 * all 6 token categories from `TAILWIND_TOKENS` (color, background,
 * typography, spacing, border, sizing). Each category renders as a
 * collapsible section in the sidebar; the section containing the
 * element's current matching class is auto-opened on selection.
 *
 * Live-preview model (mirrors `<ThemeSidebar>`):
 *   - The user clicks an element on the slide; `<Deck>` passes the
 *     selection into this sidebar via `selection`.
 *   - The author picks a different class from any category; we mutate
 *     the live element's `className` immediately
 *     (`classList.replace(from, to)`) for a snappy preview, AND push a
 *     draft override list up through `onApplyDraft` so the same change
 *     persists across re-renders / route navigation.
 *   - Multiple categories accumulate into a single override entry's
 *     `classOverrides` array — e.g. swap `text-cf-orange` AND
 *     `bg-cf-bg-100` before saving and both ride along in one POST.
 *   - Save POSTs the list via `useElementOverrides.save`.
 *   - Close drops the draft AND reverts every in-session live
 *     `className` mutation so leaving without saving leaves the DOM
 *     untouched.
 *
 * Token-discovery rules:
 *   - Each `TokenGroup` from `TAILWIND_TOKENS` is rendered in fixed
 *     iteration order; the first group whose `classNames` matches a
 *     class on the selected element is auto-opened.
 *   - Within a group, the first matching class on the element is treated
 *     as the "original" — that's what `from` records in the override.
 *     Picking a different class in the same group swaps it in place.
 *   - If a group has no matching class on the element, all of its
 *     tokens are disabled — the inspector only swaps EXISTING classes,
 *     it doesn't add new ones (the override schema is `{from, to}`,
 *     not `{add}`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { easeEntrance } from "@/lib/motion";
import { TAILWIND_TOKENS, type TokenCategory } from "@/lib/tailwind-tokens";
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

/**
 * Find the first class belonging to `group` that is currently applied to
 * `el`, or `null` if none of the curated tokens are present. Used to
 * seed each section's "original" class and to drive the auto-open
 * heuristic.
 */
function findClassForGroup(
  el: Element | null,
  classNames: readonly string[],
): string | null {
  if (!el) return null;
  for (const cls of classNames) {
    if (el.classList.contains(cls)) return cls;
  }
  return null;
}

/**
 * Build the originals / picks dictionaries for every category at the
 * moment of selection. Both maps share keys; a `null` value means "no
 * curated token from this category is on the element".
 */
function buildClassMaps(el: Element | null): Record<TokenCategory, string | null> {
  const map = {} as Record<TokenCategory, string | null>;
  for (const group of TAILWIND_TOKENS) {
    map[group.category] = findClassForGroup(el, group.classNames);
  }
  return map;
}

/**
 * Build a tag+class badge label for the SelectionOverlay or sidebar
 * header. Format: `H1.text-cf-orange` (uppercase tag, dot-prefixed
 * class). When no swap-able class is present, just the tag.
 *
 * Kept exported for `<Deck>`'s SelectionOverlay label so the badge stays
 * in sync with the inspector's notion of "what is this element wearing".
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
 * Replace (or remove) the override entry for `(slideId, selector)`. If
 * the new entry has no `classOverrides` (all swaps reverted to their
 * originals) it is dropped from the list entirely so re-selecting the
 * element shows a clean "no draft" state.
 */
function upsertOrRemoveOverride(
  list: ElementOverride[],
  slideId: string,
  selector: string,
  next: ElementOverride | null,
): ElementOverride[] {
  const idx = list.findIndex(
    (o) => o.slideId === slideId && o.selector === selector,
  );
  if (next === null) {
    if (idx === -1) return list;
    const out = list.slice();
    out.splice(idx, 1);
    return out;
  }
  if (idx === -1) return [...list, next];
  const out = list.slice();
  out[idx] = next;
  return out;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3 w-3 transition-transform duration-150 ${
        open ? "rotate-90" : ""
      }`}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
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
  // Per-category "original" class — the value the element wore at the
  // moment of selection. Drives `from` in the override entry and the
  // disabled-state of each section's tokens (a section with no original
  // can't swap anything).
  const [originals, setOriginals] = useState<Record<TokenCategory, string | null>>(
    () => buildClassMaps(null),
  );
  // Per-category currently-picked class. Drives the radio selection AND
  // is used to compute the next-pick swap (`replace(picked, next)`).
  const [picks, setPicks] = useState<Record<TokenCategory, string | null>>(
    () => buildClassMaps(null),
  );
  // Which section headers are expanded. Auto-open populates this on
  // selection; the user can toggle others manually.
  const [openSections, setOpenSections] = useState<Set<TokenCategory>>(
    () => new Set(),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Re-seed when selection swaps (or clears).
  useEffect(() => {
    if (!selection) {
      setOriginals(buildClassMaps(null));
      setPicks(buildClassMaps(null));
      setOpenSections(new Set());
      setSaveState("idle");
      setStatusMessage(null);
      return;
    }
    const seeded = buildClassMaps(selection.element);
    setOriginals(seeded);
    setPicks(seeded);
    setSaveState("idle");
    setStatusMessage(null);
    // Auto-open the FIRST category that has a matching class on the
    // element. Iterate in TAILWIND_TOKENS' declared order for a stable
    // UX (e.g. an h1 with both `text-cf-orange` and `text-6xl` opens
    // Color, not Typography — color is declared first).
    const firstHit = TAILWIND_TOKENS.find(
      (g) => seeded[g.category] !== null,
    );
    setOpenSections(firstHit ? new Set([firstHit.category]) : new Set());
  }, [selection]);

  /**
   * Recompute the override entry for the current selection from the
   * supplied `picks` + the immutable `originals`. Each category whose
   * pick differs from its original contributes one swap. Returns `null`
   * when no category has any swap (the entry should be dropped).
   */
  const buildOverrideForSelection = useCallback(
    (
      currentPicks: Record<TokenCategory, string | null>,
    ): ElementOverride | null => {
      if (!selection) return null;
      const swaps: Array<{ from: string; to: string }> = [];
      for (const group of TAILWIND_TOKENS) {
        const orig = originals[group.category];
        const pick = currentPicks[group.category];
        if (orig && pick && pick !== orig) {
          swaps.push({ from: orig, to: pick });
        }
      }
      if (swaps.length === 0) return null;
      return {
        slideId: selection.slideId,
        selector: selection.selector,
        fingerprint: selection.fingerprint,
        classOverrides: swaps,
      };
    },
    [selection, originals],
  );

  const onPick = useCallback(
    (category: TokenCategory, next: string) => {
      if (!selection) return;
      const orig = originals[category];
      if (!orig) return; // section without original can't swap
      const current = picks[category] ?? orig;
      if (next === current) return;

      // Mutate the live DOM element so the change is visible immediately.
      // Swap from the CURRENT picked class (whatever the picker last set
      // for THIS category) to the new pick — consecutive picks chain
      // correctly within the category.
      if (selection.element.classList.contains(current)) {
        selection.element.classList.replace(current, next);
      } else {
        // Defensive: external mutation removed the source class.
        selection.element.classList.add(next);
      }

      const nextPicks: Record<TokenCategory, string | null> = {
        ...picks,
        [category]: next,
      };
      setPicks(nextPicks);

      const override = buildOverrideForSelection(nextPicks);
      onApplyDraft(
        upsertOrRemoveOverride(
          applied,
          selection.slideId,
          selection.selector,
          override,
        ),
      );
    },
    [
      selection,
      originals,
      picks,
      applied,
      onApplyDraft,
      buildOverrideForSelection,
    ],
  );

  /**
   * Revert every in-session live DOM mutation for the active selection,
   * restoring the element to its original (authored-in-code) class set.
   * Used by Reset and Close.
   */
  const revertLiveMutations = useCallback(() => {
    if (!selection) return;
    for (const group of TAILWIND_TOKENS) {
      const orig = originals[group.category];
      const pick = picks[group.category];
      if (
        orig &&
        pick &&
        pick !== orig &&
        selection.element.classList.contains(pick)
      ) {
        selection.element.classList.replace(pick, orig);
      }
    }
  }, [selection, originals, picks]);

  const onResetSelection = useCallback(() => {
    if (!selection) return;
    revertLiveMutations();
    setPicks(originals);
    onApplyDraft(
      upsertOrRemoveOverride(
        applied,
        selection.slideId,
        selection.selector,
        null,
      ),
    );
  }, [selection, originals, revertLiveMutations, applied, onApplyDraft]);

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
    revertLiveMutations();
    onClearDraft();
    onClose();
  }, [revertLiveMutations, onClearDraft, onClose]);

  const toggleSection = useCallback((category: TokenCategory) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  /**
   * Header label = tag + the element's currently-picked color class
   * (preferring color since that's the most identifying mutation; falls
   * back to whatever the first non-null pick is, then just the tag).
   */
  const headerLabel = useMemo(() => {
    if (!selection) return "";
    const colorPick = picks.color ?? null;
    if (colorPick) return buildSelectionLabel(selection.fingerprint, colorPick);
    const firstPick = TAILWIND_TOKENS.map((g) => picks[g.category]).find(
      (p) => p !== null && p !== undefined,
    );
    return buildSelectionLabel(selection.fingerprint, firstPick ?? null);
  }, [selection, picks]);

  const hasDraft = useMemo(() => {
    if (!selection) return false;
    return Boolean(
      findMatchingOverride(applied, selection.slideId, selection.selector),
    );
  }, [applied, selection]);

  const canReset = useMemo(() => {
    if (!selection) return false;
    return TAILWIND_TOKENS.some((g) => {
      const orig = originals[g.category];
      const pick = picks[g.category];
      return Boolean(orig && pick && pick !== orig);
    });
  }, [selection, originals, picks]);

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
              <div className="flex flex-col gap-2">
                {TAILWIND_TOKENS.map((group) => {
                  const orig = originals[group.category];
                  const pick = picks[group.category];
                  const isOpen = openSections.has(group.category);
                  const sectionDirty = Boolean(
                    orig && pick && pick !== orig,
                  );
                  return (
                    <section
                      key={group.category}
                      data-testid={`element-inspector-section-${group.category}`}
                      data-open={isOpen ? "true" : "false"}
                      data-dirty={sectionDirty ? "true" : "false"}
                      className="rounded-md border border-cf-border bg-cf-bg-100"
                    >
                      <button
                        type="button"
                        data-interactive
                        data-testid={`element-inspector-section-toggle-${group.category}`}
                        onClick={() => toggleSection(group.category)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                      >
                        <span className="flex items-center gap-2">
                          <ChevronIcon open={isOpen} />
                          <span className="cf-tag">{group.label}</span>
                          {sectionDirty && (
                            <span
                              aria-hidden="true"
                              className="inline-block h-1.5 w-1.5 rounded-full bg-cf-orange"
                            />
                          )}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-cf-text-subtle">
                          {orig ? (pick === orig ? orig : `${orig} → ${pick}`) : "—"}
                        </span>
                      </button>
                      {isOpen && (
                        <fieldset
                          data-testid={`element-inspector-section-content-${group.category}`}
                          className="flex flex-col gap-2 border-t border-cf-border px-3 py-3"
                        >
                          <p className="text-xs text-cf-text-muted">
                            {orig ? (
                              <>
                                Original:{" "}
                                <code
                                  data-testid={`element-inspector-original-${group.category}`}
                                  className="font-mono"
                                >
                                  {orig}
                                </code>
                              </>
                            ) : (
                              <>
                                This element has no curated{" "}
                                {group.label.toLowerCase()} class.
                              </>
                            )}
                          </p>
                          <ul
                            className="flex flex-col gap-1"
                            data-testid={`element-inspector-token-list-${group.category}`}
                          >
                            {group.classNames.map((cls) => {
                              const checked = pick === cls;
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
                                      data-testid={`element-inspector-token-${cls}`}
                                      name={`token-${group.category}`}
                                      value={cls}
                                      checked={checked}
                                      disabled={!orig}
                                      onChange={() =>
                                        onPick(group.category, cls)
                                      }
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
                    </section>
                  );
                })}
              </div>
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
                disabled={!canReset}
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
