/**
 * `<EditMode>` — split-view deck editor.
 *
 * Mounts inside `/admin/decks/<slug>?edit=1`. The route component
 * decides whether to render `<EditMode>` or fall back to the read-only
 * `<Deck>` viewer based on the `?edit=1` query.
 *
 * Layout:
 *
 *      ┌────────────────────────────────────────────────────────┐
 *      │ [Title] [Unsaved] [Save] [Reset] [Close]               │
 *      ├──────────────────────────┬─────────────────────────────┤
 *      │                          │                             │
 *      │    LIVE PREVIEW (50%)    │   SLOT EDITORS (50%)        │
 *      │                          │                             │
 *      │  renderDataSlide(slide)  │   <SlotEditor>×N            │
 *      │                          │                             │
 *      ├──────────────────────────┴─────────────────────────────┤
 *      │  <Filmstrip>  thumbnails + drag reorder + + / × / ⎘    │
 *      └────────────────────────────────────────────────────────┘
 *
 * The preview pane renders the currently-selected slide via
 * `renderDataSlide` directly — NOT `<DataDeck>`. See the Slice 6
 * comment in git history for why; tl;dr `<DataDeck>` brings keyboard
 * nav and click-to-advance that fights the editor's UX, and the
 * direct-render path stays in sync with the right-pane selection.
 *
 * Slide selection state lives in `useDeckEditor` (`activeSlideId`)
 * rather than this component's local state — Slice 9's filmstrip
 * supports drag-reorder and delete, both of which would break a local
 * `selectedIndex` (the index would silently point at the wrong slide
 * after a reorder). An id-based source of truth survives both.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { renderDataSlide } from "@/framework/templates/render";
import { templateRegistry } from "@/framework/templates/registry";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";
import { useDeckEditor } from "./useDeckEditor";
import { SlotEditor } from "./SlotEditor";
import { Filmstrip } from "./Filmstrip";
import { DeckMetadataPanel } from "./DeckMetadataPanel";

export interface EditModeProps {
  slug: string;
}

export function EditMode({ slug }: EditModeProps) {
  const editor = useDeckEditor(slug);
  const navigate = useNavigate();
  const [saveStatus, setSaveStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  // Frontend-validation errors from the most recent save attempt. Surfaced
  // in a banner across the top of the body. Cleared on the next mutation
  // or successful save.
  const [validationErrors, setValidationErrors] = useState<string[] | null>(
    null,
  );
  const [metaPanelOpen, setMetaPanelOpen] = useState(false);

  const draft = editor.draft;
  const slides = draft?.slides ?? [];
  const activeSlideId = editor.activeSlideId;
  const selectedIndex = activeSlideId
    ? slides.findIndex((s) => s.id === activeSlideId)
    : -1;
  const slide = selectedIndex >= 0 ? slides[selectedIndex] : undefined;

  // Saving / loading transitions clear the status line.
  useEffect(() => {
    if (saveStatus.kind === "saved") {
      const t = setTimeout(() => setSaveStatus({ kind: "idle" }), 2000);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  if (editor.loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="cf-tag">Loading deck…</p>
      </main>
    );
  }

  if (!editor.persistent || !draft) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="cf-tag">404</p>
        <h1 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
          No deck called &ldquo;{slug}&rdquo;.
        </h1>
        <button
          type="button"
          data-interactive
          onClick={() => navigate("/admin")}
          className="cf-btn-ghost"
        >
          Back to admin
        </button>
      </main>
    );
  }

  const closeEditMode = () => {
    navigate(`/admin/decks/${slug}`);
  };

  const handleSave = async () => {
    setSaveStatus({ kind: "saving" });
    const result = await editor.save();
    if (result.ok) {
      setSaveStatus({ kind: "saved" });
      setValidationErrors(null);
    } else if (result.validationErrors && result.validationErrors.length > 0) {
      // Frontend validation failed — surface the specific error list and
      // do NOT show a generic "Save failed" status (the banner is the
      // canonical surface here).
      setSaveStatus({ kind: "idle" });
      setValidationErrors(result.validationErrors);
    } else {
      setSaveStatus({
        kind: "error",
        message: result.error ?? `Save failed (${result.status ?? "?"})`,
      });
    }
  };

  const handleReset = () => {
    editor.reset();
    setSaveStatus({ kind: "idle" });
    setValidationErrors(null);
  };

  const handleAddSlide = (templateId: string) => {
    if (!templateId) return;
    // The hook auto-selects the new slide via `activeSlideId`, so we
    // don't need to track local index state here.
    editor.addSlide(templateId);
  };

  const template = slide ? templateRegistry.getById(slide.template) : null;
  const slotEntries = template
    ? (Object.entries(template.slots) as Array<[string, SlotSpec]>)
    : [];

  return (
    <main
      data-edit-mode
      className="flex h-screen min-h-screen flex-col bg-cf-bg-100 text-cf-text"
    >
      {/* ── Top toolbar ────────────────────────────────────────────────
          z-50 keeps Save / Reset / Close clickable when the docked
          metadata panel is open (the panel sits at z-40). */}
      <header className="relative z-50 flex items-center justify-between border-b border-cf-border bg-cf-bg-100 px-6 py-3">
        <div className="flex items-center gap-3">
          <p className="cf-tag">Edit</p>
          <h1 className="text-lg font-medium tracking-[-0.02em]">
            {draft.meta.title}
          </h1>
          {editor.isDirty && (
            <span
              data-testid="dirty-indicator"
              className="rounded border border-cf-orange/40 bg-cf-orange/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cf-orange"
            >
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saveStatus.kind === "saving" && (
            <span data-testid="save-status" className="text-xs text-cf-text-muted">
              Saving…
            </span>
          )}
          {saveStatus.kind === "saved" && (
            <span data-testid="save-status" className="text-xs text-cf-text-muted">
              Saved
            </span>
          )}
          {saveStatus.kind === "error" && (
            <span
              role="alert"
              data-testid="save-status"
              className="text-xs text-cf-orange"
            >
              {saveStatus.message}
            </span>
          )}
          <button
            type="button"
            data-interactive
            data-testid="edit-meta-toggle"
            onClick={() => setMetaPanelOpen(true)}
            className="cf-btn-ghost"
            aria-label="Open deck settings"
            title="Deck settings"
          >
            Settings
          </button>
          <button
            type="button"
            data-interactive
            data-testid="edit-save"
            onClick={handleSave}
            disabled={!editor.isDirty || saveStatus.kind === "saving"}
            className="cf-btn-primary disabled:opacity-40"
          >
            Save Deck
          </button>
          <button
            type="button"
            data-interactive
            data-testid="edit-reset"
            onClick={handleReset}
            disabled={!editor.isDirty}
            className="cf-btn-ghost disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            data-interactive
            data-testid="edit-close"
            onClick={closeEditMode}
            className="cf-btn-ghost"
          >
            Close
          </button>
        </div>
      </header>

      {/* ── Validation banner ────────────────────────────────────────
          When the most recent save attempt failed frontend validation,
          surface the specific error list inline. The banner persists
          until the user makes another edit (which clears the dirty-state
          mismatch and re-enables save) or presses Reset. */}
      {validationErrors && validationErrors.length > 0 && (
        <div
          role="alert"
          data-testid="validation-banner"
          className="border-b border-cf-orange/40 bg-cf-orange/10 px-6 py-3 text-cf-orange"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.25em]">
            Cannot save — fix the following:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {validationErrors.map((err, i) => (
              <li key={i} data-testid="validation-error">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Split-view body ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: live preview */}
        <section
          aria-label="Slide preview"
          data-testid="edit-preview"
          className="relative flex w-1/2 items-center justify-center border-r border-cf-border bg-cf-bg-200 p-8"
        >
          {slide ? (
            <div className="aspect-[16/9] w-full max-w-3xl overflow-hidden rounded border border-cf-border bg-cf-bg-100 shadow-[0_0_0_1px_var(--color-cf-border)]">
              <div
                data-testid="edit-preview-stage"
                className="flex h-full w-full items-center justify-center p-8"
              >
                {renderDataSlide(slide, 0)}
              </div>
            </div>
          ) : (
            <p className="text-sm text-cf-text-muted">
              No slides yet — pick a template on the right to add one.
            </p>
          )}
        </section>

        {/* Right: editor pane */}
        <section
          aria-label="Slot editors"
          data-testid="edit-editor"
          className="flex w-1/2 flex-col overflow-y-auto p-6"
        >
          {/* Slide indicator + add-slide picker. Prev/next buttons are
              gone in Slice 9 — the filmstrip below the split-view is
              the canonical navigation surface. The picker is kept as
              a fallback (and so existing tests / muscle-memory still
              work). */}
          <div className="mb-6 flex flex-col gap-3 border-b border-cf-border pb-4">
            <div className="flex items-center justify-between gap-2">
              <span
                data-testid="slide-indicator"
                className="font-mono text-xs uppercase tracking-[0.15em] text-cf-text-muted"
              >
                {slides.length === 0
                  ? "0 of 0"
                  : `${selectedIndex + 1} of ${slides.length}`}
              </span>
            </div>

            <AddSlidePicker onAdd={handleAddSlide} />
          </div>

          {/* Per-slot editors */}
          {slide && template ? (
            <div className="flex flex-col gap-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-subtle">
                Template · {template.label}
              </p>
              {slotEntries.map(([name, spec]) => {
                const value = slide.slots[name];
                if (!value) return null;
                return (
                  <SlotEditor
                    key={`${slide.id}-${name}`}
                    name={name}
                    spec={spec}
                    value={value}
                    onChange={(next: SlotValue) => {
                      editor.updateSlide(slide.id, (s) => ({
                        ...s,
                        slots: { ...s.slots, [name]: next },
                      }));
                    }}
                  />
                );
              })}
            </div>
          ) : slide && !template ? (
            <p role="alert" className="text-xs text-cf-orange">
              Unknown template: <code>{slide.template}</code>
            </p>
          ) : (
            <p className="text-sm text-cf-text-muted">
              This deck has no slides. Pick a template above to add one.
            </p>
          )}
        </section>
      </div>

      {/* ── Filmstrip ────────────────────────────────────────────────
          Horizontal slide-thumbnail strip at the bottom of the layout.
          Owned by the `useDeckEditor` hook; this component just wires
          the callbacks. */}
      <Filmstrip
        slides={slides}
        activeSlideId={activeSlideId}
        onSelect={(id) => editor.setActiveSlide(id)}
        onAddAtEnd={(templateId) => editor.addSlide(templateId)}
        onAddAfter={(templateId, afterIndex) =>
          editor.addSlide(templateId, afterIndex)
        }
        onDuplicate={(id) => editor.duplicateSlide(id)}
        onDelete={(id) => editor.deleteSlide(id)}
        onReorder={(from, to) => editor.reorderSlides(from, to)}
      />

      {/* ── Deck metadata sidebar ───────────────────────────────────── */}
      <DeckMetadataPanel
        open={metaPanelOpen}
        meta={draft.meta}
        onUpdateMeta={(updater) => editor.updateMeta(updater)}
        onClose={() => setMetaPanelOpen(false)}
      />
    </main>
  );
}

/**
 * Inline template picker — a `<select>` listing every registered
 * template. The "(none)" placeholder is a real `<option>` because
 * a `<select>` always emits a value; we treat the empty value as a
 * no-op in `handleAddSlide`.
 */
function AddSlidePicker({ onAdd }: { onAdd: (templateId: string) => void }) {
  const templates = templateRegistry.list();
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="add-slide-template"
        className="font-mono text-[10px] uppercase tracking-[0.25em] text-cf-text-muted"
      >
        Add slide
      </label>
      <select
        id="add-slide-template"
        data-interactive
        data-testid="add-slide-template"
        defaultValue=""
        onChange={(e) => {
          const value = e.target.value;
          if (!value) return;
          onAdd(value);
          // Reset the select so the same template can be added again.
          e.target.value = "";
        }}
        className="rounded border border-cf-border bg-cf-bg-100 px-2 py-1 text-xs"
      >
        <option value="">Pick a template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
