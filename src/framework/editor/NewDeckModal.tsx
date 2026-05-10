/**
 * `<NewDeckModal>` — hyper-minimalistic new-deck wizard.
 *
 * Per Q7 of the #16 grilling decisions: always-visible field is `title`.
 * Everything else (slug override, description, visibility, date,
 * runtime) lives in a collapsed "Advanced settings" disclosure.
 *
 * The slug auto-generates from the title via `slugify`. The user can
 * override it from the advanced section; once they do, we stop
 * auto-tracking the title (to avoid clobbering their edit on the next
 * keystroke).
 *
 * Submit:
 *   1. POST `/api/admin/decks/<slug>` with empty `slides: []`.
 *   2. On success → navigate to `/admin/decks/<slug>?edit=1`.
 *   3. On failure → surface the error inline; modal stays open.
 */

import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
} from "framer-motion";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { easeStandard } from "@/lib/motion";
import type { DataDeck, Visibility } from "@/lib/deck-record";
import { adminWriteHeaders } from "@/lib/admin-fetch";

export interface NewDeckModalProps {
  open: boolean;
  onClose: () => void;
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

/**
 * Best-effort kebab-case slug from a free-form title. Empty strings
 * map to "" so the consumer can keep the slug input visibly empty
 * until the user types something into the title.
 *
 * Mirrors the SLUG_REGEX in `src/lib/deck-record.ts` — only `a-z 0-9 -`
 * are valid; we lowercase, strip diacritics, and replace runs of
 * non-alphanumerics with single hyphens.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Today's date in `YYYY-MM-DD` (local time). */
function today(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function NewDeckModal({ open, onClose }: NewDeckModalProps) {
  const navigate = useNavigate();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleFieldId = useId();
  const slugFieldId = useId();
  const descFieldId = useId();
  const dateFieldId = useId();
  const runtimeFieldId = useId();
  const visibilityFieldId = useId();

  // Fields
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false); // user has overridden
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [date, setDate] = useState(today);
  const [runtimeMinutes, setRuntimeMinutes] = useState(20);

  // UI state
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset form when the modal closes (so reopening starts fresh).
  useEffect(() => {
    if (!open) {
      setTitle("");
      setSlug("");
      setSlugDirty(false);
      setDescription("");
      setVisibility("public");
      setDate(today());
      setRuntimeMinutes(20);
      setAdvancedOpen(false);
      setSubmitting(false);
      setErrorMessage(null);
    }
  }, [open]);

  // Autofocus the title input when the modal opens.
  useEffect(() => {
    if (open) {
      // Defer to next frame so the element is mounted.
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

  // Title → slug auto-tracking. Once the user has edited the slug
  // directly (`slugDirty === true`), stop auto-updating it.
  const onTitleChange = (next: string) => {
    setTitle(next);
    if (!slugDirty) {
      setSlug(slugify(next));
    }
  };

  const onSlugChange = (next: string) => {
    setSlug(next);
    setSlugDirty(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!title.trim()) {
      setErrorMessage("Title is required.");
      return;
    }
    if (!slug || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      setErrorMessage("Slug must be kebab-case (a-z, 0-9, hyphens).");
      return;
    }

    const deck: DataDeck = {
      meta: {
        slug,
        title: title.trim(),
        date,
        visibility,
      },
      slides: [],
    };
    if (description.trim().length > 0) {
      deck.meta.description = description.trim();
    }
    if (Number.isFinite(runtimeMinutes) && runtimeMinutes > 0) {
      deck.meta.runtimeMinutes = runtimeMinutes;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/admin/decks/${encodeURIComponent(slug)}`,
        {
          method: "POST",
          headers: adminWriteHeaders(),
          body: JSON.stringify(deck),
        },
      );
      if (!res.ok) {
        let message = `Failed to create deck (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* not JSON */
        }
        setErrorMessage(message);
        setSubmitting(false);
        return;
      }
      // Success — close modal and route to the editor.
      onClose();
      navigate(`/admin/decks/${slug}?edit=1`);
    } catch (e) {
      setErrorMessage(
        e instanceof Error ? e.message : "Network error — try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...backdropMotion}
          data-testid="new-deck-modal-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center bg-cf-text/30 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) onClose();
          }}
        >
          <motion.div
            {...panelMotion}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleFieldId}
            data-testid="new-deck-modal"
            className="relative w-full max-w-lg rounded-lg border border-cf-border bg-cf-bg-100 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-xl font-medium tracking-[-0.02em] text-cf-text">
              New deck
            </h2>
            <p className="mb-2 text-xs text-cf-text-muted">
              Enter a title to get started. Everything else has a sensible
              default.
            </p>
            <p className="mb-5 text-xs text-cf-text-subtle">
              Slides are built from typed templates — pick a layout, fill the
              slots. Constrained on purpose: the same shape AI agents drive.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* ── Always-visible: title ──────────────────────────────── */}
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
                  data-testid="new-deck-title"
                  value={title}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder="Hello, Slide of Hand"
                  required
                  maxLength={120}
                  className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
                />
              </div>

              {/* ── Advanced settings (collapsed by default) ──────────── */}
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  data-interactive
                  data-testid="advanced-toggle"
                  onClick={() => setAdvancedOpen((o) => !o)}
                  aria-expanded={advancedOpen}
                  className="self-start font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle hover:text-cf-text"
                >
                  {advancedOpen ? "Hide" : "Show"} advanced settings
                </button>

                {advancedOpen && (
                  <div
                    data-testid="advanced-section"
                    className="flex flex-col gap-3 rounded border border-dashed border-cf-border p-4"
                  >
                    {/* Slug */}
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={slugFieldId}
                        className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
                      >
                        Slug
                      </label>
                      <input
                        id={slugFieldId}
                        type="text"
                        data-interactive
                        data-testid="new-deck-slug"
                        value={slug}
                        onChange={(e) => onSlugChange(e.target.value)}
                        placeholder="hello-slide-of-hand"
                        maxLength={80}
                        className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 font-mono text-xs text-cf-text outline-none focus:border-cf-orange"
                      />
                      <p className="text-xs text-cf-text-muted">
                        Auto-generated from the title. Becomes the URL
                        path (<code>/decks/{slug || "your-deck"}</code>).
                      </p>
                    </div>

                    {/* Description */}
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={descFieldId}
                        className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
                      >
                        Description
                      </label>
                      <input
                        id={descFieldId}
                        type="text"
                        data-interactive
                        data-testid="new-deck-description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="One-sentence summary."
                        maxLength={240}
                        className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
                      />
                    </div>

                    {/* Visibility — segmented control (issue #129).
                        Public is the default; flip to Private for
                        customer / under-NDA decks that should NOT be
                        listed on the public index. */}
                    <div className="flex flex-col gap-1.5">
                      <span
                        id={visibilityFieldId}
                        className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
                      >
                        Visibility
                      </span>
                      <div
                        role="radiogroup"
                        aria-labelledby={visibilityFieldId}
                        className="flex shrink-0 items-center gap-1 self-start rounded-md border border-cf-border bg-cf-bg-200 p-0.5"
                      >
                        {(
                          [
                            { value: "public", label: "Public" },
                            { value: "private", label: "Private" },
                          ] as const
                        ).map((opt) => {
                          const isActive = opt.value === visibility;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              role="radio"
                              aria-checked={isActive}
                              data-interactive
                              data-testid={`new-deck-visibility-${opt.value}`}
                              onClick={() => setVisibility(opt.value)}
                              className={`rounded px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                                isActive
                                  ? "bg-cf-orange text-cf-bg-100"
                                  : "text-cf-text-muted hover:text-cf-text"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-cf-text-muted">
                        Public decks appear on the landing page.
                        Private decks are hidden from the public index
                        but still accessible via direct link.
                      </p>
                    </div>

                    {/* Date + runtime side by side */}
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
                          data-testid="new-deck-date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
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
                          min={1}
                          max={600}
                          step={1}
                          data-interactive
                          data-testid="new-deck-runtime"
                          value={runtimeMinutes}
                          onChange={(e) =>
                            setRuntimeMinutes(Number(e.target.value) || 0)
                          }
                          className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {errorMessage && (
                <p
                  role="alert"
                  data-testid="new-deck-error"
                  className="rounded border border-cf-orange/40 bg-cf-orange/10 px-3 py-2 text-xs text-cf-orange"
                >
                  {errorMessage}
                </p>
              )}

              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  data-interactive
                  data-testid="new-deck-cancel"
                  onClick={onClose}
                  disabled={submitting}
                  className="cf-btn-ghost disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-interactive
                  data-testid="new-deck-submit"
                  disabled={submitting || title.trim().length === 0}
                  className="cf-btn-primary disabled:opacity-40"
                >
                  {submitting ? "Creating…" : "Create deck"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
