/**
 * Presenter-side type contracts.
 *
 * Slice #5 implements the actual broadcast channel and presenter window; this
 * slice fixes the message shape so #5 and #6 can build against a stable type.
 *
 * The canonical definition lives in `@/framework/viewer/types` so deck-side
 * code can import from a single source. We re-export for ergonomics.
 */

export type { BroadcastMessage } from "@/framework/viewer/types";
