/**
 * `<ImageSlotEditor>` — drag-drop + R2 upload + library-picker UI.
 *
 * Slice 7 / issue #63. The Wave D pre-orchestrator commit shipped this
 * file as a stub registered in `SlotEditor.tsx`'s switch; this body
 * replaces the placeholder with the real editor. The exported component
 * name (`ImageSlotEditor`) and prop interface (`ImageSlotEditorProps`)
 * are preserved exactly so the dispatcher does not need to be touched
 * (which would conflict with the parallel #65 worker editing
 * `SlotEditor.tsx` for revealAt UI).
 *
 * Behaviour:
 *
 *   - Drop zone + click-to-pick file input. Dragging-over highlights
 *     the zone (dashed brand border) so the user gets visual feedback.
 *   - On drop / pick we run client-side validation (MIME allowlist +
 *     10 MB cap) BEFORE POSTing to `/api/admin/images/<slug>` — failures
 *     fail fast and never reach the network. The Worker enforces the
 *     same checks (defense-in-depth) but rejecting in the browser is
 *     better UX.
 *   - During the in-flight POST a progress affordance is visible (a
 *     simple spinner caption — `progress` is an indeterminate 0→100
 *     because `fetch()` doesn't expose upload progress).
 *   - The current `src` previews as an `<img>` regardless of whether
 *     it was just uploaded or persisted from a previous save.
 *   - "Choose from library" toggles a `<ImageLibrary>` panel that lists
 *     every previously-uploaded image for this deck and lets the user
 *     pick one without re-uploading.
 *   - Alt-text input is required: when `spec.required` is true and the
 *     value's `alt` is empty, we render a subtle warning beneath the
 *     input. We do NOT block save here — `useDeckEditor.save()` POSTs
 *     whatever the draft holds; deck-level validation (#16's render
 *     pipeline) will surface a server-side error if the empty alt
 *     ultimately fails template validation.
 *
 * Slug source: this editor is only ever mounted inside
 * `/admin/decks/:slug?edit=1`. We pull the slug from `useParams()` so
 * the SlotEditor dispatcher (above us) doesn't need to thread it
 * through — and so this module can ship without changing SlotEditor's
 * `props` shape (locked by the parallel-dispatch contract).
 */

import { useCallback, useRef, useState, type DragEvent } from "react";
import { useParams } from "react-router-dom";
import type { SlotSpec } from "@/lib/template-types";
import type { SlotValue } from "@/lib/slot-types";
import { ImageLibrary } from "../ImageLibrary";
import { useImageUpload, ALLOWED_IMAGE_MIME_TYPES } from "../useImageUpload";

export interface ImageSlotEditorProps {
  name: string;
  spec: SlotSpec;
  value: Extract<SlotValue, { kind: "image" }>;
  onChange: (next: Extract<SlotValue, { kind: "image" }>) => void;
}

/** Comma-separated MIME list for the `<input type="file">` accept attr. */
const ACCEPT_ATTR = ALLOWED_IMAGE_MIME_TYPES.join(",");

export function ImageSlotEditor({
  name,
  spec,
  value,
  onChange,
}: ImageSlotEditorProps) {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";

  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const { upload, uploading, error, clearError } = useImageUpload();

  const inputId = `slot-${name}`;
  const altInputId = `slot-${name}-alt`;
  const showAltWarning = spec.required && value.alt.trim().length === 0;

  /** Build the next slot value preserving `revealAt`. */
  const emit = useCallback(
    (patch: { src?: string; alt?: string }) => {
      const next: Extract<SlotValue, { kind: "image" }> = {
        kind: "image",
        src: patch.src ?? value.src,
        alt: patch.alt ?? value.alt,
      };
      if (value.revealAt !== undefined) next.revealAt = value.revealAt;
      onChange(next);
    },
    [onChange, value.alt, value.revealAt, value.src],
  );

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const result = await upload(file, slug);
        // Preserve any alt text the user already typed; only set src.
        // (A fresh upload with no prior alt leaves alt as-is — the user
        // is then prompted by the required indicator.)
        emit({ src: result.src });
      } catch {
        // `useImageUpload` already set `error`; the editor surfaces it.
      }
    },
    [emit, slug, upload],
  );

  const onPick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so the same file can be re-picked.
      event.target.value = "";
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onAltChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      emit({ alt: event.target.value });
    },
    [emit],
  );

  const onLibraryPick = useCallback(
    (src: string) => {
      emit({ src });
      setLibraryOpen(false);
    },
    [emit],
  );

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
      >
        {spec.label}
        {spec.required && (
          <span aria-label="required" className="ml-1 text-cf-orange">
            *
          </span>
        )}
      </label>

      {/* Drop zone. Always rendered; image preview lives inside it when src is set. */}
      <div
        data-testid={`slot-image-dropzone-${name}`}
        data-drag-over={isDragOver ? "true" : undefined}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed px-3 py-4 text-center transition-colors ${
          isDragOver
            ? "border-cf-orange bg-cf-bg-200"
            : "border-cf-border bg-cf-bg-100"
        }`}
      >
        {value.src ? (
          <img
            data-testid={`slot-image-preview-${name}`}
            src={value.src}
            alt={value.alt}
            className="max-h-40 w-auto rounded border border-cf-border object-contain"
          />
        ) : (
          <p className="text-xs text-cf-text-muted">
            Drag &amp; drop an image, or
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            data-interactive
            data-testid={`slot-image-pick-${name}`}
            onClick={onPick}
            disabled={uploading}
            className="cf-btn-ghost text-xs disabled:opacity-50"
          >
            {value.src ? "Replace" : "Choose file"}
          </button>
          <button
            type="button"
            data-interactive
            data-testid={`slot-image-library-${name}`}
            onClick={() => setLibraryOpen((v) => !v)}
            disabled={uploading}
            className="cf-btn-ghost text-xs disabled:opacity-50"
          >
            {libraryOpen ? "Hide library" : "Choose from library"}
          </button>
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          data-interactive
          data-testid={`slot-image-input-${name}`}
          accept={ACCEPT_ATTR}
          onChange={onInputChange}
          className="hidden"
        />
        {uploading && (
          <p
            data-testid={`slot-image-uploading-${name}`}
            className="text-xs text-cf-text-muted"
            role="status"
            aria-live="polite"
          >
            Uploading…
          </p>
        )}
        {error && (
          <div
            role="alert"
            data-testid={`slot-image-error-${name}`}
            className="flex items-center gap-2 text-xs text-cf-orange"
          >
            <span>{error}</span>
            <button
              type="button"
              data-interactive
              data-testid={`slot-image-error-dismiss-${name}`}
              onClick={clearError}
              className="cf-btn-ghost text-[10px]"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Library picker — only mounted when toggled on, mounted inline (NOT modal). */}
      <ImageLibrary
        slug={slug}
        open={libraryOpen}
        onPick={onLibraryPick}
        onClose={() => setLibraryOpen(false)}
      />

      {/* Alt-text input. Required unless the spec explicitly opts out. */}
      <label
        htmlFor={altInputId}
        className="mt-1 text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted"
      >
        Alt text
        {spec.required && (
          <span aria-label="required" className="ml-1 text-cf-orange">
            *
          </span>
        )}
      </label>
      <input
        id={altInputId}
        type="text"
        data-interactive
        data-testid={`slot-image-alt-${name}`}
        value={value.alt}
        onChange={onAltChange}
        placeholder="Describe the image for screen readers."
        required={spec.required}
        aria-required={spec.required}
        className="rounded border border-cf-border bg-cf-bg-100 px-3 py-2 text-sm text-cf-text outline-none focus:border-cf-orange"
      />
      {showAltWarning && (
        <p
          role="alert"
          data-testid={`slot-image-alt-warning-${name}`}
          className="text-xs text-cf-orange"
        >
          Alt text helps screen-reader users — please add a description.
        </p>
      )}
      {spec.description && (
        <p className="text-xs text-cf-text-muted">{spec.description}</p>
      )}
    </div>
  );
}
