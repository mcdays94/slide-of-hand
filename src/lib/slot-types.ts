/**
 * Slot value types — the data-driven primitive that fills a `SlideTemplate`.
 *
 * Shared between the SPA (slot editors, deck renderer) and the Worker
 * (validating POST bodies for `/api/decks/<slug>`). Zero React, zero DOM,
 * zero Workers binding imports — pure JS-friendly module.
 *
 * v1 covers six kinds: `text`, `richtext`, `image`, `code`, `list`, `stat`.
 * Each value optionally carries a `revealAt` phase index; when present it
 * MUST be a non-negative integer (matches the framework's phase-reveal
 * contract — see `src/framework/viewer/Reveal.tsx`).
 */

export const SLOT_KINDS = [
  "text",
  "richtext",
  "image",
  "code",
  "list",
  "stat",
] as const;

export type SlotKind = (typeof SLOT_KINDS)[number];

/**
 * Tagged-union of all v1 slot values. Pattern-match via `switch (v.kind)`
 * to narrow to a per-kind shape — TypeScript handles the narrowing.
 */
export type SlotValue =
  | { kind: "text"; value: string; revealAt?: number }
  | { kind: "richtext"; value: string; revealAt?: number }
  | { kind: "image"; src: string; alt: string; revealAt?: number }
  | { kind: "code"; lang: string; value: string; revealAt?: number }
  | { kind: "list"; items: string[]; revealAt?: number }
  | { kind: "stat"; value: string; caption?: string; revealAt?: number };

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function isSlotKind(value: unknown): value is SlotKind {
  return (
    typeof value === "string" &&
    (SLOT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Type predicate: `true` if `value` is a well-formed `SlotValue`.
 *
 * Validates required per-kind fields and the optional `revealAt` shape.
 * Does NOT enforce template-level constraints (those live in
 * `validateSlotsAgainstTemplate`).
 */
export function isSlotValue(value: unknown): value is SlotValue {
  return validateSlotValue(value).ok;
}

/**
 * Same as `isSlotValue`, but returns a discriminated `ValidationResult`
 * with a human-readable error string on failure. Mirrors the
 * `validateBeaconBody` shape in `analytics-types.ts` so the Worker can
 * surface the error in 4xx responses.
 */
export function validateSlotValue(value: unknown): ValidationResult<SlotValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "slot value must be an object" };
  }
  const record = value as Record<string, unknown>;
  if (!isSlotKind(record.kind)) {
    return { ok: false, error: `unknown slot kind: ${String(record.kind)}` };
  }

  const revealAtError = checkRevealAt(record.revealAt);
  if (revealAtError) return { ok: false, error: revealAtError };

  switch (record.kind) {
    case "text":
    case "richtext": {
      if (typeof record.value !== "string") {
        return {
          ok: false,
          error: `${record.kind}.value must be a string`,
        };
      }
      return {
        ok: true,
        value: copyOptionalRevealAt(
          { kind: record.kind, value: record.value },
          record.revealAt,
        ),
      };
    }
    case "image": {
      if (typeof record.src !== "string") {
        return { ok: false, error: "image.src must be a string" };
      }
      if (typeof record.alt !== "string") {
        return { ok: false, error: "image.alt must be a string" };
      }
      return {
        ok: true,
        value: copyOptionalRevealAt(
          { kind: "image", src: record.src, alt: record.alt },
          record.revealAt,
        ),
      };
    }
    case "code": {
      if (typeof record.lang !== "string") {
        return { ok: false, error: "code.lang must be a string" };
      }
      if (typeof record.value !== "string") {
        return { ok: false, error: "code.value must be a string" };
      }
      return {
        ok: true,
        value: copyOptionalRevealAt(
          { kind: "code", lang: record.lang, value: record.value },
          record.revealAt,
        ),
      };
    }
    case "list": {
      if (!Array.isArray(record.items)) {
        return { ok: false, error: "list.items must be an array" };
      }
      for (const item of record.items) {
        if (typeof item !== "string") {
          return { ok: false, error: "list.items must be string[]" };
        }
      }
      return {
        ok: true,
        value: copyOptionalRevealAt(
          { kind: "list", items: [...(record.items as string[])] },
          record.revealAt,
        ),
      };
    }
    case "stat": {
      if (typeof record.value !== "string") {
        return { ok: false, error: "stat.value must be a string" };
      }
      if (record.caption !== undefined && typeof record.caption !== "string") {
        return { ok: false, error: "stat.caption must be a string" };
      }
      const base: SlotValue =
        record.caption === undefined
          ? { kind: "stat", value: record.value }
          : { kind: "stat", value: record.value, caption: record.caption };
      return { ok: true, value: copyOptionalRevealAt(base, record.revealAt) };
    }
  }
}

/**
 * Returns an error message, or `null` when the value is acceptable
 * (either omitted entirely or a non-negative finite integer).
 */
function checkRevealAt(input: unknown): string | null {
  if (input === undefined) return null;
  if (typeof input !== "number") {
    return "revealAt must be a number";
  }
  if (!Number.isFinite(input)) {
    return "revealAt must be a finite number";
  }
  if (!Number.isInteger(input)) {
    return "revealAt must be an integer";
  }
  if (input < 0) {
    return "revealAt must be non-negative";
  }
  return null;
}

/**
 * Attaches `revealAt` only when defined, so we never produce an object
 * with an explicit `revealAt: undefined` (which round-trips poorly
 * through JSON.stringify).
 */
function copyOptionalRevealAt(
  base: SlotValue,
  revealAt: unknown,
): SlotValue {
  if (revealAt === undefined) return base;
  return { ...base, revealAt: revealAt as number };
}
