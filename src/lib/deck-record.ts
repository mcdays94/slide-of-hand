/**
 * Data-driven deck record types — the JSON shape the Worker persists in
 * the `DECKS` KV namespace and the SPA hydrates into the renderer.
 *
 * `DataDeck` is the top-level record; it carries a `meta` block (parallels
 * `DeckMeta` from the framework, plus a `visibility` flag) and an array
 * of `DataSlide`s. Each `DataSlide` references a `SlideTemplate` by its
 * stable `id` and supplies the slot values the template consumes.
 *
 * `validateDataDeck` performs SHAPE validation only — it does NOT resolve
 * the template by id or call `validateSlotsAgainstTemplate`. That second
 * pass happens in Slice 4 once the templates are wired up.
 */

import type { Layout } from "@/framework/viewer/types";
import { validateSlotValue, type SlotValue } from "./slot-types";

export type Visibility = "public" | "private";

export interface DataSlide {
  /** Stable kebab-case id, unique within a deck. */
  id: string;
  /** References a `SlideTemplate.id`. Resolved at render time. */
  template: string;
  /** Layout override; falls back to the template's `defaultLayout`. */
  layout?: Layout;
  /** Per-slot values, keyed by the template's slot name. */
  slots: Record<string, SlotValue>;
  /** Speaker notes — plain string here (rich content is per-deck choice). */
  notes?: string;
  /** Skip on render; useful for drafts / parking lot. */
  hidden?: boolean;
}

export interface DataDeckMeta {
  /** kebab-case slug — the `/decks/<slug>` URL segment. */
  slug: string;
  /** Public-facing title shown on the index card + page <title>. */
  title: string;
  /** Optional one-sentence description shown on the index card. */
  description?: string;
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  author?: string;
  event?: string;
  cover?: string;
  /** Total expected runtime, in minutes. Drives presenter timer. */
  runtimeMinutes?: number;
  /** Whether the deck appears on the public index. */
  visibility: Visibility;
}

export interface DataDeck {
  meta: DataDeckMeta;
  slides: DataSlide[];
}

export type DeckValidationResult =
  | { ok: true; value: DataDeck }
  | { ok: false; errors: string[] };

const LAYOUTS: readonly Layout[] = [
  "cover",
  "section",
  "default",
  "full",
] as const;
const VISIBILITIES: readonly Visibility[] = ["public", "private"] as const;
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const ID_REGEX = SLUG_REGEX;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate the full deck record shape. Returns a typed `DataDeck` on
 * success or a `string[]` of errors on failure. Mirrors the
 * `validateBeaconBody` / `validateThemeBody` pattern.
 *
 * Does NOT validate slot values against template specs — call
 * `validateSlotsAgainstTemplate` separately once the deck's templates
 * are resolved.
 */
export function validateDataDeck(input: unknown): DeckValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["deck must be an object"] };
  }
  const record = input as Record<string, unknown>;

  // ── meta ───────────────────────────────────────────────────────────
  const meta = record.meta;
  let validatedMeta: DataDeckMeta | null = null;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    errors.push("meta must be an object");
  } else {
    validatedMeta = validateMeta(meta as Record<string, unknown>, errors);
  }

  // ── slides ─────────────────────────────────────────────────────────
  const slides = record.slides;
  let validatedSlides: DataSlide[] | null = null;
  if (!Array.isArray(slides)) {
    errors.push("slides must be an array");
  } else {
    validatedSlides = validateSlidesArray(slides, errors);
  }

  if (errors.length > 0 || !validatedMeta || !validatedSlides) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { meta: validatedMeta, slides: validatedSlides },
  };
}

function validateMeta(
  meta: Record<string, unknown>,
  errors: string[],
): DataDeckMeta | null {
  const startCount = errors.length;

  const slug = meta.slug;
  if (typeof slug !== "string" || !isValidSlug(slug)) {
    errors.push("meta.slug must be a kebab-case string");
  }

  const title = meta.title;
  if (typeof title !== "string" || title.length === 0) {
    errors.push("meta.title must be a non-empty string");
  }

  const date = meta.date;
  if (typeof date !== "string" || !ISO_DATE_REGEX.test(date)) {
    errors.push("meta.date must be an ISO date string (YYYY-MM-DD)");
  }

  const visibility = meta.visibility;
  if (
    typeof visibility !== "string" ||
    !(VISIBILITIES as readonly string[]).includes(visibility)
  ) {
    errors.push('meta.visibility must be "public" or "private"');
  }

  if (
    meta.description !== undefined &&
    typeof meta.description !== "string"
  ) {
    errors.push("meta.description must be a string when present");
  }
  if (meta.author !== undefined && typeof meta.author !== "string") {
    errors.push("meta.author must be a string when present");
  }
  if (meta.event !== undefined && typeof meta.event !== "string") {
    errors.push("meta.event must be a string when present");
  }
  if (meta.cover !== undefined && typeof meta.cover !== "string") {
    errors.push("meta.cover must be a string when present");
  }
  if (meta.runtimeMinutes !== undefined) {
    const rm = meta.runtimeMinutes;
    if (
      typeof rm !== "number" ||
      !Number.isFinite(rm) ||
      !Number.isInteger(rm) ||
      rm < 0
    ) {
      errors.push(
        "meta.runtimeMinutes must be a non-negative integer when present",
      );
    }
  }

  if (errors.length > startCount) return null;

  // Construct the typed object only when all checks passed.
  const out: DataDeckMeta = {
    slug: slug as string,
    title: title as string,
    date: date as string,
    visibility: visibility as Visibility,
  };
  if (typeof meta.description === "string") out.description = meta.description;
  if (typeof meta.author === "string") out.author = meta.author;
  if (typeof meta.event === "string") out.event = meta.event;
  if (typeof meta.cover === "string") out.cover = meta.cover;
  if (typeof meta.runtimeMinutes === "number") {
    out.runtimeMinutes = meta.runtimeMinutes;
  }
  return out;
}

function validateSlidesArray(
  slides: unknown[],
  errors: string[],
): DataSlide[] | null {
  const seenIds = new Set<string>();
  const validated: DataSlide[] = [];
  let allOk = true;

  slides.forEach((raw, index) => {
    const slide = validateSlide(raw, index, errors);
    if (!slide) {
      allOk = false;
      return;
    }
    if (seenIds.has(slide.id)) {
      errors.push(`slides[${index}]: duplicate id "${slide.id}"`);
      allOk = false;
      return;
    }
    seenIds.add(slide.id);
    validated.push(slide);
  });

  return allOk ? validated : null;
}

function validateSlide(
  raw: unknown,
  index: number,
  errors: string[],
): DataSlide | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`slides[${index}] must be an object`);
    return null;
  }
  const startCount = errors.length;
  const record = raw as Record<string, unknown>;

  const id = record.id;
  if (typeof id !== "string" || !isValidId(id)) {
    errors.push(`slides[${index}].id must be a kebab-case string`);
  }

  const template = record.template;
  if (typeof template !== "string" || template.length === 0) {
    errors.push(`slides[${index}].template must be a non-empty string`);
  }

  const slots = record.slots;
  let validatedSlots: Record<string, SlotValue> = {};
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
    errors.push(`slides[${index}].slots must be an object`);
  } else {
    const slotEntries = Object.entries(slots as Record<string, unknown>);
    for (const [name, value] of slotEntries) {
      const result = validateSlotValue(value);
      if (!result.ok) {
        errors.push(`slides[${index}].slots.${name}: ${result.error}`);
        continue;
      }
      validatedSlots[name] = result.value;
    }
  }

  if (record.layout !== undefined) {
    if (
      typeof record.layout !== "string" ||
      !(LAYOUTS as readonly string[]).includes(record.layout)
    ) {
      errors.push(
        `slides[${index}].layout must be one of ${LAYOUTS.join("|")}`,
      );
    }
  }

  if (record.notes !== undefined && typeof record.notes !== "string") {
    errors.push(`slides[${index}].notes must be a string when present`);
  }

  if (record.hidden !== undefined && typeof record.hidden !== "boolean") {
    errors.push(`slides[${index}].hidden must be a boolean when present`);
  }

  if (errors.length > startCount) return null;

  const out: DataSlide = {
    id: id as string,
    template: template as string,
    slots: validatedSlots,
  };
  if (typeof record.layout === "string") out.layout = record.layout as Layout;
  if (typeof record.notes === "string") out.notes = record.notes;
  if (typeof record.hidden === "boolean") out.hidden = record.hidden;
  return out;
}

function isValidSlug(value: string): boolean {
  if (value.length === 0 || value.length > 80) return false;
  if (value.includes("..")) return false;
  return SLUG_REGEX.test(value);
}

function isValidId(value: string): boolean {
  if (value.length === 0 || value.length > 80) return false;
  if (value.includes("..")) return false;
  return ID_REGEX.test(value);
}
