/**
 * Slide template types — the static, code-defined templates a deck author
 * picks from when adding a slide. v1 ships a small library of templates
 * (rendered in Slice 4); this module is the shared type surface that
 * enables both the slot editors (frontend) and the data-deck validator
 * (Worker on POST) to introspect a template's slot specs.
 *
 * The generic shape `SlideTemplate<TSlots>` lets callers parameterize
 * over the slot keys + per-key `SlotKind`, so a template literal type
 * can encode "this template has a `title: 'text'` slot and a
 * `body: 'richtext'` slot" without any extra machinery.
 *
 * No React imports here either — `render` returns a `ReactNode` from
 * the type-only `import`. That keeps this module Worker-safe.
 */

import type { ReactNode } from "react";
import type { Layout } from "@/framework/viewer/types";
import {
  SLOT_KINDS,
  validateSlotValue,
  type SlotKind,
  type SlotValue,
} from "./slot-types";

// Re-export so downstream code can pull `Layout` from the same module
// instead of reaching into `@/framework/viewer/types` directly.
export type { Layout };

/**
 * A single slot's spec — what the editor renders, plus the runtime
 * constraints applied by `validateSlotsAgainstTemplate`.
 */
export interface SlotSpec {
  /** Discriminator for the slot value editor. */
  kind: SlotKind;
  /** Human-readable label for the slot editor. */
  label: string;
  /** Optional helper text shown beneath the editor. */
  description?: string;
  /** Whether a value MUST be present for the slide to validate. */
  required: boolean;
  /**
   * Max length for `text` / `richtext` / `code.value` / `stat.value`.
   * Ignored for `image` and `list` (where it would be ambiguous).
   */
  maxLength?: number;
  /** Optional placeholder for the editor input. */
  placeholder?: string;
}

/**
 * Resolved slot values for a given template's `TSlots` shape — required
 * keys map to a `SlotValue` of the matching kind. Optional slots remain
 * potentially `undefined`, but at runtime the renderer typically gates
 * on `slots[name]` truthy.
 *
 * v0.1 simplification: every slot key is required at the type level;
 * the `required: false` flag is enforced at runtime via the validator.
 * Slice 4 may revisit this if the type-level optionality matters for
 * the renderer.
 */
export type ResolvedSlots<TSlots extends Record<string, SlotKind>> = {
  [K in keyof TSlots]: Extract<SlotValue, { kind: TSlots[K] }>;
};

export interface SlideTemplate<TSlots extends Record<string, SlotKind>> {
  /** Stable kebab-case id — references this template from a `DataSlide`. */
  id: string;
  /** Human-readable label shown in the "add slide" picker. */
  label: string;
  /** One-sentence description shown alongside the label. */
  description: string;
  /** Layout hint applied by default when a slide picks this template. */
  defaultLayout?: Layout;
  /** Per-key slot spec, narrowed to the per-key `SlotKind`. */
  slots: { [K in keyof TSlots]: SlotSpec & { kind: TSlots[K] } };
  /** Render function — receives resolved slot values, returns a `ReactNode`. */
  render: (props: { slots: ResolvedSlots<TSlots> }) => ReactNode;
}

export type SlotsValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Confirm that `slots` (a `Record<string, SlotValue>` keyed by template
 * slot name) satisfies the template's spec. Returns a list of errors,
 * not just the first one — the editor surfaces every failing field at
 * once, and the Worker echoes the same list in 4xx responses.
 *
 * Checks performed:
 *  1. Every required slot has a value.
 *  2. No extra slot keys beyond those declared on the template.
 *  3. Each value validates as a `SlotValue` (delegated to
 *     `validateSlotValue`).
 *  4. Each value's `kind` matches the spec's `kind`.
 *  5. `maxLength` is enforced for text/richtext/code/stat string fields
 *     when the spec defines it.
 */
/**
 * Lightweight shape accepted by `validateSlotsAgainstTemplate` — only
 * the `slots` map is needed for runtime checks. Defined as a separate
 * type (rather than `SlideTemplate<Record<string, SlotKind>>`) so the
 * function accepts narrower `SlideTemplate<{ title: "text" }>` values
 * without tripping over the contravariant `render` parameter.
 */
export interface SlotSpecsContainer {
  slots: Record<string, SlotSpec>;
}

export function validateSlotsAgainstTemplate(
  slots: Record<string, SlotValue>,
  template: SlotSpecsContainer,
): SlotsValidationResult {
  const errors: string[] = [];

  if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
    return { ok: false, errors: ["slots must be an object"] };
  }

  const specEntries = Object.entries(template.slots);
  const specNames = new Set(specEntries.map(([name]) => name));

  // 1. Required slots present + per-slot validation.
  for (const [name, spec] of specEntries) {
    const value = slots[name];

    if (value === undefined) {
      if (spec.required) {
        errors.push(`slot "${name}" is required`);
      }
      continue;
    }

    const result = validateSlotValue(value);
    if (!result.ok) {
      errors.push(`slot "${name}": ${result.error}`);
      continue;
    }

    const sv = result.value;
    if (sv.kind !== spec.kind) {
      errors.push(
        `slot "${name}": kind "${sv.kind}" does not match template kind "${spec.kind}"`,
      );
      continue;
    }

    if (spec.maxLength !== undefined) {
      const lengthError = checkMaxLength(name, sv, spec.maxLength);
      if (lengthError) errors.push(lengthError);
    }
  }

  // 2. Reject extra slots.
  for (const name of Object.keys(slots)) {
    if (!specNames.has(name)) {
      errors.push(`unknown slot "${name}"`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Returns an error message, or `null` when the value is within bounds
 * (or the kind has no measurable string field).
 *
 * Ignored kinds: `image` (paths/alts; bound them via spec UI instead),
 * `list` (per-item caps would need their own field).
 */
function checkMaxLength(
  name: string,
  value: SlotValue,
  max: number,
): string | null {
  let measured: string | null = null;
  switch (value.kind) {
    case "text":
    case "richtext":
      measured = value.value;
      break;
    case "code":
      measured = value.value;
      break;
    case "stat":
      measured = value.value;
      break;
    case "image":
    case "list":
      return null;
  }
  if (measured !== null && measured.length > max) {
    return `slot "${name}": value exceeds maxLength ${max}`;
  }
  return null;
}

// Re-export for downstream Slice 4 code that wants the constants alongside.
export { SLOT_KINDS };
