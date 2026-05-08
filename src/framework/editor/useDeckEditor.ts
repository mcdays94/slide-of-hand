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
import type {
  DataDeck,
  DataDeckMeta,
  DataSlide,
} from "@/lib/deck-record";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotKind, SlotValue } from "@/lib/slot-types";
import { templateRegistry } from "@/framework/templates/registry";
import { adminWriteHeaders } from "@/lib/admin-fetch";

export interface SaveResult {
  ok: boolean;
  status?: number;
  error?: string;
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
  /** Mutate one slide identified by `slideId`. Other slides are untouched. */
  updateSlide: (slideId: string, updater: (slide: DataSlide) => DataSlide) => void;
  /** Mutate the deck-level metadata. */
  updateMeta: (updater: (meta: DataDeckMeta) => DataDeckMeta) => void;
  /**
   * Append a new slide built from the given template. The slide's
   * `slots` map is pre-populated with empty defaults for every slot
   * the template declares (required AND optional — empty optional
   * values are harmless on render and the editor needs them present
   * to render the input).
   */
  addSlide: (templateId: string) => void;
  /**
   * Generic escape hatch for transformations the editor doesn't
   * specifically model. Slice 9's filmstrip will use this for
   * add/delete/reorder.
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
      } else {
        const body = (await res.json()) as DataDeck;
        setPersistent(body);
      }
    } catch {
      setPersistent(null);
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
    (templateId: string) => {
      const template = templateRegistry.getById(templateId);
      if (!template) return;
      updateDraft((deck) => {
        const id = nextSlideId(deck.slides);
        const slide = buildEmptySlide(
          template.id,
          id,
          template.slots as Record<string, SlotSpec>,
        );
        return { ...deck, slides: [...deck.slides, slide] };
      });
    },
    [updateDraft],
  );

  const save = useCallback(async (): Promise<SaveResult> => {
    const toSave = draft ?? persistent;
    if (!toSave) {
      return { ok: false, error: "no deck loaded" };
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
        let errorMessage: string | undefined;
        try {
          const body = (await res.json()) as { error?: string };
          errorMessage = body?.error;
        } catch {
          /* not JSON */
        }
        const result: SaveResult = { ok: false, status: res.status };
        if (errorMessage) result.error = errorMessage;
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

  return {
    loading,
    persistent,
    draft: draft ?? persistent,
    isDirty,
    updateSlide,
    updateMeta,
    addSlide,
    updateDraft,
    save,
    reset,
    refetch,
  };
}
