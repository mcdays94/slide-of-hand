/**
 * Public template types — re-exported from `@/lib/template-types` for nicer
 * imports inside the templates tree itself (`@/framework/templates/types`).
 *
 * The pure-JS / Worker-safe types live in `@/lib/template-types` (no React
 * imports there). This file keeps the framework-side imports short:
 *
 *   import type { SlideTemplate, SlotSpec } from "@/framework/templates/types";
 *
 * No new types are introduced here.
 */

export type {
  SlideTemplate,
  SlotSpec,
  ResolvedSlots,
  SlotsValidationResult,
  SlotSpecsContainer,
  Layout,
} from "@/lib/template-types";

export {
  validateSlotsAgainstTemplate,
  SLOT_KINDS,
} from "@/lib/template-types";

export type { SlotKind, SlotValue } from "@/lib/slot-types";
