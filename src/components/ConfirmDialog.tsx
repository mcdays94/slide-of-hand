/**
 * `<ConfirmDialog>` — a small, reusable confirmation modal.
 *
 * Two intended consumers in v1 (issue #130):
 *   1. The admin index trashcan — "Delete <Deck Title>?"
 *   2. The deck-edit view's Delete deck button — same prompt.
 *
 * Future destructive actions (e.g. slide deletion, KV theme reset) can
 * lean on this primitive too. Kept deliberately small: title + body +
 * two buttons. No async lifecycle, no internal state — the parent owns
 * both `isOpen` and the loading state of whatever the confirm does.
 *
 * Behaviour contract:
 *   - Esc cancels (calls `onCancel`).
 *   - Click on backdrop cancels.
 *   - Click on the panel itself does NOT cancel (event swallowed).
 *   - `destructive=true` flags the confirm button visually so the user
 *     reads it as an irreversible action.
 *
 * Visual language follows the standard modal pattern in this repo
 * (warm cream surface, brown border, orange accent on destructive):
 *   - `bg-cf-text/30 backdrop-blur-sm` for the backdrop.
 *   - `border-cf-border bg-cf-bg-100` for the panel.
 *   - Destructive confirm uses the orange accent token (`cf-orange`),
 *     not pure red — Slide of Hand has no pure red in its token set
 *     and AGENTS.md forbids ad-hoc hex.
 */

import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
} from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { easeStandard } from "@/lib/motion";

export interface ConfirmDialogProps {
  /** Whether the dialog is currently visible. */
  isOpen: boolean;
  /** Headline copy — short, single sentence. */
  title: ReactNode;
  /** Body copy. Free-form: string or JSX (e.g. with a `<strong>` deck title). */
  body: ReactNode;
  /** Label for the affirmative button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Called when the user accepts. */
  onConfirm: () => void;
  /** Called when the user cancels (button, Esc, or backdrop click). */
  onCancel: () => void;
  /** Flag the confirm button as a destructive action — tinted orange. */
  destructive?: boolean;
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

export function ConfirmDialog({
  isOpen,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmDialogProps) {
  // Esc cancels. Only attach the listener while the dialog is open so
  // closed instances don't intercept Escape from other UI (the deck
  // editor uses Escape too).
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

  // Destructive confirm uses the same `cf-btn-primary` shape but
  // recoloured with the orange-accent token — kept inline (not a new
  // utility class) because the destructive variant is rare enough that
  // a one-off Tailwind stack is cheaper than another class in the
  // design-system CSS.
  const confirmClass = destructive
    ? "inline-flex items-center justify-center rounded border border-cf-orange bg-cf-orange px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-bg-100 transition-colors hover:border-dashed"
    : "cf-btn-primary";

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
            <div className="mb-5 text-sm text-cf-text-muted">{body}</div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                data-interactive
                data-testid="confirm-dialog-cancel"
                onClick={onCancel}
                className="cf-btn-ghost"
                autoFocus
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                data-interactive
                data-testid="confirm-dialog-confirm"
                data-destructive={destructive ? "true" : undefined}
                onClick={onConfirm}
                className={confirmClass}
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
