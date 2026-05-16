/**
 * `<DraftAssetShelf>` — upload binary assets (speaker photos, logos)
 * into a draft deck's R2 image library and surface their public URLs
 * so the user can reference them in follow-up AI prompts.
 *
 * Issue #235. The pragmatic v1 of "let AI-generated decks include
 * binary assets": the model still emits text-only JSX, but the user
 * can now upload arbitrary images into `/images/decks/<slug>/...`
 * BEFORE iterating, and the system prompt is wired so a user message
 * like
 *
 *     "use /images/decks/crdt-collab/abc.png as the speaker photo"
 *
 * results in `<img src="/images/decks/crdt-collab/abc.png" />` in
 * the regenerated slide JSX.
 *
 * The shelf renders nothing until a slug is known — pre-tool-call
 * the route can't tell where the upload should land. Once the AI SDK
 * surfaces `part.input.slug` via `extractLatestDeckCreationCall`'s
 * new `inputSlug` field, the route forwards it here and the shelf
 * materialises.
 *
 * UX shape (intentionally minimal for v1):
 *
 *   - File input + (optional) clipboard-paste future.
 *   - Per-upload row showing the URL plus a "Copy URL" button.
 *   - Existing library list below — fetches `/api/admin/images/<slug>`
 *     and renders any previously-uploaded entries so the user can
 *     re-copy a URL they already uploaded earlier in the session.
 *
 * Auth: same `adminWriteHeaders()` shim as `<ImageLibrary>`. Localhost
 * dev injects the access header; production gates at Cloudflare Access.
 */

import { useCallback, useEffect, useState } from "react";
import { Upload, Copy, Check } from "lucide-react";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  useImageUpload,
} from "@/framework/editor/useImageUpload";
import { adminWriteHeaders } from "@/lib/admin-fetch";

/**
 * Mirror of `worker/images.ts`'s `ImageRecord`. Defined locally so this
 * frontend module doesn't reach across the SPA/Worker seam. Same
 * shape as the one in `ImageLibrary.tsx`.
 */
interface ImageRecord {
  src: string;
  contentHash: string;
  size: number;
  mimeType: string;
  originalFilename: string;
  uploadedAt: string;
}

export interface DraftAssetShelfProps {
  /**
   * Draft slug — the model's input.slug from `extractLatestDeckCreationCall`.
   * `undefined` until the model has committed to a slug; the shelf
   * renders nothing in that state.
   */
  slug: string | undefined;
}

export function DraftAssetShelf({ slug }: DraftAssetShelfProps) {
  if (!slug) return null;
  return <DraftAssetShelfInner slug={slug} />;
}

function DraftAssetShelfInner({ slug }: { slug: string }) {
  const { upload, uploading, error } = useImageUpload();
  // URLs from THIS-session uploads, surfaced in the "Just uploaded"
  // strip with a Copy button. Library entries (fetched separately)
  // render below.
  const [recent, setRecent] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [library, setLibrary] = useState<ImageRecord[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await fetch(
        `/api/admin/images/${encodeURIComponent(slug)}`,
        { headers: adminWriteHeaders() },
      );
      if (!res.ok) {
        setLibrary([]);
        return;
      }
      const body = (await res.json()) as { images?: ImageRecord[] };
      setLibrary(Array.isArray(body.images) ? body.images : []);
    } catch {
      setLibrary([]);
    } finally {
      setLibraryLoading(false);
    }
  }, [slug]);

  // Fetch the library on mount + whenever the slug changes.
  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so picking the same file twice re-triggers
      // the upload — important if a previous attempt errored.
      e.target.value = "";
      if (!file) return;
      try {
        const { src } = await upload(file, slug);
        setRecent((prev) => [src, ...prev]);
        // Re-fetch the library so the new upload also appears in the
        // persistent list (not just the recent strip).
        void refreshLibrary();
      } catch {
        // `useImageUpload` already surfaces the error via its
        // `error` state; nothing extra to do here.
      }
    },
    [upload, slug, refreshLibrary],
  );

  const onCopy = useCallback(async (url: string) => {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(url);
      }
      setCopied(url);
      // Brief check-mark feedback. happy-dom doesn't run timers
      // by default in tests; the test only asserts writeText was
      // called, not the post-timeout reset.
      setTimeout(() => setCopied((cur) => (cur === url ? null : cur)), 1200);
    } catch {
      // Clipboard failure is non-fatal — user can still hand-copy.
    }
  }, []);

  return (
    <div
      data-testid="draft-asset-shelf"
      data-slug={slug}
      className="flex flex-col gap-3 rounded-md border border-cf-border bg-cf-bg-200 p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-cf-text">
          Draft assets
        </h2>
        <code className="font-mono text-[10px] text-cf-text-muted">
          {slug}
        </code>
      </div>
      <p className="text-xs leading-relaxed text-cf-text-muted">
        Upload speaker photos, logos, or any image you want to use in this
        draft. Each upload returns a stable URL you can paste into a
        follow-up prompt — the AI will use it directly without trying to
        invent its own asset path.
      </p>

      <label
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded border border-dashed border-cf-border bg-cf-bg-100 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-muted transition-colors hover:border-cf-orange hover:text-cf-text"
        data-testid="draft-asset-shelf-upload-label"
      >
        <Upload size={11} aria-hidden="true" />
        {uploading ? "Uploading…" : "Upload image"}
        <input
          data-testid="draft-asset-shelf-file-input"
          type="file"
          accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
          onChange={onFileChange}
          disabled={uploading}
          className="hidden"
        />
      </label>

      {uploading && (
        <p
          data-testid="draft-asset-shelf-uploading"
          className="text-xs text-cf-text-muted"
        >
          Uploading…
        </p>
      )}

      {error && (
        <p
          role="alert"
          data-testid="draft-asset-shelf-error"
          className="rounded border border-cf-orange/40 bg-cf-orange-light px-2 py-1 text-xs text-cf-orange"
        >
          {error}
        </p>
      )}

      {recent.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle">
            Just uploaded
          </p>
          <ul className="flex flex-col gap-1.5">
            {recent.map((url) => (
              <li
                key={url}
                data-testid="draft-asset-shelf-uploaded-url"
                className="flex items-center gap-2 rounded border border-cf-border bg-cf-bg-100 px-2 py-1.5"
              >
                <code className="flex-1 truncate font-mono text-[11px] text-cf-text">
                  {url}
                </code>
                <button
                  type="button"
                  data-interactive
                  data-testid="draft-asset-shelf-copy-url"
                  onClick={() => onCopy(url)}
                  aria-label={`Copy URL ${url}`}
                  className="inline-flex items-center gap-1 rounded border border-cf-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-muted transition-colors hover:border-cf-orange hover:text-cf-text"
                >
                  {copied === url ? (
                    <>
                      <Check size={10} aria-hidden="true" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={10} aria-hidden="true" /> Copy
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Library list — every image already in R2 for this slug. We
          intentionally render a flat row list (not the
          `<ImageLibrary>` thumbnail grid) so the URL is the primary
          affordance, not picking a thumbnail. */}
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle">
          Library
        </p>
        {libraryLoading ? (
          <p
            data-testid="draft-asset-shelf-library-loading"
            className="text-xs text-cf-text-muted"
          >
            Loading…
          </p>
        ) : library.length === 0 ? (
          <p
            data-testid="draft-asset-shelf-library-empty"
            className="text-xs text-cf-text-muted"
          >
            No images uploaded for this draft yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {library.map((rec) => (
              <li
                key={rec.contentHash}
                data-testid={`draft-asset-shelf-library-item-${rec.contentHash}`}
                className="flex items-center gap-2 rounded border border-cf-border bg-cf-bg-100 px-2 py-1.5"
              >
                <img
                  src={rec.src}
                  alt=""
                  loading="lazy"
                  className="h-6 w-6 shrink-0 rounded object-cover"
                />
                <code className="flex-1 truncate font-mono text-[11px] text-cf-text">
                  {rec.src}
                </code>
                <button
                  type="button"
                  data-interactive
                  data-testid={`draft-asset-shelf-library-copy-${rec.contentHash}`}
                  onClick={() => onCopy(rec.src)}
                  aria-label={`Copy URL ${rec.src}`}
                  className="inline-flex items-center gap-1 rounded border border-cf-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-muted transition-colors hover:border-cf-orange hover:text-cf-text"
                >
                  {copied === rec.src ? (
                    <>
                      <Check size={10} aria-hidden="true" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={10} aria-hidden="true" /> Copy
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
