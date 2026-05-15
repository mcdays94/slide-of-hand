/**
 * `<DeckLifecycleMenu>` — quiet, hover-revealed action menu pinned to
 * the corner of a `<DeckCard>` (issue #244 / PRD #242).
 *
 * Replaces the single hover-revealed trashcan from issue #130 with a
 * generalised lifecycle action surface:
 *
 *   - Active decks: menu shows **Archive** + **Delete**.
 *   - Archived decks: menu shows **Restore** + **Delete**.
 *
 * Each item only appears when its callback is wired. The component is
 * deliberately dumb — it raises events to its parent and never owns
 * the actual destructive flow (confirmation dialogs live one level up
 * inside `<DeckCard>`).
 *
 * Visual contract:
 *   - Trigger is hidden until `group-hover` / focus on the parent card.
 *     The parent card is responsible for `className="group ..."`.
 *   - Menu opens directly below the trigger; closes on:
 *       * a second click of the trigger,
 *       * selection of any menu item,
 *       * the Escape key,
 *       * a click anywhere outside the trigger / menu (parent owns this
 *         via the document-level listener installed when open).
 *
 * Test IDs are deck-scoped (`lifecycle-menu-trigger-<slug>`, etc.) so
 * the same admin page can host many cards without selector collisions.
 *
 * NOTE: This menu does not render its own keyboard-accessible roving
 * focus. Items are plain `<button>`s — tab order is good enough for v1
 * and matches the rest of the admin chrome. Full `role="menu"` /
 * arrow-key navigation can land later if user feedback asks for it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type DeckLifecycle = "active" | "archived";

export interface DeckLifecycleMenuProps {
  /** Deck slug — used for test IDs and accessible name. */
  slug: string;
  /** Deck title — used to compose the trigger's aria-label. */
  title: string;
  /** Whether this card represents an active or archived deck. */
  lifecycle: DeckLifecycle;
  /**
   * Archive callback — invoked when the user picks the menu's Archive
   * item. Only rendered when `lifecycle === "active"`. The parent owns
   * the confirmation dialog: this callback fires AFTER the menu item is
   * clicked but BEFORE any confirmation has happened.
   */
  onArchive?: (slug: string) => void;
  /**
   * Restore callback — invoked when the user picks the menu's Restore
   * item. Only rendered when `lifecycle === "archived"`. Same
   * contract as `onArchive` re: confirmation timing.
   */
  onRestore?: (slug: string) => void;
  /**
   * Delete callback — invoked when the user picks the menu's Delete
   * item. Rendered in both lifecycle states when wired.
   */
  onDelete?: (slug: string) => void;
}

/** Inline lucide-style ellipsis-vertical icon — kept inline (no dep). */
function MenuIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

export function DeckLifecycleMenu({
  slug,
  title,
  lifecycle,
  onArchive,
  onRestore,
  onDelete,
}: DeckLifecycleMenuProps) {
  const showArchive = lifecycle === "active" && Boolean(onArchive);
  const showRestore = lifecycle === "archived" && Boolean(onRestore);
  const showDelete = Boolean(onDelete);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Esc closes the menu — only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const root = containerRef.current;
      if (!root) return;
      if (!(e.target instanceof Node)) return;
      if (root.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  // If no lifecycle item is wired we render nothing — the parent's
  // hover-revealed slot stays empty, which is the correct outcome for
  // source decks that lack a backend for this lifecycle today.
  if (!showArchive && !showRestore && !showDelete) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      data-no-advance
      className="absolute right-3 top-3 z-10"
    >
      <button
        type="button"
        data-interactive
        data-testid={`lifecycle-menu-trigger-${slug}`}
        aria-label={`Actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Actions for ${title}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex h-7 w-7 items-center justify-center rounded border border-cf-border bg-cf-bg-100 text-cf-text-muted transition-opacity hover:border-cf-text hover:text-cf-text focus:opacity-100 ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <MenuIcon />
      </button>

      {open && (
        <div
          role="menu"
          data-testid={`lifecycle-menu-${slug}`}
          className="absolute right-0 top-9 z-20 flex min-w-[160px] flex-col overflow-hidden rounded-md border border-cf-border bg-cf-bg-100 shadow-lg"
        >
          {showArchive && (
            <button
              type="button"
              role="menuitem"
              data-interactive
              data-testid={`lifecycle-menu-archive-${slug}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                close();
                onArchive?.(slug);
              }}
              className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.2em] text-cf-text-muted transition-colors hover:bg-cf-bg-200 hover:text-cf-text"
            >
              Archive
            </button>
          )}
          {showRestore && (
            <button
              type="button"
              role="menuitem"
              data-interactive
              data-testid={`lifecycle-menu-restore-${slug}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                close();
                onRestore?.(slug);
              }}
              className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.2em] text-cf-text-muted transition-colors hover:bg-cf-bg-200 hover:text-cf-text"
            >
              Restore
            </button>
          )}
          {showDelete && (
            <button
              type="button"
              role="menuitem"
              data-interactive
              data-testid={`lifecycle-menu-delete-${slug}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                close();
                onDelete?.(slug);
              }}
              className="border-t border-cf-border px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.2em] text-cf-orange transition-colors hover:bg-cf-orange/10"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
