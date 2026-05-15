/**
 * `<TypedSlugConfirmDialog>` — native, in-app destructive confirmation
 * modal that requires the user to type the deck slug verbatim before the
 * destructive action enables (issue #244 / PRD #242).
 *
 * Used for irreversible deck-lifecycle actions: Delete on an active
 * deck, Delete on an archived deck. The typed-slug guard is deliberately
 * a small but pointed papercut: it forces a half-second of intent
 * between "I clicked Delete" and "the deck is gone", which is the
 * cheapest way to prevent muscle-memory deletions of the wrong deck.
 *
 * No `window.confirm` anywhere. No browser popup. The dialog is just a
 * standard modal — the parent passes `isOpen` plus callbacks and the
 * dialog owns the typed-value state internally.
 *
 * Visual language matches `<ConfirmDialog>` (warm cream surface, brown
 * border, orange-accent destructive button). The confirm button is
 * `disabled` until the typed string exactly matches `slug`
 * (case-sensitive, no surrounding whitespace).
 *
 * Test IDs:
 *   - `confirm-dialog`            — the dialog panel.
 *   - `confirm-dialog-backdrop`   — the backdrop.
 *   - `confirm-dialog-cancel`     — Cancel button.
 *   - `confirm-dialog-confirm`    — Destructive confirm button (disabled
 *                                   until the slug is typed).
 *   - `typed-slug-input`          — Slug input field.
 *
 * These match the shared modal contract so downstream tests don't have
 * to fork their selectors based on which dialog flavour they expect.
 */

import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
} from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { easeStandard } from "@/lib/motion";

export interface TypedSlugConfirmDialogProps {
  /** Whether the dialog is currently visible. */
  isOpen: boolean;
  /** The deck slug the user must type before confirm enables. */
  slug: string;
  /** Headline copy — short, single sentence. */
  title: ReactNode;
  /** Body copy. Free-form: string or JSX. */
  body: ReactNode;
  /** Label for the affirmative button. Defaults to "Delete". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Called when the user accepts. Only fires once the typed value matches `slug`. */
  onConfirm: () => void;
  /** Called when the user cancels (button, Esc, or backdrop click). */
  onCancel: () => void;
}

const backdropMotion: HTMLMotionProps<"div"> = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15, ease: easeStandard },
};

const panelMotion: HTMLMotionProps<"div"> = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { duration: 0.18, ease: easeStandard },
};

export function TypedSlugConfirmDialog({
  isOpen,
  slug,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: TypedSlugConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  // Reset the input every time the dialog closes so reopening yields a
  // pristine typed-confirm state.
  useEffect(() => {
    if (!isOpen) setTyped("");
  }, [isOpen]);

  // Esc cancels — only while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onCancel]);

  const isMatch = typed === slug;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          {...backdropMotion}
          data-testid="confirm-dialog-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center bg-cf-text/30 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            {...panelMotion}
            role="dialog"
            aria-modal="true"
            data-testid="confirm-dialog"
            className="relative w-full max-w-md rounded-lg border border-cf-border bg-cf-bg-100 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-medium tracking-[-0.02em] text-cf-text">
              {title}
            </h2>
            <div className="mb-4 text-sm text-cf-text-muted">{body}</div>
            <label className="mb-5 flex flex-col gap-1.5 text-xs text-cf-text-muted">
              <span>
                Type{" "}
                <code className="rounded bg-cf-bg-200 px-1.5 py-0.5 font-mono text-[11px] text-cf-text">
                  {slug}
                </code>{" "}
                to confirm.
              </span>
              <input
                type="text"
                data-interactive
                data-testid="typed-slug-input"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="rounded border border-cf-border bg-cf-bg-100 px-3 py-1.5 font-mono text-sm text-cf-text outline-none transition-colors focus:border-cf-orange"
                autoFocus
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                data-interactive
                data-testid="confirm-dialog-cancel"
                onClick={onCancel}
                className="cf-btn-ghost"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                data-interactive
                data-testid="confirm-dialog-confirm"
                data-destructive="true"
                disabled={!isMatch}
                onClick={() => {
                  if (!isMatch) return;
                  onConfirm();
                }}
                className="inline-flex items-center justify-center rounded border border-cf-orange bg-cf-orange px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-bg-100 transition-colors hover:border-dashed disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-cf-orange"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
