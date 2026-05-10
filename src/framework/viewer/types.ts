/**
 * Public framework contracts.
 *
 * These shapes are the deck-author-facing API and they are also consumed by
 * downstream slices (presenter window, deck index, admin Studio). Keep them
 * stable; AGENTS.md is the authoritative spec.
 */

import type { ReactNode } from "react";

export type Layout = "cover" | "section" | "default" | "full";

export interface SlideDef {
  /** Stable kebab-case id. Used in URL fragments + analytics. */
  id: string;
  /** Optional title — shown in chrome header + overview thumbnail. */
  title?: string;
  /** Layout mode. */
  layout?: Layout;
  /** Uppercase mono kicker (e.g. "LIVE DEMO"). */
  sectionLabel?: string;
  /** Section number rendered next to label (e.g. "05"). */
  sectionNumber?: string;
  /** Number of additional phase reveals before advancing to the next slide. */
  phases?: number;
  /** Optional speaker notes — rendered in the presenter window only. */
  notes?: ReactNode;
  /** Skip this slide entirely (drafts, parking lot, removed-but-not-deleted). */
  hidden?: boolean;
  /** Expected duration on this slide. Drives presenter pacing feedback. */
  runtimeSeconds?: number;
  /** Render function. Receives the current phase. */
  render: (props: { phase: number }) => ReactNode;
}

export interface DeckMeta {
  /** Stable kebab-case slug. Matches the folder name; used in URL path. */
  slug: string;
  /** Public-facing title — shown on the index page + page <title>. */
  title: string;
  /** Optional one-sentence description. When present, shown on the index card. */
  description?: string;
  /** ISO date string (YYYY-MM-DD). Used for sort + display on index. */
  date: string;
  /** Author name(s). */
  author?: string;
  /** Optional venue / event tag (e.g. "DTX Manchester 2026"). */
  event?: string;
  /** Cover image path (relative to /public). */
  cover?: string;
  /** Categorization hook for future filtering on the index. */
  tags?: string[];
  /** Total expected talk runtime, in minutes. Drives presenter timer. */
  runtimeMinutes?: number;
}

export interface Deck {
  meta: DeckMeta;
  slides: SlideDef[];
}

/**
 * BroadcastChannel message contract between the viewer and presenter window.
 *
 * Slice #5 implements the actual channel (`framework/presenter/broadcast.ts`);
 * this slice only fixes the type so multiple downstream slices can wire up
 * against it without churn.
 */
export type BroadcastMessage =
  | { type: "state"; slide: number; phase: number; deckSlug: string }
  | { type: "request-state" }
  | { type: "navigate"; slide: number; phase: number }
  | { type: "tool"; tool: "laser" | "magnifier" | "marker" | null }
  /**
   * Item F (#111): real-time cursor sync from the presenter window's
   * scoped tool panel to the audience deck. Coordinates are normalized
   * to the active tool-scope's bounding rect (0..1 in both axes); the
   * audience window maps them back to its own slide rect (which may be
   * a different size). Sent at ~30Hz when a tool is active.
   *
   * Legacy `tool-cursor` messages with raw viewport pixels are still
   * emitted for back-compat; consumers prefer this normalized variant.
   */
  | {
      type: "cursor";
      tool: "laser" | "magnifier" | "marker";
      x: number;
      y: number;
    };
