/**
 * `useDeckEditor(slug)` — the central state hook for the deck editor.
 *
 * Owns:
 *   - The persistent state (last-saved DataDeck, fetched from
 *     `/api/decks/<slug>`).
 *   - The draft state (in-memory edits since the last save).
 *   - The save lifecycle (POST + refetch + clear draft).
 *
 * Components in `src/framework/editor/*` MUST go through this hook for
 * the deck-being-edited — they never call `useDataDeck` or `fetch`
 * directly. The discipline matters: it gives us a single seam for
 * future concerns (auto-save, conflict detection, undo/redo).
 *
 * State machine (mirrors `useElementOverrides`):
 *
 *      load → record  → persistent = record;  draft = null  (clean)
 *      load → 404     → persistent = null;    draft = null  (no-op)
 *
 *      updateSlide / updateMeta / addSlide:
 *        draft starts at `persistent` (one-shot clone) and accumulates edits.
 *        After this point `isDirty === true`.
 *
 *      reset(): drop the draft; the editor reverts to persistent.
 *      save(): POST `draft`, refetch, clear draft.
 *
 * The Slice 9 worker will add `removeSlide` / `reorderSlides`. They can
 * compose on top of the `updateDraft(updater)` escape hatch we expose
 * here without changing the public contract.
 */

import { useCallback, useEffect, useState } from "react";
import {
  validateDataDeck,
  type DataDeck,
  type DataDeckMeta,
  type DataSlide,
} from "@/lib/deck-record";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotKind, SlotValue } from "@/lib/slot-types";
import { templateRegistry } from "@/framework/templates/registry";
import { adminWriteHeaders } from "@/lib/admin-fetch";

export interface SaveResult {
  ok: boolean;
  status?: number;
  error?: string;
  /**
   * Validation errors to surface inline in the editor's banner. Populated
   * from one of two sources:
   *   1. Frontend `validateDataDeck` failure — the POST is NOT sent.
   *   2. Server-side validation failure (issue #93) — POST returns 400
   *      with `{ error, errors[] }`. We capture every entry from
   *      `errors[]` (with `error` as a back-compat fallback for legacy
   *      responses that omit the array).
   */
  validationErrors?: string[];
}

export interface UseDeckEditor {
  /** True until the first fetch resolves. */
  loading: boolean;
  /** The last-saved record, or null while loading / on 404. */
  persistent: DataDeck | null;
  /** The current working state — equals `persistent` when no edits. */
  draft: DataDeck | null;
  /** True iff `draft` has diverged from `persistent`. */
  isDirty: boolean;
  /**
   * The id of the slide currently focused in the editor. Tracked here
   * (rather than in `EditMode`'s local state) so reordering / deletion
   * can adjust selection coherently — local-index state would silently
   * point at the wrong slide after a reorder.
   *
   * `null` when the deck has no slides; otherwise always references an
   * existing slide id.
   */
  activeSlideId: string | null;
  /** Mutate one slide identified by `slideId`. Other slides are untouched. */
  updateSlide: (slideId: string, updater: (slide: DataSlide) => DataSlide) => void;
  /** Mutate the deck-level metadata. */
  updateMeta: (updater: (meta: DataDeckMeta) => DataDeckMeta) => void;
  /**
   * Insert a new slide built from the given template. The slide's
   * `slots` map is pre-populated with empty defaults for every slot
   * the template declares (required AND optional — empty optional
   * values are harmless on render and the editor needs them present
   * to render the input).
   *
   * If `afterIndex` is supplied, the new slide is inserted at
   * `afterIndex + 1`; otherwise it appends to the end. Either way, the
   * new slide becomes the `activeSlideId`.
   */
  addSlide: (templateId: string, afterIndex?: number) => void;
  /**
   * Remove the slide with the given id. No-op if the id is unknown.
   * If the deleted slide was active, `activeSlideId` shifts to the
   * neighbour (next slide if available, otherwise the previous).
   */
  deleteSlide: (slideId: string) => void;
  /**
   * Insert a deep copy of the slide right after the source. The copy
   * gets a fresh `slide-N` id and becomes the active slide.
   */
  duplicateSlide: (slideId: string) => void;
  /**
   * Move the slide at `from` to position `to` in the slides array. Both
   * indices are zero-based and clamped to the array bounds; out-of-range
   * inputs are no-ops.
   */
  reorderSlides: (from: number, to: number) => void;
  /**
   * Switch the focused slide in the editor. The id MUST exist in the
   * current draft; passing an unknown id is a no-op.
   */
  setActiveSlide: (slideId: string) => void;
  /**
   * Generic escape hatch for transformations the editor doesn't
   * specifically model. The typed methods above (`addSlide`,
   * `deleteSlide`, …) are layered on top of this.
   */
  updateDraft: (updater: (deck: DataDeck) => DataDeck) => void;
  /** POST the current draft to KV; on success refetch + clear draft. */
  save: () => Promise<SaveResult>;
  /** Drop the draft so subsequent reads return `persistent`. */
  reset: () => void;
  /** Re-fetch from the read endpoint. */
  refetch: () => Promise<void>;
}

/**
 * Build an empty default `SlotValue` for a given slot kind. Used by
 * `addSlide` to populate the new slide's slot map.
 *
 * Ergonomics over correctness: optional slots that aren't required
 * don't strictly need an empty default — render-time validation only
 * checks required slots — but pre-populating means the editor can
 * always render an input for every slot the template declares without
 * a "click to add this slot" affordance.
 */
function emptySlotValue(kind: SlotKind): SlotValue {
  switch (kind) {
    case "text":
      return { kind: "text", value: "" };
    case "richtext":
      return { kind: "richtext", value: "" };
    case "image":
      return { kind: "image", src: "", alt: "" };
    case "code":
      return { kind: "code", lang: "ts", value: "" };
    case "list":
      return { kind: "list", items: [] };
    case "stat":
      return { kind: "stat", value: "" };
    default: {
      // Exhaustiveness guard — TypeScript should narrow `kind` to
      // `never` here. If a future SlotKind lands without a branch,
      // this surfaces it loudly at compile time AND runtime.
      const exhaustive: never = kind;
      throw new Error(`Unhandled slot kind: ${exhaustive as string}`);
    }
  }
}

/**
 * Generate a kebab-case slide id unique within `slides`. Uses
 * `slide-N` where N is one greater than the max existing
 * `slide-N` index (and falls back to `slide-1` for an empty deck).
 *
 * Deterministic so two parallel `addSlide` calls produce
 * differently-numbered ids without coordinating.
 */
export function nextSlideId(slides: DataSlide[]): string {
  let max = 0;
  for (const s of slides) {
    const m = /^slide-(\d+)$/.exec(s.id);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `slide-${max + 1}`;
}

/**
 * Build a fresh `DataSlide` from a template. Exported for tests +
 * the new-deck modal (which optionally seeds a first slide).
 */
export function buildEmptySlide(
  templateId: string,
  slideId: string,
  slots: Record<string, SlotSpec>,
): DataSlide {
  const slotValues: Record<string, SlotValue> = {};
  for (const [name, spec] of Object.entries(slots)) {
    slotValues[name] = emptySlotValue(spec.kind);
  }
  return {
    id: slideId,
    template: templateId,
    slots: slotValues,
  };
}

export function useDeckEditor(slug: string): UseDeckEditor {
  const [persistent, setPersistent] = useState<DataDeck | null>(null);
  const [draft, setDraft] = useState<DataDeck | null>(null);
  const [loading, setLoading] = useState(slug.length > 0);
  // `null` = no selection (deck unloaded / empty). When the deck loads
  // we default to the first slide. CRUD ops adjust this so it always
  // points at a valid id.
  const [activeSlideId, setActiveSlideIdState] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!slug) {
      setPersistent(null);
      setDraft(null);
      setLoading(false);
      return;
    }
    // Read from the admin endpoint so private decks are visible. The
    // public `/api/decks/<slug>` filters them out as 404 for safety.
    // Access gates the endpoint at the edge in production; in dev,
    // `adminWriteHeaders()` injects the placeholder auth header.
    const url = `/api/admin/decks/${encodeURIComponent(slug)}`;
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: adminWriteHeaders(),
      });
      if (!res.ok) {
        setPersistent(null);
        setActiveSlideIdState(null);
      } else {
        const body = (await res.json()) as DataDeck;
        setPersistent(body);
        // Seed (or refresh) the active slide so it always points at an
        // id that actually exists in the new persistent record.
        setActiveSlideIdState((curr) => {
          if (curr && body.slides.some((s) => s.id === curr)) return curr;
          return body.slides[0]?.id ?? null;
        });
      }
    } catch {
      setPersistent(null);
      setActiveSlideIdState(null);
    } finally {
      setLoading(false);
      // Successful refetch clears the draft — the new persistent IS the
      // canonical state. Callers that need to keep editing across a
      // save can re-derive their local input state from `draft`.
      setDraft(null);
    }
  }, [slug]);

  useEffect(() => {
    setLoading(slug.length > 0);
    void refetch();
  }, [refetch, slug]);

  const updateDraft = useCallback(
    (updater: (deck: DataDeck) => DataDeck) => {
      setDraft((curr) => {
        const base = curr ?? persistent;
        if (!base) return curr;
        return updater(base);
      });
    },
    [persistent],
  );

  const updateSlide = useCallback(
    (slideId: string, updater: (slide: DataSlide) => DataSlide) => {
      updateDraft((deck) => ({
        ...deck,
        slides: deck.slides.map((s) => (s.id === slideId ? updater(s) : s)),
      }));
    },
    [updateDraft],
  );

  const updateMeta = useCallback(
    (updater: (meta: DataDeckMeta) => DataDeckMeta) => {
      updateDraft((deck) => ({ ...deck, meta: updater(deck.meta) }));
    },
    [updateDraft],
  );

  const addSlide = useCallback(
    (templateId: string, afterIndex?: number) => {
      const template = templateRegistry.getById(templateId);
      if (!template) return;
      const base = draft ?? persistent;
      if (!base) return;
      // Compute the new id off the current slides snapshot so we can
      // reliably set `activeSlideId` *outside* the `setDraft` updater
      // (the updater may run asynchronously when React batches).
      const id = nextSlideId(base.slides);
      const slide = buildEmptySlide(
        template.id,
        id,
        template.slots as Record<string, SlotSpec>,
      );
      updateDraft((deck) => {
        const insertAt =
          typeof afterIndex === "number" &&
          afterIndex >= 0 &&
          afterIndex < deck.slides.length
            ? afterIndex + 1
            : deck.slides.length;
        return {
          ...deck,
          slides: [
            ...deck.slides.slice(0, insertAt),
            slide,
            ...deck.slides.slice(insertAt),
          ],
        };
      });
      setActiveSlideIdState(id);
    },
    [draft, persistent, updateDraft],
  );

  const deleteSlide = useCallback(
    (slideId: string) => {
      // Pre-compute the next active id off the current state so callers
      // that delete the focused slide get a sensible neighbour. We rely
      // on `draft ?? persistent` since that's the source-of-truth the
      // updater is about to mutate.
      const base = draft ?? persistent;
      if (!base) return;
      const idx = base.slides.findIndex((s) => s.id === slideId);
      if (idx < 0) return;
      const nextActive =
        activeSlideId === slideId
          ? base.slides[idx + 1]?.id ?? base.slides[idx - 1]?.id ?? null
          : activeSlideId;
      updateDraft((deck) => {
        const filtered = deck.slides.filter((s) => s.id !== slideId);
        if (filtered.length === deck.slides.length) return deck;
        return { ...deck, slides: filtered };
      });
      setActiveSlideIdState(nextActive);
    },
    [draft, persistent, activeSlideId, updateDraft],
  );

  const duplicateSlide = useCallback(
    (slideId: string) => {
      const base = draft ?? persistent;
      if (!base) return;
      const idx = base.slides.findIndex((s) => s.id === slideId);
      if (idx < 0) return;
      const id = nextSlideId(base.slides);
      // Deep-clone the slide via JSON round-trip. Slot values are
      // plain JSON (strings, numbers, arrays of primitives) so this
      // is safe and side-effect-free.
      const cloned: DataSlide = JSON.parse(JSON.stringify(base.slides[idx]));
      cloned.id = id;
      updateDraft((deck) => {
        // Use the live index — the deck might have been mutated
        // between the time we computed `idx` and the time React
        // commits the update.
        const liveIdx = deck.slides.findIndex((s) => s.id === slideId);
        if (liveIdx < 0) return deck;
        return {
          ...deck,
          slides: [
            ...deck.slides.slice(0, liveIdx + 1),
            cloned,
            ...deck.slides.slice(liveIdx + 1),
          ],
        };
      });
      setActiveSlideIdState(id);
    },
    [draft, persistent, updateDraft],
  );

  const reorderSlides = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      updateDraft((deck) => {
        const len = deck.slides.length;
        if (from < 0 || from >= len) return deck;
        if (to < 0 || to >= len) return deck;
        const next = deck.slides.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return { ...deck, slides: next };
      });
    },
    [updateDraft],
  );

  const setActiveSlide = useCallback(
    (slideId: string) => {
      const base = draft ?? persistent;
      if (!base) return;
      if (!base.slides.some((s) => s.id === slideId)) return;
      setActiveSlideIdState(slideId);
    },
    [draft, persistent],
  );

  const save = useCallback(async (): Promise<SaveResult> => {
    const toSave = draft ?? persistent;
    if (!toSave) {
      return { ok: false, error: "no deck loaded" };
    }
    // Run frontend shape-validation BEFORE the POST. The Worker has its
    // own validator (parked debt #57 — currently inline in
    // `worker/decks.ts`); this gate stops the round-trip so the editor
    // can surface specific errors immediately.
    const validation = validateDataDeck(toSave);
    if (!validation.ok) {
      return {
        ok: false,
        error: "validation failed",
        validationErrors: validation.errors,
      };
    }
    try {
      const res = await fetch(
        `/api/admin/decks/${encodeURIComponent(slug)}`,
        {
          method: "POST",
          headers: adminWriteHeaders(),
          body: JSON.stringify(toSave),
        },
      );
      if (!res.ok) {
        // Issue #93: the server may now return a full `errors[]` array
        // alongside the legacy singular `error`. Capture both so the
        // editor's banner can render every entry; fall back to `error`
        // for older responses (defensive — a deployed client may briefly
        // outlive a deployed worker, or vice versa).
        let errorMessage: string | undefined;
        let validationErrors: string[] | undefined;
        try {
          const body = (await res.json()) as {
            error?: string;
            errors?: unknown;
          };
          errorMessage = body?.error;
          if (
            Array.isArray(body?.errors) &&
            body.errors.every((e) => typeof e === "string")
          ) {
            validationErrors = body.errors as string[];
          }
        } catch {
          /* not JSON */
        }
        const result: SaveResult = { ok: false, status: res.status };
        if (errorMessage) result.error = errorMessage;
        if (validationErrors && validationErrors.length > 0) {
          result.validationErrors = validationErrors;
        }
        return result;
      }
      await refetch();
      return { ok: true, status: res.status };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "network error",
      };
    }
  }, [draft, persistent, slug, refetch]);

  const reset = useCallback(() => {
    setDraft(null);
  }, []);

  // `isDirty` is a structural compare. JSON.stringify is plenty fast for
  // a single deck record (KB-scale at worst) and avoids dragging in a
  // deep-equal dependency just for this.
  const isDirty =
    draft !== null &&
    persistent !== null &&
    JSON.stringify(draft) !== JSON.stringify(persistent);

  // Warn the user before navigating away while there are unsaved changes.
  // Browsers show a generic prompt — `returnValue` text is largely
  // ignored in modern Chrome/Firefox/Safari but still required for the
  // dialog to appear. The listener is only attached while dirty so a
  // clean editor doesn't intercept normal navigations.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Some browsers still read `returnValue`; provide a neutral
      // string. The user-facing copy is ultimately browser-controlled.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  return {
    loading,
    persistent,
    draft: draft ?? persistent,
    isDirty,
    activeSlideId,
    updateSlide,
    updateMeta,
    addSlide,
    deleteSlide,
    duplicateSlide,
    reorderSlides,
    setActiveSlide,
    updateDraft,
    save,
    reset,
    refetch,
  };
}
