/**
 * `<DeckCardGrid>` — unified deck list renderer (issue #127).
 *
 * Used by BOTH the public homepage (`/`) and the Studio admin index
 * (`/admin`). The grid:
 *
 *   - Reads / writes view mode (`grid` | `list`) from
 *     `useViewPreference(surface)`. Each surface gets its own
 *     localStorage slot so the homepage and Studio remember
 *     independently.
 *   - Renders a Grid / List segmented control above the list. The
 *     active option is highlighted with the orange-accent fill, same
 *     visual language as `<SettingsSegmentedRow>` in the viewer.
 *   - Composes `<DeckCard>` for each item. The card receives the
 *     current view mode (so it adapts its layout) plus any optional
 *     admin slots (visibility badge, IDE link, delete callback) the
 *     parent wired in.
 *   - Renders a parent-supplied `emptyState` when `items` is empty.
 *
 * Surface contract:
 *   - `public` surface never passes `onDelete`. Cards never carry a
 *     visibility badge (the public list never sees private decks).
 *   - `admin` surface MAY pass `onDelete`, in which case items
 *     declared `canDelete: true` get a hover-revealed trashcan. Source
 *     decks (with `canDelete: false`) silently render no trashcan —
 *     they live in code and cannot be deleted via the runtime UI.
 */

import type { ReactNode } from "react";
import type { DeckMeta } from "@/framework/viewer/types";
import {
  useViewPreference,
  type Surface,
} from "@/lib/use-view-preference";
import { useSettings } from "@/framework/viewer/useSettings";
import {
  DeckCard,
  type DeckCardPending,
  type DeckCardVisibility,
} from "./DeckCard";

export interface DeckCardGridItem {
  meta: DeckMeta;
  /** Link target for the card's main click area. */
  to: string;
  /** Optional visibility — admin renders a `private` badge, public omits the chip. */
  visibility?: DeckCardVisibility;
  /**
   * Whether THIS item is deletable from the runtime UI. Source decks
   * may not have a delete backend wired today; KV-backed decks do.
   * The grid only renders a Delete menu item when both `canDelete` is
   * true AND the parent wired up `onDelete`.
   */
  canDelete?: boolean;
  /**
   * Whether THIS item is archivable from the runtime UI. Issue #244
   * exposes Archive on active cards. Later slices wire the source vs
   * KV backends — this flag is the per-row gate.
   */
  canArchive?: boolean;
  /**
   * Whether THIS item can be restored from the runtime UI. Only
   * meaningful on archived cards. Gated independently from
   * `canArchive` so a deck's restore backend can land in a different
   * slice than its archive backend.
   */
  canRestore?: boolean;
  /** Optional "Open in IDE" link target for source decks (admin / dev only). */
  ideHref?: string;
  /**
   * Pending source action overlay (issue #246). When set the card
   * renders a Pending pill linking to the open GitHub PR plus an
   * optional Clear pending button. Only meaningful for source-backed
   * decks — the parent (AdminIndex) is the projection gate.
   */
  pending?: DeckCardPending;
}

export interface DeckCardGridProps {
  /** Which surface this grid lives on. Drives the view-preference key. */
  surface: Surface;
  items: DeckCardGridItem[];
  /** Rendered when `items` is empty. */
  emptyState?: ReactNode;
  /**
   * Admin-only delete callback. When provided, items with
   * `canDelete: true` render a Delete menu item that, on confirm via
   * the typed-slug dialog, invokes this callback with the deck slug.
   * The callback owns the side effect (DELETE + reload) and may throw
   * to surface an inline error in the dialog.
   */
  onDelete?: (slug: string) => Promise<void> | void;
  /**
   * Admin-only archive callback. Items with `canArchive: true` and an
   * active lifecycle render an Archive menu item that, on confirm via
   * a simple `<ConfirmDialog>`, invokes this callback with the deck
   * slug. Issue #244 introduces this as UI-only — later slices wire
   * the real KV / source backends.
   */
  onArchive?: (slug: string) => Promise<void> | void;
  /**
   * Admin-only restore callback. Mirrors `onArchive` but only renders
   * on archived cards via the Restore menu item.
   */
  onRestore?: (slug: string) => Promise<void> | void;
}

export function DeckCardGrid({
  surface,
  items,
  emptyState,
  onDelete,
  onArchive,
  onRestore,
}: DeckCardGridProps) {
  const { mode, setMode } = useViewPreference(surface);
  const { settings } = useSettings();
  // Hover-preview is a global setting (issue #128) — it lives in the
  // viewer settings store so it propagates to BOTH surfaces (public
  // homepage + admin) without each surface needing to know. The card
  // itself is the gatekeeper for list-mode (cards never animate when
  // `view !== "grid"`), but we resolve the integer here so toggling
  // the setting off in the modal turns it off for every card at once
  // without re-mounting them.
  const hoverPreviewSlideCount = settings.deckCardHoverAnimation.enabled
    ? settings.deckCardHoverAnimation.slideCount
    : 0;

  // Empty state: render the parent-supplied slot (or nothing) instead
  // of a card list. The toolbar is hidden too — without items, the
  // view-mode toggle has nothing to act on.
  if (items.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  const isList = mode === "list";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <div
          role="group"
          aria-label="View mode"
          data-testid="view-mode-toggle"
          className="flex items-center gap-1 rounded-md border border-cf-border bg-cf-bg-200 p-0.5"
        >
          <ViewModeOption
            value="grid"
            label="Grid"
            active={mode === "grid"}
            onClick={() => setMode("grid")}
          />
          <ViewModeOption
            value="list"
            label="List"
            active={mode === "list"}
            onClick={() => setMode("list")}
          />
        </div>
      </div>

      <ul
        data-testid="deck-card-list"
        data-view={mode}
        className={
          isList
            ? "flex flex-col gap-3"
            : "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {items.map((it) => {
          const showDelete = Boolean(onDelete && it.canDelete);
          const showArchive = Boolean(onArchive && it.canArchive);
          const showRestore = Boolean(onRestore && it.canRestore);
          return (
            <li key={it.meta.slug} className="contents">
              <DeckCard
                meta={it.meta}
                to={it.to}
                view={mode}
                visibility={it.visibility}
                ideHref={it.ideHref}
                onDelete={showDelete ? onDelete : undefined}
                onArchive={showArchive ? onArchive : undefined}
                onRestore={showRestore ? onRestore : undefined}
                hoverPreviewSlideCount={hoverPreviewSlideCount}
                pending={it.pending}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface ViewModeOptionProps {
  value: "grid" | "list";
  label: string;
  active: boolean;
  onClick: () => void;
}

/**
 * Single segmented-control option. Same visual language as
 * `<SettingsSegmentedRow>` in `SettingsModal.tsx` — active option is
 * orange-filled, inactive is muted. The whole control doubles as a
 * radio group via `role="radio"` + `aria-checked`.
 */
function ViewModeOption({ value, label, active, onClick }: ViewModeOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-interactive
      data-testid={`view-mode-${value}`}
      onClick={onClick}
      className={`rounded px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
        active
          ? "bg-cf-orange text-cf-bg-100"
          : "text-cf-text-muted hover:text-cf-text"
      }`}
    >
      {label}
    </button>
  );
}
