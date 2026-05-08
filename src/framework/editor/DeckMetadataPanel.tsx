/**
 * `<DeckMetadataPanel>` — slide-out sidebar for editing deck-level
 * metadata (title, description, visibility, date, author, event,
 * cover image path, runtimeMinutes).
 *
 * Mounts inside `<EditMode>`, triggered by the "Settings" button in
 * the top toolbar. Parallels `<NewDeckModal>`'s "advanced settings"
 * section in shape — the modal is for creation; this panel is for
 * editing an existing deck.
 *
 * Mutations are dispatched through `useDeckEditor.updateMeta`, so
 * each keystroke flips `isDirty` and the actual save lifecycle stays
 * unified with slide-level edits. Closing the panel does NOT save —
 * the user explicitly clicks the toolbar's Save button.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef } from "react";
import type { DataDeckMeta, Visibility } from "@/lib/deck-record";
import { easeStandard } from "@/lib/motion";

export interface DeckMetadataPanelProps {
  open: boolean;
  meta: DataDeckMeta;
  onUpdateMeta: (updater: (m: DataDeckMeta) => DataDeckMeta) => void;
  onClose: () => void;
}

const backdropMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15, ease: easeStandard },
};

const panelMotion = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 24 },
  transition: { duration: 0.18, ease: easeStandard },
};

/**
 * Stripped-down meta shape used by the panel's input bindings. We
 * always keep optional fields as strings (empty string === "not set")
 * so the inputs are controlled and `meta` round-trips cleanly through
 * the updater chain. The merge happens in the per-field onChange:
 * empty strings are dropped from the persisted meta to match
 * `validateDataDeck`'s "absent or non-empty" contract.
 */
function setOptionalString(
  meta: DataDeckMeta,
  key: keyof DataDeckMeta,
  next: string,
): DataDeckMeta {
  const out = { ...meta };
  if (next.trim().length === 0) {
    delete (out as Record<string, unknown>)[key];
  } else {
    (out as Record<string, unknown>)[key] = next;
  }
  return out;
}

export function DeckMetadataPanel({
  open,
  meta,
  onUpdateMeta,
  onClose,
}: DeckMetadataPanelProps) {
  const titleFieldId = useId();
  const descFieldId = useId();
  const visibilityName = useId(); // shared name for the radio group
  const dateFieldId = useId();
  const authorFieldId = useId();
  const eventFieldId = useId();
  const coverFieldId = useId();
  const runtimeFieldId = useId();
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Autofocus the title input when the panel opens.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Non-modal sidebar: docked to the right, no backdrop. The user can
  // continue clicking Save Deck / Reset / the filmstrip while the panel
  // is open. We keep the backdrop element ONLY as a visual depth marker
  // (low opacity, pointer-events-none) so the editor surface still feels
  // visually focused on the panel without trapping pointer input. Click
  // detection relies on Esc + Close button + clicking outside the panel
  // sticks the user back at the editor without any mode change.
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...backdropMotion}
          data-testid="deck-meta-backdrop"
          className="pointer-events-none fixed bottom-0 right-0 top-[3.25rem] z-40 flex w-full max-w-md justify-end"
        >
          <motion.aside
            {...panelMotion}
            role="dialog"
            aria-modal="false"
            aria-label="Deck settings"
            data-testid="deck-meta-panel"
            className="pointer-events-auto flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto border-l border-cf-border bg-cf-bg-100 p-6 shadow-xl"
          >
            <header className="flex items-center justify-between">
              <div>
                <p className="cf-tag">Deck settings</p>
                <h2 className="mt-1 text-xl font-medium tracking-[-0.02em] text-cf-text">
                  Metadata
                </h2>
              </div>
              <button
                type="button"
                data-interactive
                data-testid="deck-meta-close"
                onClick={onClose}
                className="cf-btn-ghost"
              >
                Close
              </button>
            </header>

            {/* ── Title ─────────────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={titleFieldId}
                className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
              >
                Title
                <span aria-label="required" className="ml-1 text-cf-orange">
                  *
                </span>
              </label>
              <input
                id={titleFieldId}
                ref={titleInputRef}
                type="text"
                data-interactive
                data-testid="deck-meta-title"
                value={meta.title}
                onChange={(e) =>
                  onUpdateMeta((m) => ({ ...m, title: e.target.value }))
                }
                maxLength={120}
                className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
              />
            </div>

            {/* ── Description ───────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={descFieldId}
                className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
              >
                Description
              </label>
              <textarea
                id={descFieldId}
                data-interactive
                data-testid="deck-meta-description"
                value={meta.description ?? ""}
                onChange={(e) =>
                  onUpdateMeta((m) =>
                    setOptionalString(m, "description", e.target.value),
                  )
                }
                rows={3}
                maxLength={500}
                className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
              />
            </div>

            {/* ── Visibility (radio group) ──────────────────────────── */}
            <fieldset
              data-testid="deck-meta-visibility"
              className="flex flex-col gap-2"
            >
              <legend className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted">
                Visibility
              </legend>
              <label className="flex items-center gap-2 text-sm text-cf-text">
                <input
                  type="radio"
                  data-interactive
                  data-testid="deck-meta-visibility-private"
                  name={visibilityName}
                  value="private"
                  checked={meta.visibility === "private"}
                  onChange={() =>
                    onUpdateMeta((m) => ({ ...m, visibility: "private" }))
                  }
                />
                <span>
                  <strong>Private</strong>
                  <span className="ml-2 text-xs text-cf-text-muted">
                    Hidden from the public index.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm text-cf-text">
                <input
                  type="radio"
                  data-interactive
                  data-testid="deck-meta-visibility-public"
                  name={visibilityName}
                  value="public"
                  checked={meta.visibility === "public"}
                  onChange={() =>
                    onUpdateMeta((m) => ({
                      ...m,
                      visibility: "public" as Visibility,
                    }))
                  }
                />
                <span>
                  <strong>Public</strong>
                  <span className="ml-2 text-xs text-cf-text-muted">
                    Listed at <code>/</code> on save.
                  </span>
                </span>
              </label>
            </fieldset>

            {/* ── Date / Runtime row ────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={dateFieldId}
                  className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
                >
                  Date
                </label>
                <input
                  id={dateFieldId}
                  type="date"
                  data-interactive
                  data-testid="deck-meta-date"
                  value={meta.date}
                  onChange={(e) =>
                    onUpdateMeta((m) => ({ ...m, date: e.target.value }))
                  }
                  className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={runtimeFieldId}
                  className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
                >
                  Runtime (min)
                </label>
                <input
                  id={runtimeFieldId}
                  type="number"
                  min={0}
                  max={600}
                  step={1}
                  data-interactive
                  data-testid="deck-meta-runtime"
                  value={meta.runtimeMinutes ?? ""}
                  onChange={(e) =>
                    onUpdateMeta((m) => {
                      const next = { ...m };
                      const raw = e.target.value;
                      if (raw === "") {
                        delete next.runtimeMinutes;
                      } else {
                        const n = Number(raw);
                        if (Number.isFinite(n) && n >= 0) {
                          next.runtimeMinutes = Math.floor(n);
                        }
                      }
                      return next;
                    })
                  }
                  className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
                />
              </div>
            </div>

            {/* ── Author ────────────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={authorFieldId}
                className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
              >
                Author
              </label>
              <input
                id={authorFieldId}
                type="text"
                data-interactive
                data-testid="deck-meta-author"
                value={meta.author ?? ""}
                onChange={(e) =>
                  onUpdateMeta((m) =>
                    setOptionalString(m, "author", e.target.value),
                  )
                }
                maxLength={120}
                className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
              />
            </div>

            {/* ── Event ─────────────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={eventFieldId}
                className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
              >
                Event
              </label>
              <input
                id={eventFieldId}
                type="text"
                data-interactive
                data-testid="deck-meta-event"
                value={meta.event ?? ""}
                onChange={(e) =>
                  onUpdateMeta((m) =>
                    setOptionalString(m, "event", e.target.value),
                  )
                }
                maxLength={120}
                placeholder="DTX Manchester 2026"
                className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
              />
            </div>

            {/* ── Cover ─────────────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={coverFieldId}
                className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
              >
                Cover image (path)
              </label>
              <input
                id={coverFieldId}
                type="text"
                data-interactive
                data-testid="deck-meta-cover"
                value={meta.cover ?? ""}
                onChange={(e) =>
                  onUpdateMeta((m) =>
                    setOptionalString(m, "cover", e.target.value),
                  )
                }
                placeholder="/uploads/cover.jpg"
                className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 font-mono text-xs text-cf-text outline-none focus:border-cf-orange"
              />
              <p className="text-xs text-cf-text-muted">
                Optional path to a cover image for the public index card.
              </p>
            </div>

            <p className="mt-auto text-xs text-cf-text-muted">
              Changes apply to the draft. Click{" "}
              <strong>Save Deck</strong> in the toolbar to persist.
            </p>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
